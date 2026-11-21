import { and, count, eq, gt, ne } from 'drizzle-orm';
import { db } from './db';
import { payments, transfers, users } from './db/schema';
import { listFriendships } from './friends';
import { countIncomingMoneyRequests } from './requests';

const seenAt = (userId: string): number => db.select({ s: users.activitySeenAt }).from(users).where(eq(users.id, userId)).get()?.s ?? 0;

/**
 * Activity the user has not looked at yet: incoming transfers observed, and their own sends or withdrawals that
 * resolved, since they last opened Activity. Counts only; nothing here touches balances or transfers.
 */
export function unreadActivityCount(userId: string): number {
  const since = seenAt(userId);
  const incoming = db
    .select({ n: count() })
    .from(transfers)
    .where(and(eq(transfers.userId, userId), ne(transfers.status, 'dropped'), gt(transfers.observedAt, since)))
    .get()?.n ?? 0;
  const resolved = db
    .select({ n: count() })
    .from(payments)
    .where(and(eq(payments.userId, userId), gt(payments.resolvedAt, since)))
    .get()?.n ?? 0;
  return incoming + resolved;
}

export function markActivitySeen(userId: string, now: number = Date.now()): void {
  db.update(users).set({ activitySeenAt: now }).where(eq(users.id, userId)).run();
}

/** Things waiting for an answer: incoming friend requests plus incoming open money requests. */
export function waitingCounts(userId: string) {
  const friendRequests = listFriendships(userId).incoming.length;
  const moneyRequests = countIncomingMoneyRequests(userId);
  return { friendRequests, moneyRequests, total: friendRequests + moneyRequests };
}
