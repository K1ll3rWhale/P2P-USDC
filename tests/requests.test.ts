import { addUser, db, schema } from './helpers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptRequest, sendRequest } from '../lib/friends';
import {
  EXPIRY_DEFAULT_DAYS, EXPIRY_MAX_DAYS, EXPIRY_MIN_DAYS, MAX_PENDING_PER_PAIR,
  cancelMoneyRequest, countIncomingMoneyRequests, createMoneyRequest, declineMoneyRequest, getPayableRequest, listMoneyRequests, parseExpiryDays,
} from '../lib/requests';

const DAY = 24 * 60 * 60 * 1000;
const alice = addUser('alice', '0x' + 'a1'.repeat(20));
const bob = addUser('bob', '0x' + 'b2'.repeat(20));
const carol = addUser('carol', '0x' + 'c3'.repeat(20)); // not a friend of anyone
const dave = addUser('dave', '0x' + 'd4'.repeat(20));
sendRequest(alice, 'bob');
acceptRequest(bob, db.select().from(schema.friendships).get()!.id);
sendRequest(dave, 'alice'); // pending only
void carol;

const reqRows = () => db.select().from(schema.moneyRequests).all();
const clear = () => { db.delete(schema.payments).run(); db.delete(schema.moneyRequests).run(); db.delete(schema.quotes).run(); db.delete(schema.rateLimits).run(); };

test('expiry days: default 7, min 1, max 365; out-of-range is clamped with a message', () => {
  assert.deepEqual(parseExpiryDays(''), { days: EXPIRY_DEFAULT_DAYS });
  assert.deepEqual(parseExpiryDays(undefined), { days: 7 });
  assert.deepEqual(parseExpiryDays('30'), { days: 30 });
  assert.deepEqual(parseExpiryDays(' 1 '), { days: 1 });
  assert.deepEqual(parseExpiryDays('365'), { days: 365 });
  for (const low of ['0', '-5']) {
    const r = parseExpiryDays(low);
    assert.equal(r.days, EXPIRY_MIN_DAYS);
    assert.match(r.warning ?? '', /at least 1 day/);
  }
  for (const high of ['366', '100000']) {
    const r = parseExpiryDays(high);
    assert.equal(r.days, EXPIRY_MAX_DAYS);
    assert.match(r.warning ?? '', /at most 365 days/);
  }
  for (const junk of ['abc', '1.5', '1e3', '7 days']) {
    const r = parseExpiryDays(junk);
    assert.equal(r.days, EXPIRY_DEFAULT_DAYS, junk);
    assert.ok(r.warning, junk);
  }
});

test('create: friends only, validated amount and note, expiry stored and clamped with a warning', () => {
  clear();
  const t0 = 1_700_000_000_000;
  assert.equal(createMoneyRequest(alice, { friend: 'carol', amount: '1' }).ok, false, 'not a friend');
  assert.equal(createMoneyRequest(alice, { friend: 'dave', amount: '1' }).ok, false, 'friendship still pending');
  assert.equal(createMoneyRequest(alice, { friend: 'alice', amount: '1' }).ok, false, 'not yourself');
  assert.equal(createMoneyRequest(alice, { friend: 'bob', amount: '0' }).ok, false);
  assert.equal(createMoneyRequest(alice, { friend: 'bob', amount: '100.01' }).ok, false);
  assert.equal(createMoneyRequest(alice, { friend: 'bob', amount: '1', note: 'x'.repeat(141) }).ok, false);
  assert.equal(reqRows().length, 0);

  const a = createMoneyRequest(alice, { friend: 'bob', amount: '2.5', note: 'Lunch' }, t0);
  assert.deepEqual(a, { ok: true, warning: undefined });
  assert.equal(reqRows()[0].expiresAt, t0 + 7 * DAY);
  const lo = createMoneyRequest(alice, { friend: 'Bob', amount: '1', expiryDays: '0' }, t0);
  assert.ok(lo.ok && lo.warning && /at least 1 day/.test(lo.warning));
  const hi = createMoneyRequest(alice, { friend: 'bob', amount: '1', expiryDays: '9999' }, t0);
  assert.ok(hi.ok && hi.warning && /at most 365/.test(hi.warning));
  const exp = reqRows().map((r) => r.expiresAt).sort((x, y) => x - y);
  assert.deepEqual(exp, [t0 + 1 * DAY, t0 + 7 * DAY, t0 + 365 * DAY], 'clamped requests were still created');
});

test('create: at most 5 open requests per pair', () => {
  clear();
  for (let i = 0; i < MAX_PENDING_PER_PAIR; i++) assert.equal(createMoneyRequest(alice, { friend: 'bob', amount: '1' }).ok, true);
  const over = createMoneyRequest(alice, { friend: 'bob', amount: '1' });
  assert.equal(over.ok, false);
  assert.equal(reqRows().length, 5);
  assert.equal(createMoneyRequest(bob, { friend: 'alice', amount: '1' }).ok, true, 'the other direction has its own budget');
});

test('decline and cancel: only the right party, only while open; lists and badge reflect it', () => {
  clear();
  const now = Date.now();
  createMoneyRequest(alice, { friend: 'bob', amount: '3', note: 'Taxi' }, now);
  const id = reqRows()[0].id;
  assert.equal(countIncomingMoneyRequests(bob), 1);
  assert.equal(countIncomingMoneyRequests(alice), 0);
  assert.equal(listMoneyRequests(alice).outgoing.length, 1);
  assert.equal(listMoneyRequests(bob).incoming[0].note, 'Taxi');
  assert.equal(listMoneyRequests(bob).incoming[0].amount, '3');

  assert.equal(declineMoneyRequest(alice, id).ok, false, 'the requester cannot decline');
  assert.equal(cancelMoneyRequest(bob, id).ok, false, 'the payer cannot cancel');
  assert.equal(cancelMoneyRequest(carol, id).ok, false, 'a stranger cannot do either');
  assert.equal(declineMoneyRequest(carol, id).ok, false);
  assert.equal(cancelMoneyRequest(alice, id).ok, true);
  assert.equal(cancelMoneyRequest(alice, id).ok, false, 'not twice');
  assert.equal(declineMoneyRequest(bob, id).ok, false, 'already cancelled');
  assert.equal(listMoneyRequests(bob).incoming.length, 0);
  assert.equal(listMoneyRequests(bob).recent[0].state, 'cancelled');

  createMoneyRequest(alice, { friend: 'bob', amount: '1' }, now - 3 * DAY); // 7 days from 3 days ago: still open
  createMoneyRequest(alice, { friend: 'bob', amount: '1', expiryDays: '1' }, now - 3 * DAY);
  const expired = reqRows().find((r) => r.expiresAt < now)!;
  assert.equal(declineMoneyRequest(bob, expired.id).ok, false, 'an expired request cannot be declined');
  assert.equal(getPayableRequest(bob, expired.id), null, 'nor paid');
  assert.equal(listMoneyRequests(bob).recent.some((r) => r.id === expired.id && r.state === 'expired'), true);
  const open = reqRows().find((r) => r.expiresAt > now && r.status === 'pending')!;
  assert.equal(declineMoneyRequest(bob, open.id).ok, true);
});

