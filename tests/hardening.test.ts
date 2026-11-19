import { addUser, db, schema } from './helpers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { getAddress } from 'viem';
import { USDC_ADDRESS } from '../lib/chain';
import { MAX_FUND_PER_RUN_RAW, planFunding } from '../lib/demo-funding';
import { provisionWallet } from '../lib/provisioning';
import { operatorFailIntent, resolveIntent } from '../lib/payments/resolve';
import type { ChainReader, ObservedLog } from '../lib/worker/types';

const TOKEN = USDC_ADDRESS.toLowerCase();
const ADDR = (c: string) => '0x' + c.repeat(20);

// ---------------------------------------------------------------- pending wallet and Retry path
test('pending wallet: a failed setup stays pending and recoverable; retry reuses an existing remote wallet; never marked ready without one', async () => {
  const id = addUser('pend', undefined, 'pending');
  const user = () => db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
  const walletRow = () => db.select().from(schema.wallets).where(eq(schema.wallets.userId, id)).get();

  const failing = { provider: 'fake', createWallet: async () => { throw new Error('provider down'); }, findWalletByExternalId: async () => null };
  const r1 = await provisionWallet(id, failing);
  assert.equal(r1.ok, false);
  assert.equal(user().status, 'pending');
  assert.ok(user().provisioningError, 'a user-safe error is recorded');
  assert.equal(user().provisioningStartedAt, null, 'the lease is released so Retry works');
  assert.equal(walletRow(), undefined, 'no wallet, so the account is NOT ready');
  assert.doesNotMatch(String(user().provisioningError), /provider down/, 'internal error text is not shown to the user');

  // Retry: the wallet already exists remotely (created before the earlier failure). It is fetched, not created again.
  let creates = 0;
  const remote = { providerWalletId: 'pw-remote', address: getAddress(ADDR('ab')) }; // checksummed, as the provider returns it
  const existing = { provider: 'fake', createWallet: async () => { creates++; return remote; }, findWalletByExternalId: async () => remote };
  assert.deepEqual(await provisionWallet(id, existing), { ok: true });
  assert.equal(creates, 0, 'did not create a second remote wallet');
  assert.equal(user().status, 'active');
  assert.equal(user().provisioningError, null);
  assert.equal(walletRow()?.address, ADDR('ab'), 'address saved lowercase');
  assert.equal(walletRow()?.providerWalletId, 'pw-remote');
  assert.deepEqual(await provisionWallet(id, failing), { ok: true }, 'already active: a further retry is a no-op and does not touch the provider');
});

test('pending wallet: created remotely despite an error is found instead of failing; concurrent attempts create once', async () => {
  const id = addUser('pend2', undefined, 'pending');
  let found = false;
  const remote = { providerWalletId: 'pw-2', address: ADDR('cd') };
  const flaky = { provider: 'fake', createWallet: async () => { found = true; throw new Error('timeout after creating'); }, findWalletByExternalId: async () => (found ? remote : null) };
  assert.deepEqual(await provisionWallet(id, flaky), { ok: true });

  const id3 = addUser('pend3', undefined, 'pending');
  let creates = 0;
  const slow = { provider: 'fake', createWallet: async () => { creates++; await new Promise((r) => setTimeout(r, 50)); return { providerWalletId: 'pw-3', address: ADDR('ef') }; }, findWalletByExternalId: async () => null };
  const results = await Promise.all([provisionWallet(id3, slow), provisionWallet(id3, slow)]);
  assert.equal(creates, 1, 'the lease prevents a double create');
  assert.equal(results.filter((r) => r.ok).length, 1);
});

// ---------------------------------------------------------------- recovery tooling
const FROM = ADDR('a1');
const TO = ADDR('b2');
const sender = addUser('rsender', FROM);
addUser('rrecv', TO);
const emptyReader = (logs: ObservedLog[] = []): ChainReader => ({
  getBlockNumber: async () => 500,
  getTransferLogs: async ({ fromBlock, toBlock, recipients }) => logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && recipients.includes(l.to)),
  getBlockTimestamp: async () => 1,
  getReceipt: async () => null,
  getUserOperationEvents: async () => [],
});
let n = 0;
const openIntent = (ageMs: number) => {
  const id = `rec-${++n}`;
  db.insert(schema.payments).values({
    id, userId: sender, kind: 'send', fromAddress: FROM, recipientUserId: null, toAddress: TO, amountRaw: '1000000', estFeeRaw: '3000',
    status: 'submitted', idempotencyKey: `idem-key-${n}`, payloadHash: id, quoteId: id, userOpHash: '0x' + String(n).padStart(64, '0'),
    transactionId: 'tx-' + n, startBlock: 100, createdAt: Date.now() - ageMs,
  }).run();
  return id;
};
const status = (id: string) => db.select().from(schema.payments).where(eq(schema.payments.id, id)).get()!;

test('recovery: an old intent with no on-chain trace can be failed by the operator, which unblocks the wallet', async () => {
  const id = openIntent(10 * 60_000);
  assert.equal((await resolveIntent(emptyReader(), id)).result, 'open', 'the normal chain check finds nothing');
  assert.throws(() => openIntent(0), /UNIQUE/, 'while unresolved, the wallet is blocked');

  const r = await operatorFailIntent(emptyReader(), id);
  assert.ok(r.ok);
  assert.equal(r.ok && r.report.userOpEvents.length + r.report.transferMatches.length, 0);
  assert.equal(r.ok && r.report.searchedFrom, 100);
  assert.equal(status(id).status, 'failed');
  assert.match(String(status(id).error), /Marked failed by operator.*100 and 500/);
  assert.doesNotThrow(() => openIntent(0), 'the wallet is unblocked');
  db.update(schema.payments).set({ status: 'failed' }).run();
});

test('recovery: refuses when the intent is too young or any matching transaction exists on-chain', async () => {
  const young = openIntent(30_000);
  const y = await operatorFailIntent(emptyReader(), young);
  assert.ok(!y.ok && /younger than 5 minutes/.test(y.reason));
  assert.equal(status(young).status, 'submitted');
  db.update(schema.payments).set({ status: 'failed' }).run();

  const old = openIntent(20 * 60_000);
  const landed: ObservedLog = { token: TOKEN, txHash: '0x' + 'f0'.repeat(32), logIndex: 1, blockNumber: 300, blockHash: '0x1', from: FROM, to: TO, value: 1_000_000n };
  const f = await operatorFailIntent(emptyReader([landed]), old);
  assert.ok(!f.ok && /NOT safe to mark failed/.test(f.reason));
  assert.equal(f.ok ? '' : f.report?.transferMatches[0]?.txHash, landed.txHash);
  assert.equal(status(old).status, 'submitted', 'left for the normal resolver');
  assert.equal((await operatorFailIntent(emptyReader(), 'missing')).ok, false);
});

// ---------------------------------------------------------------- demo:prepare refusal rules
test('demo:prepare planning: refuses over the cap or when the sender cannot cover amounts plus estimated fees', () => {
  const base = { amountRaw: 5_000_000n, usernames: ['alice', 'bob'], estFeeRaw: 3000n };
  assert.equal(planFunding({ ...base, senderBalanceRaw: 10_006_000n }).ok, true, 'exactly enough');
  const short = planFunding({ ...base, senderBalanceRaw: 10_005_999n });
  assert.ok(!short.ok && /needed/.test(short.error), 'one micro-USDC short is refused');
  const cap = planFunding({ amountRaw: 10_000_001n, usernames: ['a1x', 'b2x'], senderBalanceRaw: 1_000_000_000n, estFeeRaw: 3000n });
  assert.ok(!cap.ok && /cap/.test(cap.error), 'above 20 USDC total is refused even with plenty of balance');
  assert.equal(planFunding({ amountRaw: MAX_FUND_PER_RUN_RAW, usernames: ['solo'], senderBalanceRaw: 21_000_000n, estFeeRaw: 3000n }).ok, true, 'the cap itself is allowed');
  assert.equal(planFunding({ ...base, usernames: [], senderBalanceRaw: 99_000_000n }).ok, false);
  assert.equal(planFunding({ ...base, usernames: ['bad name!'], senderBalanceRaw: 99_000_000n }).ok, false);
  const dedup = planFunding({ ...base, usernames: ['alice', 'alice'], senderBalanceRaw: 99_000_000n });
  assert.ok(dedup.ok && dedup.usernames.length === 1 && dedup.totalRaw === 5_000_000n, 'duplicate names are funded once');
});
