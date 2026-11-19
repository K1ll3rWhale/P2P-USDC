// Deposit worker: scans USDC Transfer logs into app wallets and confirms them. Separate from the web app.
import '../lib/load-env';
import { assertChainConfig } from '../lib/chain';
import { resolvePayments } from '../lib/payments/resolve';
import { getWalletAdapter } from '../lib/wallet-adapter';
import { confirmOnce, DEFAULT_START_LOOKBACK, scanOnce } from '../lib/worker/scanner';
import { createViemReader } from '../lib/worker/viem-reader';

const POLL_MS = 5_000;
const ERROR_BACKOFF_MS = 15_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const lookbackEnv = Number.parseInt(process.env.WORKER_START_LOOKBACK ?? '', 10);
const startLookback = Number.isFinite(lookbackEnv) && lookbackEnv >= 0 ? lookbackEnv : DEFAULT_START_LOOKBACK;

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; console.log(`[worker] ${sig}, stopping after this pass`); });

await assertChainConfig(); // fail closed on any chain mismatch
console.log(`[worker] chain verified; first-run lookback ${startLookback} blocks`);
const reader = createViemReader();

while (!stopping) {
  try {
    const s = await scanOnce(reader, { startLookback });
    const c = await confirmOnce(reader);
    const adapter = getWalletAdapter();
    const r = await resolvePayments(reader, { hint: adapter.getTransactionHint?.bind(adapter) });
    if (r.confirmed || r.failed) console.log(`[worker] outgoing: ${r.confirmed} confirmed, ${r.failed} failed, ${r.open} still open`);
    if (s.changed || c.confirmed || c.dropped) {
      console.log(`[worker] scanned ${s.from}-${s.to}: ${s.changed} new/updated, ${c.confirmed} confirmed, ${c.dropped} dropped`);
    }
    await sleep(POLL_MS);
  } catch (e) {
    console.error('[worker] pass failed:', e instanceof Error ? e.message.slice(0, 300) : 'unknown error');
    await sleep(ERROR_BACKOFF_MS);
  }
}
console.log('[worker] stopped');
process.exit(0);
