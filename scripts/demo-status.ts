// Health check for the demo. Per active account: on-chain USDC balance vs the app's ledger view, unresolved
// intents, and how far the worker's cursor lags the chain head. Read-only.
import '../lib/load-env';
import { eq, inArray } from 'drizzle-orm';
import { formatUsdc } from '../lib/amount';
import { assertChainConfig, getUsdcBalance } from '../lib/chain';
import { db } from '../lib/db';
import { chainCursors, payments, transfers, users, wallets } from '../lib/db/schema';
import { CURSOR_KEY } from '../lib/worker/scanner';
import { createViemReader } from '../lib/worker/viem-reader';

await assertChainConfig();
const head = await createViemReader().getBlockNumber();
const cursor = db.select().from(chainCursors).where(eq(chainCursors.key, CURSOR_KEY)).get();
const lag = cursor ? head - cursor.lastBlock : null;
const cursorAge = cursor ? Math.round((Date.now() - cursor.updatedAt) / 1000) : null;

console.log(`Chain head ${head}. Worker cursor ${cursor ? cursor.lastBlock : 'none (worker has never run)'}${lag !== null ? `, lag ${lag} blocks, last updated ${cursorAge}s ago` : ''}.`);
if (lag === null) console.log('  WARNING: the worker has never run, so no deposits or outgoing transfers can be recorded.');
else if (cursorAge! > 120) console.log(`  WARNING: the cursor has not moved for ${cursorAge}s. The worker is probably NOT running (start it with npm run worker or npm run demo:start).`);
else if (lag > 50) console.log('  NOTE: the worker is behind. It is catching up; wait before trusting Activity.');
console.log('');

const rows = db
  .select({ id: users.id, username: users.username, address: wallets.address })
  .from(users)
  .innerJoin(wallets, eq(wallets.userId, users.id))
  .where(eq(users.status, 'active'))
  .all();

for (const u of rows) {
  const chain = (await getUsdcBalance(u.address, { fresh: true })).raw;
  const t = db.select().from(transfers).where(eq(transfers.userId, u.id)).all();
  const p = db.select().from(payments).where(eq(payments.userId, u.id)).all();
  let ledger = 0n;
  for (const x of t) if (x.status === 'confirmed') ledger += BigInt(x.amountRaw);
  for (const x of p) {
    if (x.status === 'confirmed') ledger -= BigInt(x.amountRaw) + BigInt(x.actualFeeRaw ?? 0);
    else if (x.status === 'failed' && x.actualFeeRaw) ledger -= BigInt(x.actualFeeRaw); // fee charged although the transfer failed
  }
  const pendingIn = t.filter((x) => x.status === 'observed').length;
  const open = p.filter((x) => x.status === 'created' || x.status === 'submitted');
  const diff = chain - ledger;
  console.log(`@${u.username}  ${u.address}`);
  console.log(`  on-chain balance ${formatUsdc(chain)} USDC | app ledger (confirmed records) ${formatUsdc(ledger)} USDC | difference ${formatUsdc(diff)}`);
  if (diff !== 0n) {
    const why = open.length || pendingIn
      ? 'There are unresolved items below, which explains a difference until they confirm.'
      : diff > 0n
        ? 'The chain holds MORE than the ledger: probably a deposit the worker has not recorded yet (or from before its start block).'
        : 'The chain holds LESS than the ledger: investigate (a fee or transfer the app has not recorded).';
    console.log(`  MISMATCH: ${why}`);
  } else console.log('  OK: the balance matches the confirmed records.');
  console.log(`  unresolved outgoing intents: ${open.length}${pendingIn ? `; incoming transfers waiting for confirmations: ${pendingIn}` : ''}`);
  for (const x of open) console.log(`    ${x.id} ${x.kind} ${formatUsdc(x.amountRaw)} USDC ${x.status}, age ${Math.round((Date.now() - x.createdAt) / 1000)}s (details: npm run intents:status)`);
  console.log('');
}
process.exit(0);
