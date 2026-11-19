import { addUser, db, schema } from './helpers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USDC_ADDRESS } from '../lib/chain';
import { CURSOR_KEY, confirmOnce, scanOnce } from '../lib/worker/scanner';
import type { ChainReader, ObservedLog, ReceiptInfo } from '../lib/worker/types';
import { eq } from 'drizzle-orm';

const TOKEN = USDC_ADDRESS.toLowerCase();
const WALLET = '0x' + 'a1'.repeat(20);
const STRANGER = '0x' + 'b2'.repeat(20);
const SENDER = '0x' + 'c3'.repeat(20);

const log = (block: number, logIndex: number, to = WALLET, token = TOKEN): ObservedLog => ({
  token, txHash: '0x' + block.toString(16).padStart(60, '0') + logIndex.toString(16).padStart(4, '0'), logIndex,
  blockNumber: block, blockHash: '0x' + 'ee'.repeat(32), from: SENDER, to, value: 1_000_000n,
});

function fakeChain(head: number, logs: ObservedLog[], failAfterLogCalls = Infinity) {
  let calls = 0;
  const reader: ChainReader = {
    getBlockNumber: async () => head,
    getTransferLogs: async ({ fromBlock, toBlock, recipients }) => {
      if (++calls > failAfterLogCalls) throw new Error('simulated process death');
      return logs.filter((l) => l.token === TOKEN && l.blockNumber >= fromBlock && l.blockNumber <= toBlock && recipients.includes(l.to));
    },
    getBlockTimestamp: async (b) => 1_700_000_000 + b,
    getReceipt: async (hash): Promise<ReceiptInfo | null> => {
      const l = logs.find((x) => x.txHash === hash);
      return l ? { status: 'success', blockNumber: l.blockNumber, blockHash: l.blockHash, transfers: [{ token: l.token, logIndex: l.logIndex, from: l.from, to: l.to, value: l.value }] } : null;
    },
  };
  return reader;
}

const rows = () => db.select().from(schema.transfers).all();
const cursor = () => db.select().from(schema.chainCursors).where(eq(schema.chainCursors.key, CURSOR_KEY)).get()?.lastBlock;
addUser('alice', WALLET);

test('deposit dedup: replayed scans and repeated logs create exactly one record each', async () => {
  const chain = fakeChain(100, [log(95, 0), log(95, 1)]);
  await scanOnce(chain, { startLookback: 100, replayOverlap: 10, maxRange: 50 });
  await scanOnce(chain, { startLookback: 100, replayOverlap: 10, maxRange: 50 }); // overlap re-reads block 95
  await scanOnce(chain, { startLookback: 100, replayOverlap: 10, maxRange: 50 });
  const r = rows().filter((t) => t.blockNumber === 95);
  assert.equal(r.length, 2, 'two distinct logs in one tx block stay two rows');
  assert.equal(new Set(r.map((t) => `${t.txHash}:${t.logIndex}`)).size, 2);
  assert.ok(r.every((t) => t.kind === 'deposit' && t.userId === 'id-alice' && t.blockTimestamp === 1_700_000_095));
  db.delete(schema.transfers).run();
  db.delete(schema.chainCursors).run();
});

test('cursor restart: a crash mid-scan loses and duplicates nothing; other tokens, recipients ignored', async () => {
  const wanted = [log(30, 0), log(60, 0), log(60, 1), log(130, 0), log(199, 0)];
  const noise = [log(70, 0, STRANGER), log(80, 0, WALLET, '0x' + 'dd'.repeat(20))];
  const logs = [...wanted, ...noise];

  await assert.rejects(scanOnce(fakeChain(200, logs, 3), { startLookback: 200, replayOverlap: 5, maxRange: 25 }), /simulated process death/);
  const mid = cursor();
  assert.equal(mid, 74, 'cursor sits at the last range committed before the crash (ranges 0-24, 25-49, 50-74)');
  assert.ok(rows().every((t) => t.blockNumber <= mid!), 'no row beyond the committed cursor');

  await scanOnce(fakeChain(200, logs), { startLookback: 200, replayOverlap: 5, maxRange: 25 }); // restart
  const keys = rows().map((t) => `${t.txHash}:${t.logIndex}`).sort();
  assert.deepEqual(keys, wanted.map((l) => `${l.txHash}:${l.logIndex}`).sort(), 'exactly the wanted logs, once each');
  assert.equal(cursor(), 200);

  const c = await confirmOnce(fakeChain(200, logs), { confirmations: 3 });
  assert.equal(c.confirmed, 4);
  assert.equal(rows().find((t) => t.blockNumber === 199)?.status, 'observed', 'depth 1 is not confirmed yet');
  await confirmOnce(fakeChain(202, logs), { confirmations: 3 });
  assert.equal(rows().find((t) => t.blockNumber === 199)?.status, 'confirmed');
});
