import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, inArray, like, ne, or } from 'drizzle-orm';
import { db } from './db';
import { friendEvents, friendships, moneyRequests, payments, users, wallets } from './db/schema';
import { normalize } from './validation';

export type FriendResult = { ok: true } | { ok: false; error: string; incomingRequestId?: string };
export type Relation = 'none' | 'friends' | 'outgoing' | 'incoming';

const NOT_FOUND = { ok: false, error: 'Request not found.' } as const;
export type FriendEventType = 'accepted' | 'declined' | 'cancelled' | 'removed';
function logEvent(actorId: string, targetId: string, type: FriendEventType, now: number = Date.now()) {
  db.insert(friendEvents).values({ id: randomUUID(), actorId, targetId, type, createdAt: now }).run();
}
const pair = (a: string, b: string) => (a < b ? { low: a, high: b } : { low: b, high: a });

function findPair(a: string, b: string) {
  const { low, high } = pair(a, b);
  return db.select().from(friendships).where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high))).get();
}

function relationOf(actorId: string, otherId: string): { relation: Relation; id?: string } {
  const row = findPair(actorId, otherId);
  if (!row) return { relation: 'none' };
  if (row.status === 'accepted') return { relation: 'friends', id: row.id };
  return { relation: row.requesterId === actorId ? 'outgoing' : 'incoming', id: row.id };
}

/** Username search for the actor. Never returns the actor and only returns active accounts. */
export function searchUsers(actorId: string, query: string) {
  const q = normalize(query).replace(/[\\%_]/g, (c) => '\\' + c);
  if (q.length < 2) return [];
  return db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(like(users.usernameNorm, `%${q}%`), ne(users.id, actorId), eq(users.status, 'active')))
    .limit(10)
    .all()
    .map((u) => ({ ...u, ...relationOf(actorId, u.id) }));
}

export function sendRequest(actorId: string, targetUsername: string): FriendResult {
  const target = db.select().from(users).where(eq(users.usernameNorm, normalize(targetUsername))).get();
  if (!target || target.status !== 'active') return { ok: false, error: 'No such user.' };
  if (target.id === actorId) return { ok: false, error: 'You cannot add yourself.' };

  const existing = relationOf(actorId, target.id);
  if (existing.relation === 'friends') return { ok: false, error: 'You are already friends.' };
  if (existing.relation === 'outgoing') return { ok: false, error: 'You already sent this request.' };
  if (existing.relation === 'incoming') {
    return { ok: false, error: `${target.username} already sent you a request. Accept it below.`, incomingRequestId: existing.id };
  }

  const { low, high } = pair(actorId, target.id);
  try {
    db.insert(friendships).values({ id: randomUUID(), userLow: low, userHigh: high, requesterId: actorId, status: 'pending', createdAt: Date.now() }).run();
  } catch (e) {
    if (e instanceof Error && 'code' in e && String(e.code).startsWith('SQLITE_CONSTRAINT')) {
      return { ok: false, error: 'A request between you already exists.' }; // lost a race; the pair row exists
    }
    throw e;
  }
  return { ok: true };
}

/** Loads a request only if the actor is one of the two users, so others cannot learn it exists. */
function loadForActor(actorId: string, id: string) {
  const row = db.select().from(friendships).where(eq(friendships.id, id)).get();
  return row && (row.userLow === actorId || row.userHigh === actorId) ? row : null;
}

/** Only the addressee (not the requester) of a pending request may accept. */
export function acceptRequest(actorId: string, id: string): FriendResult {
  const row = loadForActor(actorId, id);
  if (!row || row.status !== 'pending' || row.requesterId === actorId) return NOT_FOUND;
  const r = db.update(friendships).set({ status: 'accepted', respondedAt: Date.now() }).where(and(eq(friendships.id, id), eq(friendships.status, 'pending'))).run();
  if (r.changes) logEvent(actorId, row.requesterId, 'accepted');
  return r.changes ? { ok: true } : NOT_FOUND;
}

/** Only the addressee may decline. The row is deleted. */
export function declineRequest(actorId: string, id: string): FriendResult {
  const row = loadForActor(actorId, id);
  if (!row || row.status !== 'pending' || row.requesterId === actorId) return NOT_FOUND;
  const r = db.delete(friendships).where(and(eq(friendships.id, id), eq(friendships.status, 'pending'))).run();
  if (r.changes) logEvent(actorId, row.requesterId, 'declined');
  return { ok: true };
}

/** Only the requester may cancel. The row is deleted. */
export function cancelRequest(actorId: string, id: string): FriendResult {
  const row = loadForActor(actorId, id);
  if (!row || row.status !== 'pending' || row.requesterId !== actorId) return NOT_FOUND;
  const r = db.delete(friendships).where(and(eq(friendships.id, id), eq(friendships.status, 'pending'))).run();
  if (r.changes) logEvent(actorId, row.userLow === actorId ? row.userHigh : row.userLow, 'cancelled');
  return { ok: true };
}

export function listFriendships(actorId: string) {
  const rows = db
    .select()
    .from(friendships)
    .where(or(eq(friendships.userLow, actorId), eq(friendships.userHigh, actorId)))
    .all();
  const names = new Map(db.select({ id: users.id, username: users.username }).from(users).all().map((u) => [u.id, u.username]));
  const view = rows.map((r) => {
    const otherId = r.userLow === actorId ? r.userHigh : r.userLow;
    return { id: r.id, otherUsername: names.get(otherId) ?? 'unknown', status: r.status, outgoing: r.requesterId === actorId, createdAt: r.createdAt };
  });
  return {
    incoming: view.filter((v) => v.status === 'pending' && !v.outgoing),
    outgoing: view.filter((v) => v.status === 'pending' && v.outgoing),
    accepted: view.filter((v) => v.status === 'accepted'),
  };
}

export function countIncoming(actorId: string): number {
  return listFriendships(actorId).incoming.length;
}

export function areAcceptedFriends(a: string, b: string): boolean {
  return findPair(a, b)?.status === 'accepted';
}

/** The actor's accepted friend with this username (case-insensitive), with their active wallet address. */
export function getAcceptedFriendByUsername(actorId: string, username: string) {
  const u = db.select().from(users).where(eq(users.usernameNorm, normalize(username))).get();
  if (!u || u.id === actorId || u.status !== 'active' || !areAcceptedFriends(actorId, u.id)) return null;
  const w = db.select({ address: wallets.address }).from(wallets).where(eq(wallets.userId, u.id)).get();
  return w ? { id: u.id, username: u.username, address: w.address } : null;
}

export function listAcceptedFriends(actorId: string): { id: string; username: string }[] {
  const all = listFriendships(actorId).accepted;
  return all.map((f) => ({ id: f.id, username: f.otherUsername })).sort((x, y) => x.username.localeCompare(y.username));
}

/**
 * Removes an accepted friend (either side may). Refused while money could be in flight between the two: an unresolved
 * send, or an open money request in either direction. The pair row is deleted, so sends stop being allowed at once.
 */
export function removeFriend(actorId: string, id: string, now: number = Date.now()): FriendResult {
  const row = loadForActor(actorId, id);
  if (!row || row.status !== 'accepted') return NOT_FOUND;
  const otherId = row.userLow === actorId ? row.userHigh : row.userLow;
  const inFlight = db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        inArray(payments.status, ['created', 'submitted']),
        or(
          and(eq(payments.userId, actorId), eq(payments.recipientUserId, otherId)),
          and(eq(payments.userId, otherId), eq(payments.recipientUserId, actorId)),
        ),
      ),
    )
    .get();
  if (inFlight) return { ok: false, error: 'A transfer between you is still in progress. Wait for it to finish before removing this friend.' };
  const openRequest = db
    .select({ id: moneyRequests.id })
    .from(moneyRequests)
    .where(
      and(
        eq(moneyRequests.status, 'pending'),
        gt(moneyRequests.expiresAt, now),
        or(
          and(eq(moneyRequests.requesterId, actorId), eq(moneyRequests.payerId, otherId)),
          and(eq(moneyRequests.requesterId, otherId), eq(moneyRequests.payerId, actorId)),
        ),
      ),
    )
    .get();
  if (openRequest) return { ok: false, error: 'There is an open money request between you. Cancel or decline it first.' };
  const r = db.delete(friendships).where(and(eq(friendships.id, id), eq(friendships.status, 'accepted'))).run();
  if (!r.changes) return NOT_FOUND;
  logEvent(actorId, otherId, 'removed', now);
  return { ok: true };
}

export type FriendEventView = { id: string; type: FriendEventType; mine: boolean; otherUsername: string; createdAt: number };

/** The most recent friendship changes involving this user, newest first. */
export function listFriendEvents(actorId: string, limit = 15): FriendEventView[] {
  const rows = db
    .select()
    .from(friendEvents)
    .where(or(eq(friendEvents.actorId, actorId), eq(friendEvents.targetId, actorId)))
    .orderBy(desc(friendEvents.createdAt))
    .limit(limit)
    .all();
  const names = new Map(db.select({ id: users.id, username: users.username }).from(users).all().map((u) => [u.id, u.username]));
  return rows.map((e) => {
    const mine = e.actorId === actorId;
    return { id: e.id, type: e.type, mine, otherUsername: names.get(mine ? e.targetId : e.actorId) ?? 'unknown', createdAt: e.createdAt };
  });
}
