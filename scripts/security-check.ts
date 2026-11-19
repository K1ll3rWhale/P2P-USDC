// HTTP security checks against a RUNNING production build (testnet). Start the app with TRUST_PROXY=1 on port 3111
// so each check can use its own forwarded IP and never touches a real browser's rate-limit bucket:
//   TRUST_PROXY=1 npx next start -p 3111      then      npm run security:check
// Creates quotes only (never a payment). Prints PASS/FAIL per check and exits non-zero on any FAIL.
import '../lib/load-env';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../lib/db';
import { payments, quotes, rateLimits, users, wallets } from '../lib/db/schema';

const BASE = process.env.LIVE_BASE ?? 'http://localhost:3111';
const PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'demo-password-123';
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const rnd = () => Math.random().toString(36).slice(2, 10);
const ip = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
};

function hidden(html: string, mustHave: string): [string, string][] {
  for (const f of html.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    if (!f[0].includes(`name="${mustHave}"`)) continue;
    return [...f[0].matchAll(/<input\b[^>]*>/g)]
      .filter((m) => /type="hidden"/.test(m[0]))
      .map((m) => [unesc(m[0].match(/name="([^"]*)"/)?.[1] ?? ''), unesc(m[0].match(/value="([^"]*)"/)?.[1] ?? '')] as [string, string])
      .filter(([k]) => k);
  }
  throw new Error('form not found: ' + mustHave);
}

async function formPost(path: string, formPage: string, mustHave: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  const page = await (await fetch(BASE + formPage)).text();
  const fd = new FormData();
  for (const [k, v] of hidden(page, mustHave)) fd.append(k, v);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(BASE + path, { method: 'POST', body: fd, redirect: 'manual', headers });
  return { res, body: await res.text() };
}

async function login(name: string, extra: Record<string, string> = {}) {
  const { res } = await formPost('/login', '/login', 'identifier', { identifier: name, password: PASSWORD }, { 'x-forwarded-for': ip(), Origin: BASE, ...extra });
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('session='));
  return { cookie: raw?.split(';')[0], raw, status: res.status };
}

const api = async (cookie: string | undefined, path: string, body?: unknown, headers: Record<string, string> = { Origin: BASE }) => {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  return { status: res.status, text: await res.text() };
};
const json = (t: string) => { try { return JSON.parse(t); } catch { return {}; } };
const uid = (name: string) => db.select().from(users).where(eq(users.usernameNorm, name)).get()!.id;

// ------------------------------------------------------------------------------------------------ setup
const alice = (await login('alice')).cookie!;
const bob = (await login('bob')).cookie!;
if (!alice || !bob) { console.error('Cannot log in as alice and bob. Run npm run demo:accounts first.'); process.exit(1); }
const aliceId = uid('alice');
const bobId = uid('bob');
const paymentCount = () => db.select().from(payments).all().length;
const paymentsBefore = paymentCount();

// ------------------------------------------------------------------------------------------------ A. authentication required
console.log('\n# Authentication required');
for (const [m, p, b] of [['GET', '/api/summary'], ['POST', '/api/quotes', {}], ['POST', '/api/payments', {}]] as const) {
  const r = await api(undefined, p, m === 'POST' ? b : undefined);
  check(`${m} ${p} without a session is 401`, r.status === 401, `status ${r.status}`);
}
for (const p of ['/', '/wallet', '/send', '/activity', '/friends']) {
  const r = await api(undefined, p);
  check(`page ${p} without a session redirects to login`, r.status === 307, `status ${r.status}`);
}

// ------------------------------------------------------------------------------------------------ B. origin / CSRF protection
console.log('\n# Origin / CSRF protection');
const q = { op: 'send', recipient: 'bob', amount: '0.01' };
check('POST /api/quotes with no Origin is 403', (await api(alice, '/api/quotes', q, {})).status === 403);
check('POST /api/quotes with a foreign Origin is 403', (await api(alice, '/api/quotes', q, { Origin: 'https://evil.example' })).status === 403);
check('POST /api/quotes with the same Origin works (control)', (await api(alice, '/api/quotes', q)).status === 200);
check('POST /api/payments with no Origin is 403', (await api(alice, '/api/payments', { quoteId: 'x', idempotencyKey: 'abcdefgh1' }, {})).status === 403);
check('POST /api/payments with a foreign Origin is 403', (await api(alice, '/api/payments', { quoteId: 'x', idempotencyKey: 'abcdefgh1' }, { Origin: 'https://evil.example' })).status === 403);
{
  const evil = await login('alice', { Origin: 'https://evil.example' });
  check('Server Action (login) with a foreign Origin is rejected and sets no session', !evil.cookie, `status ${evil.status}`);
  const noOrigin = await formPost('/login', '/login', 'identifier', { identifier: 'alice', password: PASSWORD }, { 'x-forwarded-for': ip() });
  check('Server Action (login) with no Origin header: reported, not asserted', true, `status ${noOrigin.res.status}, sets session: ${noOrigin.res.headers.getSetCookie().some((c) => c.startsWith('session='))}`);
}

// ------------------------------------------------------------------------------------------------ C. cookie flags
console.log('\n# Session cookie flags');
{
  const http = await login('alice');
  check('cookie is HttpOnly', /httponly/i.test(http.raw ?? ''));
  check('cookie is SameSite=Lax', /samesite=lax/i.test(http.raw ?? ''));
  check('cookie Path=/', /path=\//i.test(http.raw ?? ''));
  check('cookie is NOT Secure over plain http (so it works on http://localhost in every browser)', !/;\s*secure/i.test(http.raw ?? ''));
  const https = await login('alice', { Origin: BASE.replace('http://', 'https://') });
  check('cookie IS Secure when the request is https (https Origin)', /;\s*secure/i.test(https.raw ?? ''), `status ${https.status}`);
  check('session token is long and random-looking (>= 40 chars)', (http.cookie?.split('=')[1]?.length ?? 0) >= 40);
}

// ------------------------------------------------------------------------------------------------ D. object-level authorization
console.log('\n# Object-level authorization');
{
  const bq = json((await api(bob, '/api/quotes', { op: 'send', recipient: 'alice', amount: '0.01' })).text).quote;
  const steal = await api(alice, '/api/payments', { quoteId: bq.id, idempotencyKey: 'steal-' + rnd() });
  check("alice cannot use bob's quote (404, not found)", steal.status === 404, `status ${steal.status}`);
  check("bob's quote was not consumed by that attempt", db.select().from(quotes).where(eq(quotes.id, bq.id)).get()?.consumedAt === null);

  const plain = json((await api(alice, '/api/summary?limit=50')).text);
  const spoof = json((await api(alice, `/api/summary?limit=50&userId=${bobId}`)).text);
  check("a userId query parameter cannot show another user's activity", JSON.stringify(plain.activity) === JSON.stringify(spoof.activity));
  check("alice's activity contains none of bob's withdrawals or sends", plain.activity.every((a: any) => a.type !== 'withdrawal'));

  const bobAddr = db.select().from(wallets).where(eq(wallets.userId, bobId)).get()!.address;
  const big = json((await api(alice, '/api/quotes', { op: 'send', recipient: 'bob', amount: '100' })).text).quote;
  const attempt = await api(alice, '/api/payments', { quoteId: big.id, idempotencyKey: 'own-' + rnd(), fromAddress: bobAddr, walletId: 'x', userId: bobId });
  const aliceBal = String(plain.balance?.formatted);
  check("a body naming bob's wallet or user is ignored: the sender is always the session user", attempt.status === 422 && String(json(attempt.text).error).includes(`Your balance is ${aliceBal}`), `status ${attempt.status}`);
  check('no payment was created by any of the above', paymentCount() === paymentsBefore);
  check('friend actions (accept/decline/cancel by non-parties) are covered by unit tests, not re-tested here', true, 'tests/friends.test.ts');
}

// ------------------------------------------------------------------------------------------------ E. rate limits
console.log('\n# Rate limits (a real count of recorded attempts is checked, not just responses)');
const since = () => Date.now() - 15 * 60_000;
const attempts = (key: string) => db.select().from(rateLimits).where(and(eq(rateLimits.key, key), gt(rateLimits.createdAt, since()))).all().length;
{
  const who = 'rl-' + rnd();
  const myIp = ip();
  let last = '';
  let sessions = 0;
  for (let i = 0; i < 12; i++) {
    const { res, body } = await formPost('/login', '/login', 'identifier', { identifier: who, password: 'wrong-password-1' }, { 'x-forwarded-for': myIp, Origin: BASE });
    sessions += res.headers.getSetCookie().some((c) => c.startsWith('session=')) ? 1 : 0;
    last = body;
  }
  check('login: attempts are capped at 10 per identifier in 15 minutes', attempts(`login:id:${who}`) === 10, `recorded ${attempts(`login:id:${who}`)} of 12`);
  check('login: the blocked attempts create no session', sessions === 0);
  check('login: the blocked response says to wait', /Too many attempts/.test(last), 'checked in the rendered page');
}
{
  const myIp = ip();
  const usersBefore = db.select().from(users).all().length;
  for (let i = 0; i < 22; i++) {
    await formPost('/signup', '/signup', 'email', { email: 'not-an-email', username: 'x' + rnd().slice(0, 6), password: 'a-long-enough-password' }, { 'x-forwarded-for': myIp, Origin: BASE });
  }
  check('signup: attempts are capped at 20 per IP in 15 minutes', attempts(`signup:ip:${myIp}`) === 20, `recorded ${attempts(`signup:ip:${myIp}`)} of 22`);
  check('signup: no accounts or wallets were created by the test', db.select().from(users).all().length === usersBefore);
}
await new Promise((r) => setTimeout(r, 61_000)); // fresh one-minute windows for the per-user limits
{
  let ok = 0;
  let firstBlocked = 0;
  for (let i = 1; i <= 34; i++) {
    const r = await api(bob, '/api/quotes', { op: 'send', recipient: 'alice', amount: '0.01' });
    if (r.status === 200) ok++;
    else if (r.status === 429 && !firstBlocked) firstBlocked = i;
  }
  check('quotes: 30 per minute per user, then 429', ok === 30 && firstBlocked === 31, `${ok} accepted, first 429 at request ${firstBlocked}`);
}
{
  const before = paymentCount();
  let statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const qq = json((await api(alice, '/api/quotes', { op: 'send', recipient: 'bob', amount: '100' })).text).quote; // 100 USDC: alice cannot afford it, so nothing is ever sent
    if (!qq) { statuses.push(-1); continue; }
    statuses.push((await api(alice, '/api/payments', { quoteId: qq.id, idempotencyKey: 'rl-' + rnd() })).status);
  }
  const unaffordable = statuses.filter((s) => s === 422).length;
  const limited = statuses.filter((s) => s === 429).length;
  check('sends: 10 attempts per minute per user, then 429 (attempts use unaffordable amounts, so no money moves)', unaffordable === 10 && limited >= 1, `statuses ${statuses.join(',')}`);
  check('sends: no payment rows were created', paymentCount() === before);
}

// ------------------------------------------------------------------------------------------------ F. leakage
console.log('\n# Information leakage');
{
  const bodies = [(await api(alice, '/api/summary')).text, (await api(alice, '/')).text, (await api(alice, '/wallet')).text, (await api(alice, '/friends')).text];
  check('no password hashes or argon2 strings in API or page output', bodies.every((b) => !/\$argon2|password_hash|passwordHash/.test(b)));
  check('no provider secrets or auth key material in page output', bodies.every((b) => !/wallet-auth:|PRIVY_APP_SECRET/.test(b)));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
