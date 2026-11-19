import { and, count, eq, lt } from 'drizzle-orm';
import { db } from './db';
import { rateLimits } from './db/schema';

// Easy-to-change limits. Each attempt (successful or not) counts within the window.
export const RATE_LIMITS = {
  windowMs: 15 * 60 * 1000,
  loginPerIdentifier: 10,
  loginPerIp: 30,
  signupPerIp: 20,
  shortWindowMs: 60 * 1000,
  quotesPerMinutePerUser: 30,
  sendsPerMinutePerUser: 10, // sends and withdrawals share this limit
} as const;

/** Records an attempt for `key` and returns false (without recording) once `max` is reached in the window. */
export function hit(key: string, max: number, windowMs: number = RATE_LIMITS.windowMs): boolean {
  const now = Date.now();
  const since = now - windowMs;
  return db.transaction(
    (tx) => {
      tx.delete(rateLimits).where(and(eq(rateLimits.key, key), lt(rateLimits.createdAt, since))).run();
      const row = tx.select({ n: count() }).from(rateLimits).where(eq(rateLimits.key, key)).get();
      if ((row?.n ?? 0) >= max) return false;
      tx.insert(rateLimits).values({ key, createdAt: now }).run();
      return true;
    },
    { behavior: 'immediate' },
  );
}
