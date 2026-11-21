import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { db } from './db';
import { sessions, users } from './db/schema';
import { hashPassword, verifyPassword } from './password';
import { hit, RATE_LIMITS } from './ratelimit';
import { signupSchema } from './validation';

export type SecurityResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Changes the signed-in user's password. Needs the current password, is rate limited per user, and signs out every
 * OTHER session (the one making the change stays signed in).
 */
export async function changePassword(
  userId: string,
  keepSessionId: string,
  input: { current: string; next: string; confirm: string },
): Promise<SecurityResult> {
  if (!hit(`pwchange:user:${userId}`, RATE_LIMITS.passwordChangesPerWindow)) {
    return { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' };
  }
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false, error: 'Account not found.' };
  if (!(await verifyPassword(user.passwordHash, input.current))) return { ok: false, error: 'Your current password is not correct.' };
  const parsed = signupSchema.shape.password.safeParse(input.next);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (input.next !== input.confirm) return { ok: false, error: 'The new passwords do not match.' };
  if (input.next === input.current) return { ok: false, error: 'Choose a password different from your current one.' };

  const passwordHash = await hashPassword(input.next);
  db.transaction((tx) => {
    tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
    tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))).run();
  });
  return { ok: true, message: 'Password changed. Your other sessions were signed out.' };
}

export type SessionView = { id: string; createdAt: number; expiresAt: number; current: boolean };

/** The user's live sessions, newest first. */
export function listSessions(userId: string, currentSessionId: string | null, now: number = Date.now()): SessionView[] {
  return db
    .select({ id: sessions.id, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.createdAt))
    .all()
    .map((s) => ({ ...s, current: s.id === currentSessionId }));
}

/** Signs out every session except the current one. Returns how many were removed. */
export function revokeOtherSessions(userId: string, keepSessionId: string): number {
  return db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))).run().changes;
}
