// Recovery tooling for unresolved send/withdrawal intents. NEVER resends anything.
//   npm run intents:status
//   npm run intents:resolve -- <intent-id-or-prefix>
//   npm run intents:resolve -- <intent-id-or-prefix> --confirm-no-onchain
import '../lib/load-env';
import { inArray } from 'drizzle-orm';
import { abbreviateAddress, formatUsdc } from '../lib/amount';
import { assertChainConfig } from '../lib/chain';
import { db } from '../lib/db';
import { payments, users } from '../lib/db/schema';
import { inspectIntent, type IntentInspection, operatorFailIntent, resolveIntent } from '../lib/payments/resolve';
import { getWalletAdapter } from '../lib/wallet-adapter';
import { createViemReader } from '../lib/worker/viem-reader';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const idArg = rest.find((a) => !a.startsWith('--'));
const mins = (ms: number) => `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;

function describe(r: IntentInspection) {
  console.log(`  searched blocks ${r.searchedFrom}..${r.searchedTo}`);
  console.log(`  UserOperationEvent for user_operation_hash ${r.userOpHash ?? '(none stored)'}: ${r.userOpEvents.length ? r.userOpEvents.map((e) => `tx ${e.txHash} block ${e.blockNumber} success=${e.success}`).join('; ') : 'not found'}`);
  console.log(`  USDC Transfer log from ${abbreviateAddress(r.transferSearch.from)} to ${r.transferSearch.recipient} of ${formatUsdc(r.transferSearch.amountRaw)} USDC: ${r.transferMatches.length ? r.transferMatches.map((m) => `tx ${m.txHash} block ${m.blockNumber}`).join('; ') : 'not found'}`);
  console.log(`  candidate transaction: ${r.candidateTx ?? 'none'}; receipt: ${r.receipt}${r.verification ? `; verification: ${r.verification.ok ? 'ok, actual fee ' + formatUsdc(r.verification.actualFeeRaw) : r.verification.reason}` : ''}`);
}

async function main() {
  await assertChainConfig();
  const reader = createViemReader();

  if (cmd === 'status') {
    const open = db.select().from(payments).where(inArray(payments.status, ['created', 'submitted'])).all();
    if (open.length === 0) return console.log('No unresolved intents. All wallets are free to send.');
    const names = new Map(db.select({ id: users.id, u: users.username }).from(users).all().map((r) => [r.id, r.u]));
    const head = await reader.getBlockNumber();
    const adapter = getWalletAdapter();
    console.log(`${open.length} unresolved intent(s). Current block ${head}. Provider status is a hint only; the chain decides.\n`);
    for (const p of open) {
      console.log(`${p.id}  ${p.kind}  @${names.get(p.userId)}  ${formatUsdc(p.amountRaw)} USDC -> ${abbreviateAddress(p.toAddress)}  status=${p.status}  age ${mins(Date.now() - p.createdAt)}`);
      console.log(`  provider: transaction_id ${p.transactionId ?? '(none)'}, user_operation_hash ${p.userOpHash ?? '(none)'}, stored tx ${p.txHash ?? '(none)'}, last provider status ${p.providerStatus ?? '(unknown)'}`);
      if (p.transactionId && adapter.getTransactionHint) {
        try { console.log(`  provider hint now: ${JSON.stringify(await adapter.getTransactionHint(p.transactionId))}`); } catch { console.log('  provider hint: unavailable'); }
      }
      describe(await inspectIntent(reader, p, head));
      console.log('');
    }
    return;
  }

  if (cmd === 'resolve') {
    if (!idArg || idArg.length < 8) return console.log('usage: npm run intents:resolve -- <intent-id-or-prefix> [--confirm-no-onchain]');
    const all = db.select().from(payments).all().filter((p) => p.id.startsWith(idArg));
    if (all.length !== 1) return console.log(all.length === 0 ? 'No intent matches that id.' : 'That prefix matches several intents; use more characters.');
    const id = all[0].id;
    const r = await resolveIntent(reader, id, { hint: getWalletAdapter().getTransactionHint?.bind(getWalletAdapter()) });
    console.log(`chain check result: ${r.result}`);
    if (r.result !== 'open') return;
    if (!flags.has('--confirm-no-onchain')) {
      console.log('Still unresolved. If you are certain nothing landed on-chain, re-run with --confirm-no-onchain (it prints what was searched first).');
      return;
    }
    const f = await operatorFailIntent(reader, id);
    if (f.report) { console.log('What was checked:'); describe(f.report); }
    if (!f.ok) return console.log(`NOT marked failed: ${f.reason}`);
    console.log('Nothing matching exists on-chain. Marked FAILED. The sender wallet is unblocked. Nothing was resent.');
    return;
  }
  console.log('usage: npm run intents:status | npm run intents:resolve -- <id> [--confirm-no-onchain]');
}

await main();
process.exit(0);
