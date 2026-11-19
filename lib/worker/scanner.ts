import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { CHAIN_ID, USDC_ADDRESS } from '../chain';
import { db } from '../db';
import { chainCursors, transfers, users, wallets } from '../db/schema';
import type { ChainReader, ObservedLog } from './types';

// Named constants (tunable).
export const CONFIRMATIONS = 3; // blocks of depth before a transfer is confirmed
export const REPLAY_OVERLAP = 10; // blocks re-scanned on every pass and restart
export const MAX_BLOCK_RANGE = 2000;
export const RECIPIENT_BATCH = 50; // recipients per getLogs call
export const DROP_AFTER_DEPTH = 50; // no receipt this deep means the log was reorged away
export const DEFAULT_START_LOOKBACK = 2000; // first run starts this many blocks behind head (env WORKER_START_LOOKBACK)

const TOKEN = USDC_ADDRESS.toLowerCase();
export const CURSOR_KEY = `deposits:${CHAIN_ID}:${TOKEN}`;

export interface ScanOptions {
  startLookback?: number;
  maxRange?: number;
  replayOverlap?: number;
  confirmations?: number;
  dropAfterDepth?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const status = (e: unknown) => (e as { status?: number } | null)?.status;

export const isRateLimit = (e: unknown) =>
  status(e) === 429 || /429|rate.?limit|too many requests|quota/i.test(msg(e));
export const isRangeError = (e: unknown) =>
  !isRateLimit(e) && /range|limit|too many|more than|exceed|response size|too large/i.test(msg(e));

/** Retries RPC rate limits with exponential backoff and jitter; other errors propagate. */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  { retries = 6, baseMs = 500, sleep = defaultSleep }: { retries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e) || attempt >= retries) throw e;
      await sleep(Math.min(30_000, baseMs * 2 ** attempt) * (0.5 + Math.random() / 2));
    }
  }
}

const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function fetchRange(reader: ChainReader, from: number, head: number, maxRange: number, recipients: string[], sleep: (ms: number) => Promise<void>) {
  let size = maxRange;
  for (;;) {
    const to = Math.min(from + size - 1, head);
    try {
      const logs: ObservedLog[] = [];
      for (const batch of chunk(recipients, RECIPIENT_BATCH)) {
        logs.push(...(await withBackoff(() => reader.getTransferLogs({ fromBlock: from, toBlock: to, recipients: batch }), { sleep })));
      }
      return { to, logs };
    } catch (e) {
      if (size > 1 && isRangeError(e)) {
        size = Math.max(1, Math.floor(size / 2)); // provider rejected the range: retry smaller
        continue;
      }
      throw e;
    }
  }
}

export interface ScanStats { from: number; to: number; changed: number }

/**
 * One scan pass. Every committed range inserts its transfers and advances the cursor in ONE transaction,
 * so a crash can never leave the cursor ahead of unrecorded transfers. Re-scans overlap, and the unique
 * (chain, token, tx hash, log index) key makes replays harmless.
 */
export async function scanOnce(reader: ChainReader, opts: ScanOptions = {}): Promise<ScanStats> {
  const o = { startLookback: DEFAULT_START_LOOKBACK, maxRange: MAX_BLOCK_RANGE, replayOverlap: REPLAY_OVERLAP, sleep: defaultSleep, ...opts };
  const rows = db
    .select({ address: wallets.address, userId: wallets.userId })
    .from(wallets)
    .innerJoin(users, eq(users.id, wallets.userId))
    .where(eq(users.status, 'active'))
    .all();
  const owner = new Map(rows.map((r) => [r.address.toLowerCase(), r.userId]));
  const recipients = [...owner.keys()];

  const head = await withBackoff(() => reader.getBlockNumber(), { sleep: o.sleep });
  const cursor = db.select().from(chainCursors).where(eq(chainCursors.key, CURSOR_KEY)).get();
  let from = cursor ? Math.max(0, cursor.lastBlock - o.replayOverlap + 1) : Math.max(0, head - o.startLookback);
  const stats: ScanStats = { from, to: from - 1, changed: 0 };

  while (from <= head) {
    const { to, logs } = recipients.length
      ? await fetchRange(reader, from, head, o.maxRange, recipients, o.sleep)
      : { to: Math.min(from + o.maxRange - 1, head), logs: [] as ObservedLog[] };

    const mine = logs.filter((l) => l.token === TOKEN && owner.has(l.to));
    const stamps = new Map<number, number>();
    for (const bn of new Set(mine.map((l) => l.blockNumber))) {
      stamps.set(bn, await withBackoff(() => reader.getBlockTimestamp(bn), { sleep: o.sleep }));
    }

    const now = Date.now();
    stats.changed += db.transaction((tx) => {
      let n = 0;
      for (const l of mine) {
        n += tx
          .insert(transfers)
          .values({
            id: randomUUID(),
            chainId: CHAIN_ID,
            token: TOKEN,
            txHash: l.txHash,
            logIndex: l.logIndex,
            blockNumber: l.blockNumber,
            blockHash: l.blockHash,
            blockTimestamp: stamps.get(l.blockNumber) ?? null,
            fromAddress: l.from,
            toAddress: l.to,
            userId: owner.get(l.to)!,
            amountRaw: l.value.toString(),
            status: 'observed',
            kind: 'deposit', // later sends claim their own transfer by known tx hash
            observedAt: now,
          })
          .onConflictDoUpdate({
            target: [transfers.chainId, transfers.token, transfers.txHash, transfers.logIndex],
            set: { blockNumber: l.blockNumber, blockHash: l.blockHash, blockTimestamp: stamps.get(l.blockNumber) ?? null, status: 'observed', confirmedAt: null },
            setWhere: eq(transfers.status, 'dropped'), // re-observed after a reorg
          })
          .run().changes;
      }
      tx.insert(chainCursors)
        .values({ key: CURSOR_KEY, lastBlock: to, updatedAt: now })
        .onConflictDoUpdate({ target: chainCursors.key, set: { lastBlock: sql`max(${chainCursors.lastBlock}, ${to})`, updatedAt: now } })
        .run();
      return n;
    });
    stats.to = to;
    from = to + 1;
  }
  return stats;
}

/** Confirms observed transfers: successful receipt containing the exact log, at least `confirmations` deep. */
export async function confirmOnce(reader: ChainReader, opts: ScanOptions = {}): Promise<{ confirmed: number; dropped: number }> {
  const o = { confirmations: CONFIRMATIONS, dropAfterDepth: DROP_AFTER_DEPTH, sleep: defaultSleep, ...opts };
  const head = await withBackoff(() => reader.getBlockNumber(), { sleep: o.sleep });
  const pending = db.select().from(transfers).where(and(eq(transfers.status, 'observed'), eq(transfers.chainId, CHAIN_ID))).all();
  const out = { confirmed: 0, dropped: 0 };

  for (const row of pending) {
    const depth = head - row.blockNumber;
    if (depth < o.confirmations) continue;
    const receipt = await withBackoff(() => reader.getReceipt(row.txHash), { sleep: o.sleep });
    const drop = () => {
      db.update(transfers).set({ status: 'dropped' }).where(eq(transfers.id, row.id)).run();
      out.dropped++;
    };
    if (!receipt) {
      if (depth >= o.dropAfterDepth) drop();
      continue;
    }
    const match =
      receipt.status === 'success' &&
      receipt.transfers.some(
        (t) => t.logIndex === row.logIndex && t.token === row.token && t.from === row.fromAddress && t.to === row.toAddress && t.value.toString() === row.amountRaw,
      );
    if (!match) {
      drop();
      continue;
    }
    const confirmed = head - receipt.blockNumber >= o.confirmations;
    db.update(transfers)
      .set({ blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, ...(confirmed ? { status: 'confirmed' as const, confirmedAt: Date.now() } : {}) })
      .where(eq(transfers.id, row.id))
      .run();
    if (confirmed) out.confirmed++;
  }
  return out;
}
