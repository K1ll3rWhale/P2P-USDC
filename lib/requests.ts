import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, or } from 'drizzle-orm';
import { formatUsdc, parseNote, parseUsdcAmount } from './amount';
import { db } from './db';
import { moneyRequests, payments, users } from './db/schema';
import { getAcceptedFriendByUsername } from './friends';
import { hit, RATE_LIMITS } from './ratelimit';

// Expiry is chosen by the requester, in whole days.
export const EXPIRY_MIN_DAYS = 1;
export const EXPIRY_DEFAULT_DAYS = 7;
export const EXPIRY_MAX_DAYS = 365;
export const MAX_PENDING_PER_PAIR = 5;
export const REMIND_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpiryResult = { days: number; warning?: string };

/**
 * Empty input means the default (7 days). Below the minimum becomes the minimum, above the maximum becomes the
 * maximum, and anything that is not a whole number becomes the default; each of those carries a warning to show.
 */
export function parseExpiryDays(input: unknown): ExpiryResult {
  const s = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : '';
  if (s === '') return { days: EXPIRY_DEFAULT_DAYS };
  if (!/^-?\d{1,9}$/.test(s)) {
    return { days: EXPIRY_DEFAULT_DAYS, warning: `Expiry must be a whole number of days, so it was set to the default of ${EXPIRY_DEFAULT_DAYS} days.` };
  }
  const n = Number(s);
  if (n < EXPIRY_MIN_DAYS) {
    return { days: EXPIRY_MIN_DAYS, warning: `Expiry must be at least ${EXPIRY_MIN_DAYS} day, so it was set to ${EXPIRY_MIN_DAYS} day.` };
  }
  if (n > EXPIRY_MAX_DAYS) {
    return { days: EXPIRY_MAX_DAYS, warning: `Expiry can be at most ${EXPIRY_MAX_DAYS} days, so it was set to ${EXPIRY_MAX_DAYS} days.` };
  }
  return { days: n };
}

export type RequestResult = { ok: true; warning?: string } | { ok: false; error: string };
const NOT_FOUND = { ok: false, error: 'Request not found.' } as const;

type Row = typeof moneyRequests.$inferSelect;
export type RequestState = 'pending' | 'paying' | 'paid' | 'declined' | 'cancelled' | 'expired';

/**
 * The request's state for display and for deciding whether it can be paid. A request whose linked payment failed
 * counts as pending again (the payer can retry); one whose payment is unresolved is "paying"; confirmed is "paid".
 */
export function stateOf(row: Row, now: number): RequestState {
  if (row.status === 'declined' || row.status === 'cancelled') return row.status;
  if (row.paymentId) {
    const p = db.select({ status: payments.status }).from(payments).where(eq(payments.id, row.paymentId)).get();
    if (p?.status === 'confirmed') return 'paid';
    if (p && p.status !== 'failed') return 'paying';
  }
  return row.expiresAt <= now ? 'expired' : 'pending';
}

/** Creates a request to an accepted friend. The actor always comes from the session, never from the form. */
export function createMoneyRequest(
  actorId: string,
  input: { friend: string; amount: string; note?: unknown; expiryDays?: unknown },
  now: number = Date.now(),
): RequestResult {
  if (!hit(`moneyreq:user:${actorId}`, RATE_LIMITS.requestsPerHourPerUser, RATE_LIMITS.longWindowMs)) {
    return { ok: false, error: 'Too many requests. Try again later.' };
  }
  const friend = getAcceptedFriendByUsername(actorId, String(input.friend ?? ''));
  if (!friend) return { ok: false, error: 'You can only request money from accepted friends.' };
  const amount = parseUsdcAmount(String(input.amount ?? ''));
  if (!amount.ok) return { ok: false, error: amount.error };
  const note = parseNote(input.note);
  if (!note.ok) return { ok: false, error: note.error };
  const expiry = parseExpiryDays(input.expiryDays);

  const open = db
    .select()
    .from(moneyRequests)
    .where(and(eq(moneyRequests.requesterId, actorId), eq(moneyRequests.payerId, friend.id), eq(moneyRequests.status, 'pending'), gt(moneyRequests.expiresAt, now)))
    .all()
    .filter((r) => stateOf(r, now) === 'pending' || stateOf(r, now) === 'paying');
  if (open.length >= MAX_PENDING_PER_PAIR) {
    return { ok: false, error: `You already have ${MAX_PENDING_PER_PAIR} open requests to ${friend.username}. Cancel one or wait for a reply.` };
  }

  db.insert(moneyRequests)
    .values({ id: randomUUID(), requesterId: actorId, payerId: friend.id, amountRaw: amount.raw.toString(), note: note.note, status: 'pending', createdAt: now, expiresAt: now + expiry.days * DAY_MS })
    .run();
  return { ok: true, warning: expiry.warning };
}

function loadForActor(actorId: string, id: string): Row | null {
  const row = db.select().from(moneyRequests).where(eq(moneyRequests.id, id)).get();
  return row && (row.requesterId === actorId || row.payerId === actorId) ? row : null;
}

/** Only the payer may decline, and only while the request is open (pending, not expired, not being paid). */
export function declineMoneyRequest(actorId: string, id: string, now: number = Date.now()): RequestResult {
  const row = loadForActor(actorId, id);
  if (!row || row.payerId !== actorId || stateOf(row, now) !== 'pending') return NOT_FOUND;
  const r = db.update(moneyRequests).set({ status: 'declined', respondedAt: now }).where(and(eq(moneyRequests.id, id), eq(moneyRequests.status, 'pending'))).run();
  return r.changes ? { ok: true } : NOT_FOUND;
}

/** Only the requester may cancel, and only while it is open. */
export function cancelMoneyRequest(actorId: string, id: string, now: number = Date.now()): RequestResult {
  const row = loadForActor(actorId, id);
  if (!row || row.requesterId !== actorId || stateOf(row, now) !== 'pending') return NOT_FOUND;
  const r = db.update(moneyRequests).set({ status: 'cancelled', respondedAt: now }).where(and(eq(moneyRequests.id, id), eq(moneyRequests.status, 'pending'))).run();
  return r.changes ? { ok: true } : NOT_FOUND;
}

export type RequestView = {
  id: string;
  lastRemindedAt: number | null;
  otherUsername: string;
  amount: string; // formatted USDC
  note: string | null;
  state: RequestState;
  createdAt: number;
  expiresAt: number;
};

export function listMoneyRequests(actorId: string, now: number = Date.now()) {
  const rows = db
    .select()
    .from(moneyRequests)
    .where(or(eq(moneyRequests.requesterId, actorId), eq(moneyRequests.payerId, actorId)))
    .orderBy(desc(moneyRequests.createdAt))
    .all();
  const names = new Map(db.select({ id: users.id, username: users.username }).from(users).all().map((u) => [u.id, u.username]));
  const view = rows.map((r) => {
    const mine = r.requesterId === actorId;
    return {
      mine,
      v: {
        id: r.id,
        lastRemindedAt: r.lastRemindedAt,
        otherUsername: names.get(mine ? r.payerId : r.requesterId) ?? 'unknown',
        amount: formatUsdc(r.amountRaw),
        note: r.note,
        state: stateOf(r, now),
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      } satisfies RequestView,
    };
  });
  const open = (s: RequestState) => s === 'pending' || s === 'paying';
  return {
    incoming: view
      .filter((x) => !x.mine && open(x.v.state))
      .map((x) => x.v)
      .sort((a, b) => (b.lastRemindedAt ?? 0) - (a.lastRemindedAt ?? 0) || b.createdAt - a.createdAt), // a fresh reminder floats to the top
    outgoing: view.filter((x) => x.mine && open(x.v.state)).map((x) => x.v),
    recent: view.filter((x) => !open(x.v.state)).slice(0, 10).map((x) => ({ ...x.v, mine: x.mine })),
  };
}

/** Only the requester may remind, once per 24 hours per request, and only while the request is open and unpaid. */
export function remindMoneyRequest(actorId: string, id: string, now: number = Date.now()): RequestResult {
  const row = loadForActor(actorId, id);
  if (!row || row.requesterId !== actorId || stateOf(row, now) !== 'pending') return NOT_FOUND;
  if (row.lastRemindedAt && now - row.lastRemindedAt < REMIND_COOLDOWN_MS) {
    return { ok: false, error: 'You already sent a reminder in the last 24 hours.' };
  }
  const r = db.update(moneyRequests).set({ lastRemindedAt: now }).where(and(eq(moneyRequests.id, id), eq(moneyRequests.status, 'pending'))).run();
  return r.changes ? { ok: true } : NOT_FOUND;
}

/** For "Ask again": the actor's own earlier request (any state), to prefill a new one. */
export function getOwnRequestForReuse(requesterId: string, id: string) {
  const row = db.select().from(moneyRequests).where(and(eq(moneyRequests.id, id), eq(moneyRequests.requesterId, requesterId))).get();
  if (!row) return null;
  const payer = db.select({ username: users.username }).from(users).where(eq(users.id, row.payerId)).get();
  return payer ? { friend: payer.username, amount: formatUsdc(row.amountRaw), note: row.note } : null;
}

export const countIncomingMoneyRequests = (actorId: string, now: number = Date.now()) =>
  listMoneyRequests(actorId, now).incoming.filter((r) => r.state === 'pending').length;

/** For the Send page: the request this user is being asked to pay, if it can be paid right now. */
export function getPayableRequest(payerId: string, id: string, now: number = Date.now()) {
  const row = db.select().from(moneyRequests).where(and(eq(moneyRequests.id, id), eq(moneyRequests.payerId, payerId))).get();
  if (!row || stateOf(row, now) !== 'pending') return null;
  const requester = db.select({ username: users.username }).from(users).where(eq(users.id, row.requesterId)).get();
  if (!requester) return null;
  return { id: row.id, requesterUsername: requester.username, amount: formatUsdc(row.amountRaw), note: row.note, expiresAt: row.expiresAt };
}
