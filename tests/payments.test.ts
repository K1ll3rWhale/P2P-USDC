import { addUser, db, schema } from './helpers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { MAX_DEMO_AMOUNT_RAW, parseNote, parseUsdcAmount } from '../lib/amount';
import { USDC_ADDRESS } from '../lib/chain';
import { DEFAULT_ESTIMATED_FEE_RAW, estimateFeeRaw, median } from '../lib/fees';
import { acceptRequest, sendRequest } from '../lib/friends';
import { type PaymentDeps, submitPayment } from '../lib/payments';
import { claimTransfer, resolvePayments, verifyOutgoing } from '../lib/payments/resolve';
import { createQuote, validateWithdrawAddress } from '../lib/quotes';
import { listActivity } from '../lib/summary';
import { ProviderRejectedError } from '../lib/wallet-adapter/types';
import { scanOnce } from '../lib/worker/scanner';
import type { ChainReader, ObservedLog, ReceiptInfo, UserOpEvent } from '../lib/worker/types';

const TOKEN = USDC_ADDRESS.toLowerCase();
const A_ADDR = '0x' + 'a1'.repeat(20);
const B_ADDR = '0x' + 'b2'.repeat(20);
const PAYMASTER = '0xa5d368a2115b05bffb3025c6d21f11ebcd4ef7a1';
const OUTSIDE = '0x59da01eb6754480f1f9fb9efa23a409e52e55134';

const alice = addUser('alice', A_ADDR);
const bob = addUser('bob', B_ADDR);
const carol = addUser('carol', '0x' + 'c3'.repeat(20));
const dave = addUser('dave', '0x' + 'd4'.repeat(20));
sendRequest(alice, 'bob');
acceptRequest(bob, db.select().from(schema.friendships).get()!.id);
sendRequest(dave, 'alice'); // pending only, never accepted
void carol;

function deps(opts: { balance?: bigint; fail?: 'rejected' | 'unclear' } = {}) {
  const calls: unknown[] = [];
  const d: PaymentDeps = {
    adapter: {
      sendUsdcTransfer: async (args) => {
        calls.push(args);
        if (opts.fail === 'rejected') throw new ProviderRejectedError('HTTP 422');
        if (opts.fail === 'unclear') throw new Error('timeout');
        return { transactionId: `tx-${calls.length}`, userOperationHash: '0x' + String(calls.length).padStart(64, '0') };
      },
    },
    getBalance: async () => opts.balance ?? 50_000_000n,
    head: async () => 100,
    now: () => Date.now(),
  };
  return { d, calls };
}
const quote = (userId: string, recipient: string, amount: string, op: 'send' | 'withdraw' = 'send') => {
  const q = createQuote(userId, { op, recipient, amount });
  assert.ok(q.ok, q.ok ? '' : q.error);
  return q.quote;
};
const payRows = () => db.select().from(schema.payments).all();
const clearPayments = () => {
  db.delete(schema.transfers).run();
  db.delete(schema.payments).run();
  db.delete(schema.chainCursors).run();
};

test('decimal parsing is exact and strict', () => {
  const ok = (s: string, raw: bigint) => assert.deepEqual(parseUsdcAmount(s), { ok: true, raw }, s);
  ok('1', 1_000_000n); ok('1.25', 1_250_000n); ok('0.000001', 1n); ok('100', MAX_DEMO_AMOUNT_RAW); ok(' 2.5 ', 2_500_000n); ok('0.1', 100_000n);
  for (const bad of ['0', '0.000000', '-1', '1.0000001', '100.000001', 'abc', '1e6', '', '.5', '1.', '1,5', '0x10', '1 2']) {
    assert.equal(parseUsdcAmount(bad).ok, false, `"${bad}" must be rejected`);
  }
  assert.equal(parseNote('x'.repeat(140)).ok, true);
  assert.equal(parseNote('x'.repeat(141)).ok, false);
  assert.equal(parseNote('a\nb').ok, false);
});

test('quote math matches a real receipt: payment 1 USDC + actual fee 3445 = sender debit 1003445', () => {
  // Real data from the validated send (tx 0xc37f…e215): two USDC Transfer logs from the sender.
  const receipt: ReceiptInfo = {
    status: 'success', blockNumber: 60687860, blockHash: '0x1',
    transfers: [
      { token: TOKEN, logIndex: 2, from: A_ADDR, to: B_ADDR, value: 1_000_000n },
      { token: TOKEN, logIndex: 5, from: A_ADDR, to: PAYMASTER, value: 3445n },
    ],
  };
  const v = verifyOutgoing(receipt, { fromAddress: A_ADDR, toAddress: B_ADDR, amountRaw: '1000000' });
  assert.deepEqual(v, { ok: true, actualFeeRaw: 3445n });
  assert.equal(1_000_000n + (v.ok ? v.actualFeeRaw : 0n), 1_003_445n, 'sender balance delta observed on chain');
  assert.equal(median([3445n, 2794n, 2794n]), 2794n);
  assert.equal(median([3445n, 2794n]), 3119n);
  assert.equal(estimateFeeRaw(), DEFAULT_ESTIMATED_FEE_RAW, 'no recorded fees yet: falls back to 0.003 USDC');
  const q = quote(alice, 'bob', '1');
  assert.equal(q.receives, '1'); assert.equal(q.estimatedFee, '0.003'); assert.equal(q.estimatedTotal, '1.003');
});

test('outgoing verification picks the intended Transfer among several logs', () => {
  const t = (logIndex: number, from: string, to: string, value: bigint, token = TOKEN) => ({ token, logIndex, from, to, value });
  const base = { fromAddress: A_ADDR, toAddress: B_ADDR, amountRaw: '1000000' };
  const noisy: ReceiptInfo = {
    status: 'success', blockNumber: 1, blockHash: '0x',
    transfers: [
      t(1, OUTSIDE, B_ADDR, 1_000_000n), // same amount to the same recipient, but from someone else
      t(2, A_ADDR, PAYMASTER, 2794n), // the fee
      t(3, A_ADDR, B_ADDR, 1_000_000n, '0x' + 'ee'.repeat(20)), // another token
      t(4, A_ADDR, B_ADDR, 1_000_000n), // the intended payment
    ],
  };
  assert.deepEqual(verifyOutgoing(noisy, base), { ok: true, actualFeeRaw: 2794n });
  assert.equal(verifyOutgoing({ ...noisy, status: 'reverted' }, base).ok, false);
  assert.equal(verifyOutgoing({ ...noisy, transfers: [t(2, A_ADDR, PAYMASTER, 2794n)] }, base).ok, false, 'fee only, no payment');
  const dup = { ...noisy, transfers: [t(4, A_ADDR, B_ADDR, 1_000_000n), t(6, A_ADDR, B_ADDR, 1_000_000n)] };
  assert.deepEqual(verifyOutgoing(dup, base), { ok: false, reason: 'ambiguous_transfer', actualFeeRaw: 0n });
});

test('only accepted friends can be paid; destination rules for withdrawals', () => {
  for (const who of ['carol', 'dave', 'ALICE']) {
    const r = createQuote(alice, { op: 'send', recipient: who, amount: '1' });
    assert.ok(!r.ok && r.code === 'not_friends', `${who}: ${JSON.stringify(r)}`);
  }
  assert.equal(createQuote(alice, { op: 'send', recipient: 'bob', amount: '0' }).ok, false);
  assert.ok(createQuote(alice, { op: 'send', recipient: 'Bob', amount: '1' }).ok);
  const bad = (a: string, code: string) => {
    const r = validateWithdrawAddress(a);
    assert.ok(!r.ok && r.code === code, `${a} -> ${JSON.stringify(r)}`);
  };
  bad('0x0000000000000000000000000000000000000000', 'zero_address');
  bad(B_ADDR, 'own_wallet');
  bad('0x' + 'B2'.repeat(20), 'invalid_address'); // mixed/upper case without a valid checksum
  bad('0x123', 'invalid_address');
  assert.deepEqual(validateWithdrawAddress(OUTSIDE), { ok: true, address: OUTSIDE });
});

test('idempotency: same key returns one record and one provider call; different payload is 409; friendship rechecked at submit', async () => {
  clearPayments();
  const { d, calls } = deps();
  const q1 = quote(alice, 'bob', '1');
  const first = await submitPayment(alice, { quoteId: q1.id, idempotencyKey: 'key-0000-aaaa', note: 'lunch' }, d);
  assert.ok(first.ok && !first.replay && first.payment.status === 'submitted');
  assert.equal(calls.length, 1);

  const q2 = quote(alice, 'bob', '1'); // a fresh quote for the identical payload
  const again = await submitPayment(alice, { quoteId: q2.id, idempotencyKey: 'key-0000-aaaa', note: 'lunch' }, d);
  assert.ok(again.ok && again.replay && first.ok && again.payment.id === first.payment.id);
  assert.equal(calls.length, 1, 'no second provider call');
  assert.equal(payRows().length, 1);

  const q3 = quote(alice, 'bob', '2');
  const diff = await submitPayment(alice, { quoteId: q3.id, idempotencyKey: 'key-0000-aaaa', note: 'lunch' }, d);
  assert.ok(!diff.ok && diff.status === 409 && diff.code === 'idempotency_conflict');
  const diffNote = await submitPayment(alice, { quoteId: q2.id, idempotencyKey: 'key-0000-aaaa', note: 'dinner' }, d);
  assert.ok(!diffNote.ok && diffNote.status === 409);
  assert.equal(calls.length, 1);
  assert.equal(payRows().length, 1);

  // One unresolved intent per wallet, sends and withdrawals together.
  const w = quote(alice, OUTSIDE, '1', 'withdraw');
  const blocked = await submitPayment(alice, { quoteId: w.id, idempotencyKey: 'key-0000-bbbb' }, d);
  assert.ok(!blocked.ok && blocked.code === 'transfer_in_progress');
  assert.equal(db.select().from(schema.quotes).where(eq(schema.quotes.id, w.id)).get()?.consumedAt, null, 'a blocked attempt does not burn the quote');

  db.update(schema.payments).set({ status: 'failed' }).run(); // resolve it so later cases can send

  // Friendship is re-checked at submit time, not only at quote time.
  const q4 = quote(alice, 'bob', '1');
  db.delete(schema.friendships).run();
  const gone = await submitPayment(alice, { quoteId: q4.id, idempotencyKey: 'key-0000-cccc' }, d);
  assert.ok(!gone.ok && gone.code === 'not_friends');
  sendRequest(alice, 'bob');
  acceptRequest(bob, db.select().from(schema.friendships).get()!.id);

  // Expired quote, insufficient balance, and provider failure modes (never resent).
  const exp = quote(alice, 'bob', '1');
  const late = await submitPayment(alice, { quoteId: exp.id, idempotencyKey: 'key-0000-dddd' }, { ...d, now: () => exp.expiresAt + 1 });
  assert.ok(!late.ok && late.code === 'quote_expired');
  const poor = await submitPayment(alice, { quoteId: quote(alice, 'bob', '10').id, idempotencyKey: 'key-0000-eeee' }, deps({ balance: 10_002_999n }).d);
  assert.ok(!poor.ok && poor.code === 'insufficient_balance', 'balance must cover amount plus estimated fee');
  const rej = await submitPayment(alice, { quoteId: quote(alice, 'bob', '1').id, idempotencyKey: 'key-0000-ffff' }, deps({ fail: 'rejected' }).d);
  assert.ok(rej.ok && rej.payment.status === 'failed', 'a clear provider rejection is failed');
  const unc = deps({ fail: 'unclear' });
  const un = await submitPayment(alice, { quoteId: quote(alice, 'bob', '1').id, idempotencyKey: 'key-0000-gggg' }, unc.d);
  assert.ok(un.ok && un.payment.status === 'submitted', 'an unclear outcome stays submitted for the chain to decide');
  assert.equal(unc.calls.length, 1);
  clearPayments();
});

test('a payment between app users is a receipt, never a deposit, and is never double counted (either order)', async () => {
  clearPayments();
  const txA = '0x' + 'a0'.repeat(32);
  const txB = '0x' + 'b0'.repeat(32);
  const op = (n: number) => '0x' + n.toString(16).padStart(64, '0');
  const logOf = (tx: string, block: number): ObservedLog => ({ token: TOKEN, txHash: tx, logIndex: 4, blockNumber: block, blockHash: '0x' + 'ee'.repeat(32), from: A_ADDR, to: B_ADDR, value: 1_000_000n });
  const deposit: ObservedLog = { ...logOf('0x' + 'd0'.repeat(32), 50), from: OUTSIDE, value: 5_000_000n };
  const events = new Map<string, UserOpEvent>([
    [op(1), { txHash: txA, blockNumber: 120, success: true }],
    [op(2), { txHash: txB, blockNumber: 140, success: true }],
  ]);
  const logs = [deposit, logOf(txA, 120), logOf(txB, 140)];
  const receipts = new Map<string, ReceiptInfo>(
    [txA, txB].map((tx) => [tx, {
      status: 'success' as const, blockNumber: tx === txA ? 120 : 140, blockHash: '0x' + 'ee'.repeat(32),
      transfers: [
        { token: TOKEN, logIndex: 4, from: A_ADDR, to: B_ADDR, value: 1_000_000n },
        { token: TOKEN, logIndex: 6, from: A_ADDR, to: PAYMASTER, value: 3445n },
      ],
    }]),
  );
  const reader: ChainReader = {
    getBlockNumber: async () => 200,
    getTransferLogs: async ({ fromBlock, toBlock, recipients }) => logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && recipients.includes(l.to)),
    getBlockTimestamp: async (b) => 1_700_000_000 + b,
    getReceipt: async (h) => receipts.get(h) ?? null,
    getUserOperationEvents: async ({ userOpHash, fromBlock, toBlock }) =>
      [events.get(userOpHash)].filter((e): e is UserOpEvent => !!e && e.blockNumber >= fromBlock && e.blockNumber <= toBlock),
  };
  const mk = (id: string, userOp: string, note: string, createdAt: number) =>
    db.insert(schema.payments).values({
      id, userId: alice, kind: 'send', fromAddress: A_ADDR, recipientUserId: bob, toAddress: B_ADDR, amountRaw: '1000000', note,
      estFeeRaw: '3000', status: 'submitted', idempotencyKey: id + '-key-xx', payloadHash: id, quoteId: id, userOpHash: userOp,
      transactionId: 't-' + id, startBlock: 100, createdAt,
    }).run();
  const intent = (id: string) => db.select().from(schema.payments).where(eq(schema.payments.id, id)).get();
  const row = (tx: string) => db.select().from(schema.transfers).where(eq(schema.transfers.txHash, tx)).get();

  // Order 1: the worker sees the transfer BEFORE the send is resolved.
  mk('p1', op(1), 'first', Date.now());
  await scanOnce(reader, { startLookback: 200, maxRange: 200 });
  assert.equal(row(txA)?.kind, 'receipt');
  assert.equal(row(txA)?.claimedIntentId, null);
  assert.equal(row(deposit.txHash)?.kind, 'deposit', 'a genuine external deposit stays a deposit');
  await resolvePayments(reader, { confirmations: 3 });
  assert.equal(intent('p1')?.status, 'confirmed');
  assert.equal(intent('p1')?.actualFeeRaw, '3445');
  assert.equal(row(txA)?.claimedIntentId, 'p1');

  // Order 2: the send is resolved BEFORE the worker has seen the transfer.
  db.delete(schema.chainCursors).run();
  db.delete(schema.transfers).where(eq(schema.transfers.txHash, txB)).run();
  mk('p2', op(2), 'second', Date.now() + 1);
  await resolvePayments(reader, { confirmations: 3 });
  assert.equal(intent('p2')?.status, 'confirmed');
  await scanOnce(reader, { startLookback: 200, maxRange: 200 });
  assert.equal(row(txB)?.claimedIntentId, 'p2');
  claimTransfer({ id: 'p2', txHash: txB, fromAddress: A_ADDR, toAddress: B_ADDR, amountRaw: '1000000' }); // idempotent
  assert.equal(row(txB)?.claimedIntentId, 'p2');

  const bobItems = listActivity(bob, 20);
  assert.deepEqual(bobItems.map((i) => i.type).sort(), ['deposit', 'receipt', 'receipt'], 'two receipts plus the one external deposit');
  assert.deepEqual(bobItems.filter((i) => i.type === 'receipt').map((i) => `${i.counterpart}:${i.note}`).sort(), ['@alice:first', '@alice:second']);
  const aliceItems = listActivity(alice, 20);
  assert.deepEqual(aliceItems.map((i) => i.type), ['send', 'send'], 'the sender sees sends only, no deposits and no receipts');
  assert.ok(aliceItems.every((i) => i.fee === '0.003445' && i.status === 'confirmed'));
  clearPayments();
});
