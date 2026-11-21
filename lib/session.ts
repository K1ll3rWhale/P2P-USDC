import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from './db';
import { sessions, users, wallets } from './db/schema';

const COOKIE = 'session';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Secure cookies are only accepted over HTTPS (Safari rejects them on http://localhost), so set the flag only when
// the request itself came over HTTPS: an https Origin, or a trusted proxy reporting https.
async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  if (h.get('origin')?.startsWith('https://')) return true;
  return process.env.TRUST_PROXY === '1' && h.get('x-forwarded-proto') === 'https';
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TTL_MS;
  db.insert(sessions).values({ id: randomUUID(), userId, tokenHash: sha256(token), expiresAt, createdAt: Date.now() }).run();
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && (await isHttpsRequest()),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).run();
  jar.delete(COOKIE);
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({ id: users.id, email: users.email, username: users.username, status: users.status, provisioningError: users.provisioningError })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, Date.now())))
    .get();
  return row ?? null;
});

/** The id of the session making this request (so it can be kept when others are signed out). */
export const getCurrentSessionId = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, Date.now()))).get()?.id ?? null;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export function getWalletFor(userId: string) {
  return db.select().from(wallets).where(eq(wallets.userId, userId)).get() ?? null;
}

/**
 * Client IP for rate limiting. Forwarded headers are client-controlled, so they are trusted ONLY when TRUST_PROXY=1
 * (i.e. we run behind a proxy that sets them). Otherwise every client shares one bucket.
 */
export async function clientIp(): Promise<string> {
  if (process.env.TRUST_PROXY !== '1') return 'direct';
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'direct';
}
