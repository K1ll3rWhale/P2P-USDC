import { addUser, db, schema } from './helpers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptRequest, cancelRequest, declineRequest, listFriendships, searchUsers, sendRequest } from '../lib/friends';

const a = addUser('alice');
const b = addUser('bob');
const c = addUser('carol');
const pairRows = () => db.select().from(schema.friendships).all();

test('friend pair uniqueness: one row per unordered pair, no self-friendship, reverse request surfaces', () => {
  assert.deepEqual(sendRequest(a, 'bob'), { ok: true });
  assert.equal(pairRows().length, 1);

  const reverse = sendRequest(b, 'alice');
  assert.equal(reverse.ok, false);
  assert.ok(!reverse.ok && reverse.incomingRequestId === pairRows()[0].id, 'surfaces the existing request for acceptance');
  assert.equal(pairRows().length, 1, 'no duplicate row');

  assert.equal(sendRequest(a, 'bob').ok, false, 'repeat request is rejected');
  assert.equal(sendRequest(a, 'ALICE').ok, false, 'cannot add yourself (case-insensitive)');
  assert.equal(pairRows().length, 1);

  // The database itself enforces it, even bypassing the app code.
  const row = pairRows()[0];
  assert.throws(() => db.insert(schema.friendships).values({ id: 'dup', userLow: row.userLow, userHigh: row.userHigh, requesterId: row.userHigh, createdAt: 1 }).run(), /UNIQUE/);
  assert.throws(() => db.insert(schema.friendships).values({ id: 'self', userLow: a, userHigh: a, requesterId: a, createdAt: 1 }).run(), /CHECK|UNIQUE/);
  assert.deepEqual(searchUsers(a, 'ali'), [], 'search excludes yourself');
  assert.deepEqual(searchUsers(a, 'bo').map((u) => u.username), ['bob']);
});

test('authorization: only the addressee can accept or decline, only the requester can cancel, strangers see nothing', () => {
  const id = pairRows()[0].id; // alice -> bob, pending
  for (const fn of [acceptRequest, declineRequest, cancelRequest]) {
    assert.equal(fn(c, id).ok, false, `${fn.name} by a third user must fail`);
  }
  assert.equal(acceptRequest(a, id).ok, false, 'requester cannot accept their own request');
  assert.equal(declineRequest(a, id).ok, false, 'requester cannot decline their own request');
  assert.equal(cancelRequest(b, id).ok, false, 'addressee cannot cancel');
  assert.equal(pairRows()[0].status, 'pending', 'nothing changed');
  assert.equal(listFriendships(c).incoming.length + listFriendships(c).outgoing.length, 0);

  assert.equal(acceptRequest(b, id).ok, true);
  assert.equal(pairRows()[0].status, 'accepted');
  assert.equal(cancelRequest(a, id).ok, false, 'accepted friendships cannot be cancelled as requests');
});
