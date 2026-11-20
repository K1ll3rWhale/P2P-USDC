import { addUser, db, schema } from './helpers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { acceptRequest, sendRequest } from '../lib/friends';
import { type PaymentDeps, submitPayment } from '../lib/payments';
import { createQuote } from '../lib/quotes';
import { cancelMoneyRequest, createMoneyRequest, declineMoneyRequest, getPayableRequest, listMoneyRequests } from '../lib/requests';
import { ProviderRejectedError } from '../lib/wallet-adapter/types';

const DAY = 24 * 60 * 60 * 1000;
const alice = addUser('alice', '0x' + 'a1'.repeat(20));
const bob = addUser('bob', '0x' + 'b2'.repeat(20));
sendRequest(alice, 'bob');
acceptRequest(bob, db.select().from(schema.friendships).get()!.id);

const reqRows = () => db.select().from(schema.moneyRequests).all();
const clear = () => { db.delete(schema.payments).run(); db.delete(schema.moneyRequests).run(); db.delete(schema.quotes).run(); db.delete(schema.rateLimits).run(); };
function deps(opts: { fail?: 'rejected' } = {}) {
  const d: PaymentDeps = {
    adapter: { sendUsdcTransfer: async () => { if (opts.fail === 'rejected') throw new ProviderRejectedError('HTTP 422'); return { transactionId: 'tx', userOperationHash: '0x' + '1'.repeat(64) }; } },
    getBalance: async () => 50_000_000n,
    head: async () => 100,
    now: () => Date.now(),
  };
  return d;
}
const pay = (payer: string, to: string, amount: string, requestId: string | undefined, key: string, d = deps()) => {
  const q = createQuote(payer, { op: 'send', recipient: to, amount });
  assert.ok(q.ok);
  return submitPayment(payer, { quoteId: q.quote.id, idempotencyKey: key, note: 'thanks', requestId }, d);
};

test('paying: exact payer, amount, recipient; one payment per request; replays; failed payments free the request', async () => {
  clear();
  createMoneyRequest(alice, { friend: 'bob', amount: '2.5', note: 'Lunch' });
  const id = reqRows()[0].id;
  assert.ok(getPayableRequest(bob, id), 'payer can see it as payable');
  assert.equal(getPayableRequest(alice, id), null, 'the requester cannot pay their own request');

  // wrong payer / wrong amount / unknown request are refused and nothing is linked
  const wrongPayer = await pay(alice, 'bob', '2.5', id, 'key-wrong-payer');
  assert.ok(!wrongPayer.ok && wrongPayer.code === 'request_unavailable');
  const wrongAmount = await pay(bob, 'alice', '2.4', id, 'key-wrong-amount');
  assert.ok(!wrongAmount.ok && wrongAmount.code === 'request_unavailable');
  const bogus = await pay(bob, 'alice', '2.5', 'no-such-request', 'key-bogus-01');
  assert.ok(!bogus.ok && bogus.code === 'request_unavailable');
  assert.equal(reqRows()[0].paymentId, null);
  assert.equal(db.select().from(schema.payments).all().length, 0);

  // a provider rejection leaves the request payable again
  const rejected = await pay(bob, 'alice', '2.5', id, 'key-rejected', deps({ fail: 'rejected' }));
  assert.ok(rejected.ok);
  assert.equal(db.select().from(schema.payments).get()!.status, 'failed');
  assert.ok(getPayableRequest(bob, id), 'a failed payment frees the request');
  assert.equal(listMoneyRequests(bob).incoming[0].state, 'pending');

  // the retry succeeds; the request is "paying" and cannot be paid twice
  const first = await pay(bob, 'alice', '2.5', id, 'key-pay-001');
  assert.ok(first.ok && !first.replay);
  assert.equal(listMoneyRequests(bob).incoming[0].state, 'paying');
  assert.equal(getPayableRequest(bob, id), null);
  const again = await pay(bob, 'alice', '2.5', id, 'key-pay-002');
  assert.ok(!again.ok && again.code === 'request_unavailable', 'a second payment for the same request is refused');
  const q = createQuote(bob, { op: 'send', recipient: 'alice', amount: '2.5' });
  assert.ok(q.ok);
  const replay = await submitPayment(bob, { quoteId: q.quote.id, idempotencyKey: 'key-pay-001', note: 'thanks', requestId: id }, deps());
  assert.ok(replay.ok && replay.replay, 'the same key replays instead of paying again');
  assert.equal(db.select().from(schema.payments).all().filter((p) => p.status !== 'failed').length, 1);
  assert.equal(declineMoneyRequest(bob, id).ok, false, 'cannot decline while it is being paid');
  assert.equal(cancelMoneyRequest(alice, id).ok, false, 'nor cancel');

  // confirmed on chain: paid
  db.update(schema.payments).set({ status: 'confirmed' }).where(eq(schema.payments.id, reqRows()[0].paymentId!)).run();
  assert.equal(listMoneyRequests(bob).incoming.length, 0);
  assert.equal(listMoneyRequests(bob).recent[0].state, 'paid');
  assert.equal(listMoneyRequests(alice).recent[0].state, 'paid');
});

test('paying: expired, cancelled and declined requests are refused', async () => {
  clear();
  createMoneyRequest(alice, { friend: 'bob', amount: '1', expiryDays: '1' }, Date.now() - 3 * DAY);
  createMoneyRequest(alice, { friend: 'bob', amount: '1' });
  createMoneyRequest(alice, { friend: 'bob', amount: '1' });
  const [expired, cancelled, declined] = reqRows().map((r) => r.id);
  assert.equal(cancelMoneyRequest(alice, cancelled).ok, true);
  assert.equal(declineMoneyRequest(bob, declined).ok, true);
  for (const [id, key] of [[expired, 'key-exp-0001'], [cancelled, 'key-can-0001'], [declined, 'key-dec-0001']]) {
    const r = await pay(bob, 'alice', '1', id, key);
    assert.ok(!r.ok && r.code === 'request_unavailable', id);
  }
  assert.equal(db.select().from(schema.payments).all().length, 0, 'no money moved');
});

test('an ordinary send (no request) still works and does not touch requests', async () => {
  clear();
  createMoneyRequest(alice, { friend: 'bob', amount: '1' });
  const r = await pay(bob, 'alice', '1', undefined, 'key-plain-01');
  assert.ok(r.ok);
  assert.equal(reqRows()[0].paymentId, null);
  assert.equal(listMoneyRequests(bob).incoming[0].state, 'pending');
});
