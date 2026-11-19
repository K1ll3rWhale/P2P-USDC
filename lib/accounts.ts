import { randomUUID } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { db } from './db';
import { users } from './db/schema';
import { hashPassword, verifyDummy, verifyPassword } from './password';
import { provisionWallet } from './provisioning';
import { hit, RATE_LIMITS } from './ratelimit';
import { loginSchema, normalize, signupSchema } from './validation';

export type SignupResult =
  | { ok: true; userId: string; walletReady: boolean; walletError?: string }
  | { ok: false; error: string };

const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';

/** Signup path shared by the web form and the demo-accounts script. */
export async function signupUser(
  input: { email: string; username: string; password: string },
  ip: string,
): Promise<SignupResult> {
  if (!hit(`signup:ip:${ip}`, RATE_LIMITS.signupPerIp)) return { ok: false, error: TOO_MANY };
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { email, username, password } = parsed.data;

  const id = randomUUID();
  try {
    db.insert(users)
      .values({
        id,
        email,
        emailNorm: normalize(email),
        username,
        usernameNorm: normalize(username),
        passwordHash: await hashPassword(password),
        status: 'pending',
        createdAt: Date.now(),
      })
      .run();
  } catch (e) {
    if (e instanceof Error && 'code' in e && String(e.code).startsWith('SQLITE_CONSTRAINT')) {
      return { ok: false, error: 'That email or username is already in use.' };
    }
    throw e;
  }

  const provisioned = await provisionWallet(id);
  return provisioned.ok
    ? { ok: true, userId: id, walletReady: true }
    : { ok: true, userId: id, walletReady: false, walletError: provisioned.error };
}

export type LoginResult = { ok: true; userId: string } | { ok: false; error: string };

export async function loginUser(input: { identifier: string; password: string }, ip: string): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const ident = normalize(parsed.data.identifier);
  const ipOk = hit(`login:ip:${ip}`, RATE_LIMITS.loginPerIp);
  const idOk = hit(`login:id:${ident}`, RATE_LIMITS.loginPerIdentifier);
  if (!ipOk || !idOk) return { ok: false, error: TOO_MANY };

  const user = db.select().from(users).where(or(eq(users.emailNorm, ident), eq(users.usernameNorm, ident))).get();
  const valid = user ? await verifyPassword(user.passwordHash, parsed.data.password) : (await verifyDummy(parsed.data.password), false);
  if (!user || !valid) return { ok: false, error: 'Invalid email/username or password.' };
  return { ok: true, userId: user.id };
}
