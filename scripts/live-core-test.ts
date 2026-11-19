// Live end-to-end test over real HTTP against a running app + worker (testnet only):
//   1. alice sends bob 1 USDC with a note, 2. the SAME idempotency key is replayed once,
//   3. bob withdraws 1 USDC to an external address. Requires: next start on :3111 and `npm run worker`.
import '../lib/load-env';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { payments, transfers, users } from '../lib/db/schema';
import { formatUsdc } from '../lib/amount';
import { createViemReader } from '../lib/worker/viem-reader';

const BASE = process.env.LIVE_BASE ?? 'http://localhost:3111';
const PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'demo-password-123';
const EXTERNAL = '0x59dA01Eb6754480f1f9FB9efA23a409e52e55134';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

function hiddenFields(html: string, mustHave: string): [string, string][] {
  for (const f of html.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    if (!f[0].includes(`name="${mustHave}"`)) continue;
    return [...f[0].matchAll(/<input\b[^>]*>/g)]
      .filter((m) => /type="hidden"/.test(m[0]))
      .map((m) => [unesc(m[0].match(/name="([^"]*)"/)?.[1] ?? ''), unesc(m[0].match(/value="([^"]*)"/)?.[1] ?? '')] as [string, string])
      .filter(([k]) => k);
  }
  throw new Error('form not found');
}

async function login(name: string): Promise<string> {
  const page = await (await fetch(BASE + '/login')).text();
  const fd = new FormData();
  for (const [k, v] of hiddenFields(page, 'identifier')) fd.append(k, v);
  fd.append('identifier', name);
  fd.append('password', PASSWORD);
  const res = await fetch(BASE + '/login', { method: 'POST', body: fd, redirect: 'manual' });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('session='))?.split(';')[0];
  if (!cookie) throw new Error(`login failed for ${name}`);
  return cookie;
}

async function api(cookie: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json', Origin: BASE } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const summary = async (cookie: string) => (await api(cookie, '/api/summary?limit=10')).json;
const bal = async (cookie: string) => {
  await sleep(11_000); // balance cache is at most 10 s
  return (await summary(cookie)).balance?.formatted as string;
};

async function pay(cookie: string, op: 'send' | 'withdraw', recipient: string, amount: string, note: string | undefined, key: string) {
  const q = await api(cookie, '/api/quotes', { op, recipient, amount });
  if (q.status !== 200) throw new Error(`quote failed: ${q.status} ${JSON.stringify(q.json)}`);
  console.log(`  quote: receives ${q.json.quote.receives}, est fee ${q.json.quote.estimatedFee}, est total ${q.json.quote.estimatedTotal}`);
  const r = await api(cookie, '/api/payments', { quoteId: q.json.quote.id, idempotencyKey: key, note });
  return { q, r };
}

async function waitResolved(id: string, label: string) {
  for (let i = 0; i < 90; i++) {
    const p = db.select().from(payments).where(eq(payments.id, id)).get()!;
    if (p.status === 'confirmed' || p.status === 'failed') return p;
    await sleep(4000);
  }
  throw new Error(`${label}: not resolved after 6 minutes. NOT resending; check the chain and ask.`);
}

const alice = await login('alice');
const bob = await login('bob');
const before = { alice: await bal(alice), bob: await bal(bob) };
console.log('balances before:', before);

// 1. alice -> bob 1 USDC with a note
const key = 'live-' + Math.random().toString(36).slice(2, 14);
console.log('1. alice sends bob 1 USDC');
const first = await pay(alice, 'send', 'bob', '1', 'Lunch money', key);
console.log(`  POST /api/payments -> ${first.r.status}`, JSON.stringify(first.r.json));
const sendId = first.r.json.payment?.id as string;

// 2. replay the SAME key once (new quote, identical payload)
console.log('2. replay the same idempotency key');
const replay = await pay(alice, 'send', 'bob', '1', 'Lunch money', key);
console.log(`  POST /api/payments -> ${replay.r.status}`, JSON.stringify(replay.r.json), '| same payment id:', replay.r.json.payment?.id === sendId);
const conflict = await pay(alice, 'send', 'bob', '2', 'Lunch money', key);
console.log(`  same key, different amount -> ${conflict.r.status} ${conflict.r.json.code}`);

const send = await waitResolved(sendId, 'send');
console.log(`  send resolved: ${send.status}, tx ${send.txHash}, actual fee ${send.actualFeeRaw ? formatUsdc(send.actualFeeRaw) : 'n/a'}`);

// on-chain proof that only one transfer exists
const reader = createViemReader();
const aliceWallet = db.select({ a: users.id }).from(users).where(eq(users.usernameNorm, 'alice')).get();
const rows = db.select().from(payments).where(eq(payments.userId, aliceWallet!.a)).all();
const bobWallet = send.toAddress;
const head = await reader.getBlockNumber();
const logs: any[] = [];
for (let f = send.startBlock; f <= head; f += 200) logs.push(...(await reader.getTransferLogs({ fromBlock: f, toBlock: Math.min(f + 199, head), recipients: [bobWallet] })));
const onChain = logs.filter((l) => l.from === send.fromAddress && l.value === 1_000_000n);
console.log(`  payment rows for alice: ${rows.length}; on-chain alice->bob 1 USDC transfers since block ${send.startBlock}: ${onChain.length}`);

// 3. bob withdraws 1 USDC to the external validation receiver
console.log('3. bob withdraws 1 USDC to', EXTERNAL);
const wd = await pay(bob, 'withdraw', EXTERNAL, '1', undefined, 'live-wd-' + Math.random().toString(36).slice(2, 12));
console.log(`  POST /api/payments -> ${wd.r.status}`, JSON.stringify(wd.r.json));
const w = await waitResolved(wd.r.json.payment.id, 'withdrawal');
console.log(`  withdrawal resolved: ${w.status}, tx ${w.txHash}, actual fee ${w.actualFeeRaw ? formatUsdc(w.actualFeeRaw) : 'n/a'}`);

// bob's view: the payment is a receipt with sender and note, not a deposit
await sleep(12_000);
const bobView = await summary(bob);
console.log('bob activity:', bobView.activity.map((a: any) => `${a.type} ${a.amount} ${a.counterpart}${a.note ? ' "' + a.note + '"' : ''} [${a.status}]${a.fee ? ' fee ' + a.fee : ''}`));
const aliceView = await summary(alice);
console.log('alice activity:', aliceView.activity.map((a: any) => `${a.type} ${a.amount} ${a.counterpart}${a.note ? ' "' + a.note + '"' : ''} [${a.status}]${a.fee ? ' fee ' + a.fee : ''}`));
const claimed = db.select().from(transfers).where(eq(transfers.txHash, send.txHash!)).all();
console.log('bob receipt row claimed by the send intent:', claimed.some((t) => t.claimedIntentId === sendId && t.kind === 'receipt'));

const after = { alice: await bal(alice), bob: await bal(bob) };
console.log('balances after:', after);
process.exit(0);
