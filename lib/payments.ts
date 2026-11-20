import { createHash, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { formatUsdc, parseNote } from './amount';
import { getUsdcBalance, publicClient } from './chain';
import { db } from './db';
import { moneyRequests, payments, quotes, wallets } from './db/schema';
import { areAcceptedFriends } from './friends';
import { fail, type Failure, validateWithdrawAddress } from './quotes';
import { hit, RATE_LIMITS } from './ratelimit';
import { stateOf } from './requests';
import { getWalletAdapter } from './wallet-adapter';
import { ProviderRejectedError, type WalletAdapter } from './wallet-adapter/types';

export type Payment = typeof payments.$inferSelect;
export type PaymentResult = { ok: true; replay: boolean; payment: Payment } | Failure;

export interface PaymentDeps {
  adapter: Pick<WalletAdapter, 'sendUsdcTransfer'>;
  getBalance(address: string): Promise<bigint>;
  head(): Promise<number>;
  now(): number;
}

export const realDeps = (): PaymentDeps => ({
  adapter: getWalletAdapter(),
  getBalance: async (a) => (await getUsdcBalance(a, { fresh: true })).raw,
  head: async () => Number(await publicClient.getBlockNumber()),
  now: () => Date.now(),
});

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const isUnique = (e: unknown) => e instanceof Error && 'code' in e && String(e.code).startsWith('SQLITE_CONSTRAINT');

/**
 * Submits one send or withdrawal from a previously issued quote.
 *  - Idempotency (per user): same key + same payload returns the original; same key + different payload is 409.
 *  - The intent is persisted (and the quote consumed) BEFORE the provider is called.
 *  - One unresolved intent per sender wallet (sends and withdrawals together), enforced by a partial unique index.
 *  - Never retries the provider. An unclear provider outcome stays `submitted` for the chain resolver.
 */
export async function submitPayment(
  userId: string,
  input: { quoteId: string; idempotencyKey: string; note?: unknown; requestId?: unknown },
  deps: PaymentDeps = realDeps(),
): Promise<PaymentResult> {
  if (!KEY_RE.test(String(input.idempotencyKey ?? ''))) return fail(422, 'invalid_key', 'A valid idempotency key is required.');
  const key = input.idempotencyKey;
  const note = parseNote(input.note);
  if (!note.ok) return fail(422, 'invalid_note', note.error);

  const quote = db.select().from(quotes).where(and(eq(quotes.id, String(input.quoteId ?? '')), eq(quotes.userId, userId))).get();
  if (!quote) return fail(404, 'quote_not_found', 'Quote not found. Request a new quote.');
  const kind = quote.op === 'send' ? 'send' : 'withdrawal';
  // A payment that pays a money request is tied to it in the hash; ordinary payments hash exactly as before.
  const requestId = input.requestId ? String(input.requestId) : null;
  const payloadHash = createHash('sha256').update(JSON.stringify(requestId ? [kind, quote.recipientKey, quote.amountRaw, note.note, requestId] : [kind, quote.recipientKey, quote.amountRaw, note.note])).digest('hex');

  // Replays come first so they never need a live quote, a balance, or rate-limit budget.
  const existing = db.select().from(payments).where(and(eq(payments.userId, userId), eq(payments.idempotencyKey, key))).get();
  if (existing) {
    return existing.payloadHash === payloadHash
      ? { ok: true, replay: true, payment: existing }
      : fail(409, 'idempotency_conflict', 'This idempotency key was already used for a different transfer.');
  }

  if (!hit(`send:user:${userId}`, RATE_LIMITS.sendsPerMinutePerUser, RATE_LIMITS.shortWindowMs)) {
    return fail(429, 'rate_limited', 'Too many transfers. Wait a minute and try again.');
  }
  if (quote.consumedAt) return fail(410, 'quote_used', 'This quote was already used. Request a new quote.');
  if (deps.now() > quote.expiresAt) return fail(410, 'quote_expired', 'The quote expired. Review the new quote and confirm again.');

  // Paying a money request: only its payer, only while it is open, only to its requester, only for its exact amount.
  if (requestId) {
    const req = db.select().from(moneyRequests).where(and(eq(moneyRequests.id, requestId), eq(moneyRequests.payerId, userId))).get();
    if (!req || stateOf(req, deps.now()) !== 'pending' || kind !== 'send' || quote.recipientKey !== req.requesterId || quote.amountRaw !== req.amountRaw) {
      return fail(409, 'request_unavailable', 'This money request can no longer be paid. It may have expired, been cancelled, or already be paid.');
    }
  }

  const sender = db.select().from(wallets).where(eq(wallets.userId, userId)).get();
  if (!sender) return fail(409, 'no_wallet', 'Your wallet is not ready.');

  // Re-check the destination at submit time, not just at quote time.
  let toAddress: string;
  let recipientUserId: string | null = null;
  if (kind === 'send') {
    const rw = db.select().from(wallets).where(eq(wallets.userId, quote.recipientKey)).get();
    if (!areAcceptedFriends(userId, quote.recipientKey) || !rw) return fail(403, 'not_friends', 'You can only send to accepted friends.');
    toAddress = rw.address;
    recipientUserId = quote.recipientKey;
  } else {
    const dest = validateWithdrawAddress(quote.recipientKey);
    if (!dest.ok) return dest;
    toAddress = dest.address;
  }

  const amount = BigInt(quote.amountRaw);
  const estFee = BigInt(quote.estFeeRaw);
  const balance = await deps.getBalance(sender.address); // fresh chain read, not the cache
  if (balance < amount + estFee) {
    return fail(422, 'insufficient_balance', `Your balance is ${formatUsdc(balance)} USDC, but this needs ${formatUsdc(amount + estFee)} USDC (amount plus estimated network fee).`);
  }

  const startBlock = await deps.head();
  const id = randomUUID();
  try {
    db.transaction((tx) => {
      const consumed = tx.update(quotes).set({ consumedAt: deps.now() }).where(and(eq(quotes.id, quote.id), isNull(quotes.consumedAt))).run();
      if (consumed.changes !== 1) throw new Error('QUOTE_USED');
      if (requestId) {
        // Atomic claim: only one payment can be linked to an open request at a time (a failed one can be replaced).
        const claimed = tx
          .update(moneyRequests)
          .set({ paymentId: id })
          .where(and(eq(moneyRequests.id, requestId), eq(moneyRequests.payerId, userId), eq(moneyRequests.status, 'pending'), gt(moneyRequests.expiresAt, deps.now()), sql`(${moneyRequests.paymentId} is null or ${moneyRequests.paymentId} in (select id from payments where status = 'failed'))`))
          .run();
        if (claimed.changes !== 1) throw new Error('REQUEST_UNAVAILABLE');
      }
      tx.insert(payments)
        .values({
          id, userId, kind, fromAddress: sender.address, recipientUserId, toAddress,
          amountRaw: quote.amountRaw, note: note.note, estFeeRaw: quote.estFeeRaw,
          status: 'created', idempotencyKey: key, payloadHash, quoteId: quote.id,
          startBlock, createdAt: deps.now(),
        })
        .run();
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'QUOTE_USED') return fail(410, 'quote_used', 'This quote was already used. Request a new quote.');
    if (e instanceof Error && e.message === 'REQUEST_UNAVAILABLE') return fail(409, 'request_unavailable', 'This money request can no longer be paid. It may have expired, been cancelled, or already be paid.');
    if (isUnique(e)) {
      const msg = (e as Error).message;
      if (msg.includes('idempotency_key')) {
        const again = db.select().from(payments).where(and(eq(payments.userId, userId), eq(payments.idempotencyKey, key))).get();
        if (again && again.payloadHash === payloadHash) return { ok: true, replay: true, payment: again };
        return fail(409, 'idempotency_conflict', 'This idempotency key was already used for a different transfer.');
      }
      return fail(409, 'transfer_in_progress', 'You already have a transfer in progress. Wait for it to finish.');
    }
    throw e;
  }

  // The intent is durable. Now (and only now) call the provider, exactly once.
  const set = (v: Partial<Payment>) => db.update(payments).set(v).where(eq(payments.id, id)).run();
  try {
    const r = await deps.adapter.sendUsdcTransfer({ providerWalletId: sender.providerWalletId, to: toAddress, amountRaw: amount, referenceId: id });
    set({
      status: 'submitted', submittedAt: deps.now(), transactionId: r.transactionId ?? null,
      userOpHash: r.userOperationHash?.toLowerCase() ?? null, txHash: null, // the provider hash is only a hint; the chain decides
    });
  } catch (e) {
    if (e instanceof ProviderRejectedError) {
      set({ status: 'failed', error: `Rejected by wallet provider: ${e.message}`.slice(0, 300), resolvedAt: deps.now() });
    } else {
      // Unknown outcome (timeout, 5xx, network): do NOT mark failed and do NOT resend. The resolver checks the chain.
      set({ status: 'submitted', submittedAt: deps.now(), error: 'Provider response unclear; verifying on chain.' });
    }
  }
  return { ok: true, replay: false, payment: db.select().from(payments).where(eq(payments.id, id)).get()! };
}
