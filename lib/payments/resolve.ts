import { and, eq, inArray, ne } from 'drizzle-orm';
import { CHAIN_ID, USDC_ADDRESS } from '../chain';
import { db } from '../db';
import { payments, transfers } from '../db/schema';
import { collectLogs, CONFIRMATIONS, REPLAY_OVERLAP } from '../worker/scanner';
import type { ChainReader, ReceiptInfo } from '../worker/types';
import type { TransactionHint } from '../wallet-adapter/types';

const TOKEN = USDC_ADDRESS.toLowerCase();
export const STUCK_AFTER_MS = 5 * 60 * 1000;
const HINT_MIN_INTERVAL_MS = 10_000;

type Intent = typeof payments.$inferSelect;
export type Verification =
  | { ok: true; actualFeeRaw: bigint }
  | { ok: false; reason: 'reverted' | 'no_matching_transfer' | 'ambiguous_transfer'; actualFeeRaw: bigint };

/**
 * Verifies an outgoing transfer against its receipt. A send produces TWO USDC Transfer logs from the sender (the
 * payment and the fee), so we pick the one that matches the intended from, to and value EXACTLY, require that exactly
 * one does, and treat the sender's other USDC transfers in the same transaction as the actual network fee.
 */
export function verifyOutgoing(receipt: ReceiptInfo, p: Pick<Intent, 'fromAddress' | 'toAddress' | 'amountRaw'>): Verification {
  const usdc = receipt.transfers.filter((t) => t.token === TOKEN);
  const matches = usdc.filter((t) => t.from === p.fromAddress && t.to === p.toAddress && t.value.toString() === p.amountRaw);
  const feeOf = (payment?: (typeof usdc)[number]) =>
    usdc.filter((t) => t.from === p.fromAddress && t !== payment).reduce((sum, t) => sum + t.value, 0n);
  if (receipt.status !== 'success') return { ok: false, reason: 'reverted', actualFeeRaw: 0n };
  if (matches.length === 0) return { ok: false, reason: 'no_matching_transfer', actualFeeRaw: feeOf() };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous_transfer', actualFeeRaw: 0n };
  return { ok: true, actualFeeRaw: feeOf(matches[0]) };
}

/** Attaches the resolved intent to the recipient's observed transfer (idempotent; either order with the worker). */
export function claimTransfer(p: Pick<Intent, 'id' | 'txHash' | 'fromAddress' | 'toAddress' | 'amountRaw'>) {
  if (!p.txHash) return 0;
  return db
    .update(transfers)
    .set({ claimedIntentId: p.id, kind: 'receipt' })
    .where(and(eq(transfers.chainId, CHAIN_ID), eq(transfers.txHash, p.txHash), eq(transfers.fromAddress, p.fromAddress), eq(transfers.toAddress, p.toAddress), eq(transfers.amountRaw, p.amountRaw)))
    .run().changes;
}

export interface ResolveDeps {
  hint?: (transactionId: string) => Promise<TransactionHint | null>; // provider status lookup (hint only)
  confirmations?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const lastHint = new Map<string, number>();

/**
 * One pass over unresolved intents. Chain first: UserOperationEvent by user-operation hash, then a USDC Transfer
 * log match. Confirmed only after a successful receipt with exactly one exact Transfer match and enough depth.
 * Never resubmits anything.
 */
export async function resolvePayments(reader: ChainReader, deps: ResolveDeps = {}): Promise<{ confirmed: number; failed: number; open: number }> {
  const confirmations = deps.confirmations ?? CONFIRMATIONS;
  const now = deps.now ?? Date.now;
  const open = db.select().from(payments).where(inArray(payments.status, ['created', 'submitted'])).all();
  const out = { confirmed: 0, failed: 0, open: 0 };
  if (open.length === 0) return out;
  const head = await reader.getBlockNumber();

  for (const p of open) {
    try {
      const done = await resolveOne(reader, p, head, confirmations, now, deps);
      if (done === 'confirmed') out.confirmed++;
      else if (done === 'failed') out.failed++;
      else out.open++;
    } catch (e) {
      out.open++;
      console.error('[resolver] pass failed for payment', p.id, e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    }
  }
  return out;
}

async function resolveOne(reader: ChainReader, p: Intent, head: number, confirmations: number, now: () => number, deps: ResolveDeps): Promise<'confirmed' | 'failed' | 'open'> {
  const set = (v: Partial<Intent>) => db.update(payments).set(v).where(eq(payments.id, p.id)).run();
  let userOpHash = p.userOpHash;
  let txHash = p.txHash;
  let source: 'stored' | 'event' | 'transfer-log' | 'hint' = txHash ? 'stored' : 'event';
  let opSuccess: boolean | undefined;
  let hintHash: string | undefined;

  // 1. Provider status lookup: a HINT (extra info, rate-limited). Never decides the outcome by itself.
  if (!txHash && p.transactionId && deps.hint && now() - (lastHint.get(p.id) ?? 0) >= HINT_MIN_INTERVAL_MS) {
    lastHint.set(p.id, now());
    try {
      const h = await deps.hint(p.transactionId);
      if (h) {
        set({ providerStatus: h.status ?? null });
        hintHash = h.txHash?.toLowerCase();
        if (!userOpHash && h.userOperationHash) {
          userOpHash = h.userOperationHash.toLowerCase();
          set({ userOpHash });
        }
      }
    } catch {
      /* hints are optional */
    }
  }

  const from = Math.max(p.startBlock, (p.scanCursor ?? p.startBlock) - REPLAY_OVERLAP);

  // 2. Chain: the EntryPoint's UserOperationEvent for our user operation hash.
  if (!txHash && userOpHash) {
    const events = await collectLogs(from, head, (f, t) => reader.getUserOperationEvents({ userOpHash: userOpHash!, fromBlock: f, toBlock: t }), deps.sleep);
    if (events.length) {
      txHash = events[0].txHash;
      opSuccess = events[0].success;
      source = 'event';
    }
  }

  // 3. Fallback: a USDC Transfer log from our wallet to the destination with the exact amount, not claimed by another intent.
  if (!txHash) {
    const taken = new Set(db.select({ h: payments.txHash }).from(payments).where(and(ne(payments.id, p.id))).all().map((r) => r.h).filter(Boolean));
    const logs = await collectLogs(from, head, (f, t) => reader.getTransferLogs({ fromBlock: f, toBlock: t, recipients: [p.toAddress] }), deps.sleep);
    const match = logs
      .filter((l) => l.from === p.fromAddress && l.value.toString() === p.amountRaw && !taken.has(l.txHash))
      .sort((a, b) => a.blockNumber - b.blockNumber)[0];
    if (match) {
      txHash = match.txHash;
      source = 'transfer-log';
    }
  }

  // 4. An unverified provider hash is only used to look at a receipt; it is discarded if it does not match.
  if (!txHash && hintHash) {
    txHash = hintHash;
    source = 'hint';
  }

  if (!txHash) {
    set({ scanCursor: head });
    return 'open';
  }

  const receipt = await reader.getReceipt(txHash);
  if (!receipt) {
    if (source !== 'hint') set({ txHash, scanCursor: head });
    return 'open';
  }
  const v = verifyOutgoing(receipt, p);

  if (!v.ok && source === 'hint') {
    set({ scanCursor: head }); // the hint hash was not our transaction; ignore it
    return 'open';
  }
  if (opSuccess === false || !v.ok) {
    const reason = opSuccess === false ? 'The user operation reported failure.' : v.ok ? '' : `Verification failed: ${v.reason}.`;
    set({ status: 'failed', txHash, error: reason, actualFeeRaw: v.actualFeeRaw > 0n ? v.actualFeeRaw.toString() : null, resolvedAt: now() });
    return 'failed';
  }
  if (head - receipt.blockNumber < confirmations) {
    set({ txHash, scanCursor: head }); // found and valid; waiting for depth
    return 'open';
  }
  set({ status: 'confirmed', txHash, actualFeeRaw: v.actualFeeRaw.toString(), error: null, resolvedAt: now() });
  claimTransfer({ id: p.id, txHash, fromAddress: p.fromAddress, toAddress: p.toAddress, amountRaw: p.amountRaw });
  return 'confirmed';
}

// ---------------------------------------------------------------------------------------------------------------
// Recovery tooling support (scripts/intents.ts). Nothing here ever resubmits a transfer.
// ---------------------------------------------------------------------------------------------------------------

export interface IntentInspection {
  intentId: string;
  status: Intent['status'];
  ageMs: number;
  searchedFrom: number;
  searchedTo: number;
  userOpHash: string | null;
  userOpEvents: { txHash: string; blockNumber: number; success: boolean }[];
  transferSearch: { recipient: string; from: string; amountRaw: string };
  transferMatches: { txHash: string; blockNumber: number }[];
  candidateTx: string | null; // the transaction that would be verified, if any trace exists
  receipt: 'none' | 'success' | 'reverted';
  verification: Verification | null;
}

/** Read-only: searches the whole range from the intent's start block for any on-chain trace of it. */
export async function inspectIntent(reader: ChainReader, p: Intent, head: number, deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<IntentInspection> {
  const now = deps.now ?? Date.now;
  const userOpEvents = p.userOpHash
    ? await collectLogs(p.startBlock, head, (f, t) => reader.getUserOperationEvents({ userOpHash: p.userOpHash!, fromBlock: f, toBlock: t }), deps.sleep)
    : [];
  const taken = new Set(db.select({ h: payments.txHash }).from(payments).where(ne(payments.id, p.id)).all().map((r) => r.h).filter(Boolean));
  const logs = await collectLogs(p.startBlock, head, (f, t) => reader.getTransferLogs({ fromBlock: f, toBlock: t, recipients: [p.toAddress] }), deps.sleep);
  const transferMatches = logs
    .filter((l) => l.from === p.fromAddress && l.value.toString() === p.amountRaw && !taken.has(l.txHash))
    .map((l) => ({ txHash: l.txHash, blockNumber: l.blockNumber }));
  const candidateTx = p.txHash ?? userOpEvents[0]?.txHash ?? transferMatches[0]?.txHash ?? null;
  const receipt = candidateTx ? await reader.getReceipt(candidateTx) : null;
  return {
    intentId: p.id,
    status: p.status,
    ageMs: now() - p.createdAt,
    searchedFrom: p.startBlock,
    searchedTo: head,
    userOpHash: p.userOpHash,
    userOpEvents,
    transferSearch: { recipient: p.toAddress, from: p.fromAddress, amountRaw: p.amountRaw },
    transferMatches,
    candidateTx,
    receipt: receipt ? receipt.status : 'none',
    verification: receipt ? verifyOutgoing(receipt, p) : null,
  };
}

/** Re-runs the normal chain check for one intent (same code path as the worker). */
export async function resolveIntent(reader: ChainReader, id: string, deps: ResolveDeps = {}): Promise<{ result: 'confirmed' | 'failed' | 'open' | 'not-open' | 'not-found'; head: number }> {
  const p = db.select().from(payments).where(eq(payments.id, id)).get();
  if (!p) return { result: 'not-found', head: 0 };
  if (p.status !== 'created' && p.status !== 'submitted') return { result: 'not-open', head: 0 };
  const head = await reader.getBlockNumber();
  return { result: await resolveOne(reader, p, head, deps.confirmations ?? CONFIRMATIONS, deps.now ?? Date.now, deps), head };
}

export const OPERATOR_FAIL_MIN_AGE_MS = STUCK_AFTER_MS;

export type OperatorFailResult = { ok: true; report: IntentInspection } | { ok: false; reason: string; report?: IntentInspection };

/**
 * Operator override for an intent with no on-chain trace: marks it failed (which frees the wallet) ONLY IF the
 * intent is old enough AND the full search finds nothing. It never resubmits. Late landing risk: if the provider
 * somehow lands it later, the worker will still record the incoming transfer as an unclaimed receipt.
 */
export async function operatorFailIntent(reader: ChainReader, id: string, deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<OperatorFailResult> {
  const now = deps.now ?? Date.now;
  const p = db.select().from(payments).where(eq(payments.id, id)).get();
  if (!p) return { ok: false, reason: 'No such intent.' };
  if (p.status !== 'created' && p.status !== 'submitted') return { ok: false, reason: `Intent is already ${p.status}.` };
  const head = await reader.getBlockNumber();
  const report = await inspectIntent(reader, p, head, deps);
  if (report.candidateTx) return { ok: false, report, reason: 'A matching transaction exists on-chain, so it is NOT safe to mark failed. Run intents:resolve without the flag and wait for it to confirm.' };
  if (report.ageMs < OPERATOR_FAIL_MIN_AGE_MS) return { ok: false, report, reason: 'The intent is younger than 5 minutes. Wait, then check again.' };
  db.update(payments)
    .set({ status: 'failed', error: `Marked failed by operator: no matching transaction found on-chain between blocks ${report.searchedFrom} and ${report.searchedTo}.`, resolvedAt: now() })
    .where(and(eq(payments.id, id), inArray(payments.status, ['created', 'submitted'])))
    .run();
  return { ok: true, report };
}
