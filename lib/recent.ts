import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { payments, users } from './db/schema';

/** Usernames of the people this user most recently sent to (newest first, no repeats). Display ordering only. */
export function recentRecipientUsernames(userId: string, max = 3): string[] {
  const rows = db
    .select({ id: payments.recipientUserId })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.kind, 'send'), isNotNull(payments.recipientUserId)))
    .orderBy(desc(payments.createdAt))
    .limit(50)
    .all();
  const ids: string[] = [];
  for (const r of rows) if (r.id && !ids.includes(r.id)) ids.push(r.id);
  const top = ids.slice(0, max);
  if (!top.length) return [];
  const names = new Map(db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, top)).all().map((u) => [u.id, u.username]));
  return top.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
}
