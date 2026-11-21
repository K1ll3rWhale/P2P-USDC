import { addUser, db, schema } from './helpers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { fromRaw, timeLeft, toRaw } from '../app/components/format';
import { changePassword, listSessions, revokeOtherSessions } from '../lib/account-security';
import { activityToCsv, csvCell } from '../lib/csv';
import { recentFeeRange } from '../lib/fees';
import { acceptRequest, cancelRequest, declineRequest, listFriendEvents, removeFriend, sendRequest } from '../lib/friends';
import { markActivitySeen, unreadActivityCount, waitingCounts } from '../lib/notifications';
import { hashPassword, verifyPassword } from '../lib/password';
import { recentRecipientUsernames } from '../lib/recent';
import { createMoneyRequest, getOwnRequestForReuse, listMoneyRequests, REMIND_COOLDOWN_MS, remindMoneyRequest } from '../lib/requests';
import type { ActivityItem } from '../lib/summary';

const alice = addUser('alice', '0x' + 'a1'.repeat(20));
const bob = addUser('bob', '0x' + 'b2'.repeat(20));
const carol = addUser('carol', '0x' + 'c3'.repeat(20));
const dave = addUser('dave', '0x' + 'd4'.repeat(20));
const friendRow = () => db.select().from(schema.friendships).all();

function befriend(a: string, aName: string, b: string) {
  sendRequest(a, addName(b));
  void aName;
  const row = friendRow().find((r) => r.status === 'pending' && r.requesterId === a)!;
  assert.ok(acceptRequest(b, row.id).ok);
  return row.id;
}
const addName = (id: string) => db.select().from(schema.users).where(eq(schema.users.id, id)).get()!.username;

// ------------------------------------------------------------------------------------------------ csv
test('csv: quoting, and formula characters are neutralized', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  for (const bad of ['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '\rx']) {
    assert.ok(csvCell(bad).startsWith("'") || csvCell(bad).startsWith('"\''), bad);
  }
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(12), '12');
});

test('csv: activity rows keep direction, fee and a safe note', () => {
  const items: ActivityItem[] = [
    { id: 'p:1', type: 'send', amount: '0.25', fee: '0.0028', feeEstimate: null, status: 'confirmed', counterpart: '@bob', note: '=HYPERLINK("x")', txHash: '0xabc', error: null, when: 1_700_000_000_000 },
    { id: 't:2', type: 'deposit', amount: '5', fee: null, feeEstimate: null, status: 'pending', counterpart: '0x1234…abcd', note: null, txHash: null, error: null, when: 1_700_000_100_000 },
  ];
  const lines = activityToCsv(items).trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Date \(UTC\),Type,Counterpart,Direction/);
  assert.match(lines[1], /,Sent,bob,out,0\.25,confirmed,0\.0028,,/);
  assert.ok(lines[1].includes(`'=HYPERLINK`), 'formula in a note is defused');
  assert.match(lines[1], /https:\/\/sepolia\.basescan\.org\/tx\/0xabc$/);
  assert.match(lines[2], /,Deposit,.*,in,5,pending,/);
});

// ------------------------------------------------------------------------------------------------ settings
test('change password: checks, keeps this session, signs out the others, rate limited', async () => {
  const uid = addUser('pwuser');
  db.update(schema.users).set({ passwordHash: await hashPassword('old-password-123') }).where(eq(schema.users.id, uid)).run();
  const mk = (id: string, ago = 0) => db.insert(schema.sessions).values({ id, userId: uid, tokenHash: 'h-' + id, expiresAt: Date.now() + 86_400_000, createdAt: Date.now() - ago }).run();
  mk('s-current'); mk('s-other-1', 1000); mk('s-other-2', 2000);
  assert.equal(listSessions(uid, 's-current').length, 3);
  assert.equal(listSessions(uid, 's-current').find((s) => s.current)!.id, 's-current');

  const r1 = await changePassword(uid, 's-current', { current: 'wrong-password', next: 'brand-new-password', confirm: 'brand-new-password' });
  assert.ok(!r1.ok && /current password/.test(r1.error));
  const r2 = await changePassword(uid, 's-current', { current: 'old-password-123', next: 'short', confirm: 'short' });
  assert.ok(!r2.ok && /10 characters/.test(r2.error));
  const r3 = await changePassword(uid, 's-current', { current: 'old-password-123', next: 'brand-new-password', confirm: 'different-password' });
  assert.ok(!r3.ok && /do not match/.test(r3.error));
  const r4 = await changePassword(uid, 's-current', { current: 'old-password-123', next: 'old-password-123', confirm: 'old-password-123' });
  assert.ok(!r4.ok && /different/.test(r4.error));
  assert.equal(listSessions(uid, 's-current').length, 3, 'failed attempts sign nobody out');

  const r5 = await changePassword(uid, 's-current', { current: 'wrong-again', next: 'brand-new-password', confirm: 'brand-new-password' });
  assert.ok(!r5.ok && /current password/.test(r5.error));
  // five attempts per window are used up (r1 to r5): the next one is blocked even if everything is correct
  const blocked = await changePassword(uid, 's-current', { current: 'old-password-123', next: 'brand-new-password', confirm: 'brand-new-password' });
  assert.ok(!blocked.ok && /Too many/.test(blocked.error));
  db.delete(schema.rateLimits).run();

  const ok = await changePassword(uid, 's-current', { current: 'old-password-123', next: 'brand-new-password', confirm: 'brand-new-password' });
  assert.ok(ok.ok);
  const hash = db.select().from(schema.users).where(eq(schema.users.id, uid)).get()!.passwordHash;
  assert.equal(await verifyPassword(hash, 'brand-new-password'), true);
  assert.equal(await verifyPassword(hash, 'old-password-123'), false);
  assert.deepEqual(listSessions(uid, 's-current').map((s) => s.id), ['s-current']);

  mk('s-again');
  assert.equal(revokeOtherSessions(uid, 's-current'), 1);
  assert.equal(revokeOtherSessions(uid, 's-current'), 0);
  // another user's sessions are never touched
  const other = addUser('pwother');
  db.insert(schema.sessions).values({ id: 's-other-user', userId: other, tokenHash: 'h-o', expiresAt: Date.now() + 1000, createdAt: Date.now() }).run();
  revokeOtherSessions(uid, 's-current');
  assert.equal(listSessions(other, null).length, 1);
});

// ------------------------------------------------------------------------------------------------ friends: history and unfriend
test('friend history is recorded for accept, decline, cancel and remove', () => {
  db.delete(schema.friendEvents).run();
  db.delete(schema.friendships).run();
  // alice asks bob, bob declines
  sendRequest(alice, 'bob');
  declineRequest(bob, friendRow()[0].id);
  // alice asks bob again, then cancels
  sendRequest(alice, 'bob');
  cancelRequest(alice, friendRow()[0].id);
  // alice asks bob, bob accepts, alice removes
  sendRequest(alice, 'bob');
  const id = friendRow()[0].id;
  acceptRequest(bob, id);
  assert.equal(removeFriend(alice, id).ok, true);
  assert.equal(friendRow().length, 0);

  const mine = listFriendEvents(alice).map((e) => `${e.type}:${e.mine}:${e.otherUsername}`).sort();
  assert.deepEqual(mine, ['accepted:false:bob', 'cancelled:true:bob', 'declined:false:bob', 'removed:true:bob']);
  const theirs = listFriendEvents(bob).map((e) => `${e.type}:${e.mine}:${e.otherUsername}`).sort();
  assert.deepEqual(theirs, ['accepted:true:alice', 'cancelled:false:alice', 'declined:true:alice', 'removed:false:alice']);
  assert.equal(listFriendEvents(carol).length, 0, 'strangers see nothing');
});

test('unfriend: only a party, only an accepted friend, and never with money in flight', () => {
  db.delete(schema.payments).run();
  db.delete(schema.moneyRequests).run();
  db.delete(schema.friendships).run();
  const id = befriend(alice, 'alice', bob);
  assert.equal(removeFriend(carol, id).ok, false, 'a stranger cannot remove');
  sendRequest(dave, 'alice'); // pending, not accepted
  const pending = friendRow().find((r) => r.status === 'pending')!;
  assert.equal(removeFriend(alice, pending.id).ok, false, 'pending rows use decline/cancel');

  // an unresolved send blocks
  db.insert(schema.payments).values({
    id: 'p-open', userId: alice, kind: 'send', fromAddress: 'a', recipientUserId: bob, toAddress: 'b', amountRaw: '1', estFeeRaw: '1',
    status: 'submitted', idempotencyKey: 'k-open-0001', payloadHash: 'h', quoteId: 'q', startBlock: 1, createdAt: Date.now(),
  }).run();
  const blocked = removeFriend(bob, id);
  assert.ok(!blocked.ok && /in progress/.test(blocked.error));
  db.update(schema.payments).set({ status: 'confirmed', resolvedAt: Date.now() }).where(eq(schema.payments.id, 'p-open')).run();

  // an open money request blocks (either direction)
  createMoneyRequest(bob, { friend: 'alice', amount: '1' });
  const blocked2 = removeFriend(alice, id);
  assert.ok(!blocked2.ok && /open money request/.test(blocked2.error));
  db.delete(schema.moneyRequests).run();

  assert.equal(removeFriend(bob, id).ok, true, 'either side may remove');
  assert.equal(removeFriend(bob, id).ok, false, 'not twice');
});

// ------------------------------------------------------------------------------------------------ notifications
test('unread activity: counts new incoming and resolved items since last seen; marking seen clears it', () => {
  const uid = addUser('notif', '0x' + 'e5'.repeat(20));
  assert.equal(unreadActivityCount(uid), 0);
  const t0 = 1_000_000;
  markActivitySeen(uid, t0);
  const transfer = (n: number, observedAt: number, status: 'observed' | 'dropped' = 'observed') =>
    db.insert(schema.transfers).values({
      id: 'tr-' + n, chainId: 84532, token: 't', txHash: '0x' + n, logIndex: 0, blockNumber: n, blockHash: 'b', fromAddress: 'x', toAddress: 'y',
      userId: uid, amountRaw: '1', status, observedAt,
    }).run();
  transfer(1, t0 - 10); // before the last visit
  transfer(2, t0 + 10);
  transfer(3, t0 + 20, 'dropped'); // dropped never counts
  assert.equal(unreadActivityCount(uid), 1);
  db.insert(schema.payments).values({
    id: 'p-n1', userId: uid, kind: 'send', fromAddress: 'a', recipientUserId: bob, toAddress: 'b', amountRaw: '1', estFeeRaw: '1', status: 'confirmed',
    idempotencyKey: 'k-notif-001', payloadHash: 'h', quoteId: 'q', startBlock: 1, createdAt: t0 - 100, resolvedAt: t0 + 50,
  }).run();
  assert.equal(unreadActivityCount(uid), 2, 'a send that resolved after the last visit counts');
  markActivitySeen(uid, t0 + 1000);
  assert.equal(unreadActivityCount(uid), 0);
});

test('waiting counts: incoming friend requests plus incoming money requests', () => {
  db.delete(schema.moneyRequests).run();
  db.delete(schema.friendships).run();
  befriend(alice, 'alice', bob);
  sendRequest(carol, 'alice');
  createMoneyRequest(bob, { friend: 'alice', amount: '2' });
  assert.deepEqual(waitingCounts(alice), { friendRequests: 1, moneyRequests: 1, total: 2 });
  assert.deepEqual(waitingCounts(bob), { friendRequests: 0, moneyRequests: 0, total: 0 });
});

// ------------------------------------------------------------------------------------------------ money request polish
test('remind: only the requester, only while open, once per 24 hours; a reminder floats to the top; ask again is own-only', () => {
  db.delete(schema.moneyRequests).run();
  db.delete(schema.friendships).run();
  befriend(alice, 'alice', bob);
  const t0 = Date.now();
  createMoneyRequest(bob, { friend: 'alice', amount: '1', note: 'first' }, t0 - 5000);
  createMoneyRequest(bob, { friend: 'alice', amount: '2', note: 'second' }, t0 - 1000);
  const [older, newer] = db.select().from(schema.moneyRequests).all().sort((a, b) => a.createdAt - b.createdAt);
  assert.equal(listMoneyRequests(alice).incoming[0].id, newer.id);

  assert.equal(remindMoneyRequest(alice, older.id).ok, false, 'the payer cannot remind');
  assert.equal(remindMoneyRequest(carol, older.id).ok, false, 'a stranger cannot');
  assert.equal(remindMoneyRequest(bob, older.id, t0).ok, true);
  const again = remindMoneyRequest(bob, older.id, t0 + 1000);
  assert.ok(!again.ok && /24 hours/.test(again.error));
  assert.equal(remindMoneyRequest(bob, older.id, t0 + REMIND_COOLDOWN_MS + 1).ok, true, 'allowed again after a day');
  assert.equal(listMoneyRequests(alice).incoming[0].id, older.id, 'the reminded request moves to the top');

  db.update(schema.moneyRequests).set({ status: 'cancelled' }).where(eq(schema.moneyRequests.id, newer.id)).run();
  assert.equal(remindMoneyRequest(bob, newer.id).ok, false, 'closed requests cannot be reminded');

  assert.deepEqual(getOwnRequestForReuse(bob, newer.id), { friend: 'alice', amount: '2', note: 'second' });
  assert.equal(getOwnRequestForReuse(alice, newer.id), null, 'the payer cannot reuse the requester\'s request');
});

// ------------------------------------------------------------------------------------------------ send page helpers
test('recent recipients and the recent fee range', () => {
  db.delete(schema.payments).run();
  assert.deepEqual(recentRecipientUsernames(alice), []);
  assert.equal(recentFeeRange(), null);
  const pay = (id: string, to: string, at: number, fee: string | null, status: 'confirmed' | 'failed' = 'confirmed') =>
    db.insert(schema.payments).values({
      id, userId: alice, kind: 'send', fromAddress: 'a', recipientUserId: to, toAddress: 'b', amountRaw: '1', estFeeRaw: '3000', actualFeeRaw: fee, status,
      idempotencyKey: 'k-' + id + '-0000', payloadHash: 'h' + id, quoteId: 'q' + id, startBlock: 1, createdAt: at, resolvedAt: at,
    }).run();
  pay('r1', bob, 1000, '2800');
  pay('r2', carol, 2000, '3400');
  pay('r3', bob, 3000, '3000');
  pay('r4', dave, 4000, null, 'failed');
  assert.deepEqual(recentRecipientUsernames(alice), ['dave', 'bob', 'carol'], 'newest first, no repeats');
  assert.deepEqual(recentRecipientUsernames(alice, 2), ['dave', 'bob']);
  assert.deepEqual(recentFeeRange(), { min: 2800n, max: 3400n });
});

// ------------------------------------------------------------------------------------------------ display helpers
test('timeLeft, toRaw and fromRaw', () => {
  const now = 1_000_000_000;
  const m = 60_000;
  assert.equal(timeLeft(now - 1, now), 'expired');
  assert.equal(timeLeft(now + 30_000, now), 'in 1 minute');
  assert.equal(timeLeft(now + 20 * m, now), 'in 20 minutes');
  assert.equal(timeLeft(now + 60 * m, now), 'in 1 hour');
  assert.equal(timeLeft(now + 5 * 60 * m, now), 'in 5 hours');
  assert.equal(timeLeft(now + 24 * 60 * m, now), 'in 1 day');
  assert.equal(timeLeft(now + 3 * 24 * 60 * m, now), 'in 3 days');
  assert.equal(toRaw('1.25'), 1_250_000n);
  assert.equal(toRaw('0.000001'), 1n);
  assert.equal(toRaw('12'), 12_000_000n);
  for (const bad of ['', '-1', '1.1234567', 'abc', '1e3', '.5']) assert.equal(toRaw(bad), null, bad);
  assert.equal(fromRaw(1_250_000n), '1.25');
  assert.equal(fromRaw(3_000_000n), '3');
  assert.equal(fromRaw(1n), '0.000001');
  assert.equal(fromRaw(toRaw('99.987654')!), '99.987654');
});
