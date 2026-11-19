// Creates demo accounts (normal signup path, skipping existing ones) and funds each from the validation sender,
// ONE AT A TIME, waiting for on-chain confirmation before the next. NEVER resends when an outcome is unclear.
//   npm run demo:prepare -- --amount 5 alice bob
import '../lib/load-env';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { signupUser } from '../lib/accounts';
import { formatUsdc, parseUsdcAmount } from '../lib/amount';
import { assertChainConfig, getUsdcBalance } from '../lib/chain';
import { db } from '../lib/db';
import { users, wallets } from '../lib/db/schema';
import { MAX_FUND_PER_RUN_RAW, planFunding } from '../lib/demo-funding';
import { estimateFeeRaw } from '../lib/fees';
import { provisionWallet } from '../lib/provisioning';
import { getWalletAdapter } from '../lib/wallet-adapter';
import { CONFIRMATIONS } from '../lib/worker/scanner';
import { createViemReader } from '../lib/worker/viem-reader';

const STATE = 'scripts/.privy-validate-state.json'; // gitignored: validation sender wallet + funding log
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

type Entry = { id: string; username: string; recipient: string; amountRaw: string; startBlock: number; userOp?: string; transactionId?: string; hash?: string; confirmed?: boolean; createdAt: number };
type State = { sender: { id: string; address: string }; prepareRuns?: Entry[] };

const args = process.argv.slice(2);
const ai = args.indexOf('--amount');
const amountText = ai >= 0 ? args[ai + 1] : undefined;
const usernames = args.filter((a, i) => !a.startsWith('--') && i !== ai + 1);
if (!amountText) die(`usage: npm run demo:prepare -- --amount <usdc each> <username...>   (hard cap ${formatUsdc(MAX_FUND_PER_RUN_RAW)} USDC per run)`);
const amount = parseUsdcAmount(amountText);
if (!amount.ok) die(amount.error);

migrate(db, { migrationsFolder: 'drizzle' });
await assertChainConfig();
const reader = createViemReader();
const state = JSON.parse(readFileSync(STATE, 'utf8')) as State;
state.prepareRuns ??= [];
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const sender = state.sender.address.toLowerCase();

/** Looks for our transfer on-chain (sender -> recipient, exact amount) since the entry's start block. */
async function findTransfer(e: Entry) {
  const head = await reader.getBlockNumber();
  const logs: Awaited<ReturnType<typeof reader.getTransferLogs>> = [];
  for (let f = e.startBlock; f <= head; f += 200) logs.push(...(await reader.getTransferLogs({ fromBlock: f, toBlock: Math.min(f + 199, head), recipients: [e.recipient] })));
  return logs.find((l) => l.from === sender && l.value.toString() === e.amountRaw) ?? null;
}

async function waitConfirmed(e: Entry) {
  let found = null;
  for (let i = 0; i < 60 && !found; i++) { found = await findTransfer(e); if (!found) await sleep(3000); }
  if (!found) die(`@${e.username}: outcome UNCLEAR. No matching Transfer on-chain yet (user_operation_hash ${e.userOp}). Do NOT resend. Ask before doing anything.`, 2);
  e.hash = found!.txHash; save();
  for (let i = 0; i < 60; i++) {
    const [r, head] = await Promise.all([reader.getReceipt(found!.txHash), reader.getBlockNumber()]);
    if (r?.status === 'reverted') die(`@${e.username}: tx ${found!.txHash} REVERTED. Stopping; do not resend without asking.`, 2);
    if (r && head - r.blockNumber >= CONFIRMATIONS) { e.confirmed = true; save(); console.log(`  funded @${e.username}: tx ${found!.txHash} (block ${r.blockNumber})`); return; }
    await sleep(3000);
  }
  die(`@${e.username}: tx ${found!.txHash} is not ${CONFIRMATIONS} blocks deep yet. Stopping; do not resend.`, 2);
}

// 0. Earlier unconfirmed funding sends must be settled first: never send more while an outcome is unknown.
for (const e of state.prepareRuns.filter((x) => !x.confirmed)) {
  console.log(`An earlier funding send to @${e.username} was never confirmed. Checking the chain (not resending)...`);
  await waitConfirmed(e);
}

// 1. Refuse unless the validation sender can cover the amounts plus estimated fees.
const senderBalance = (await getUsdcBalance(sender, { fresh: true })).raw;
const estFee = estimateFeeRaw();
console.log(`Validation sender balance: ${formatUsdc(senderBalance)} USDC. Estimated fee per send: ${formatUsdc(estFee)} USDC.`);
const plan = planFunding({ amountRaw: amount.raw, usernames, senderBalanceRaw: senderBalance, estFeeRaw: estFee });
if (!plan.ok) die(plan.error);
const ok = plan as Extract<typeof plan, { ok: true }>;
console.log(`Plan: ${formatUsdc(amount.raw)} USDC to each of ${ok.usernames.map((u) => '@' + u).join(', ')} (total ${formatUsdc(ok.totalRaw)} USDC, needs about ${formatUsdc(ok.neededRaw)} including fees).`);

const password = process.env.DEMO_PASSWORD?.trim() || 'demo-password-123';
for (const name of ok.usernames) {
  console.log(`\n@${name}`);
  let user = db.select().from(users).where(eq(users.usernameNorm, name.toLowerCase())).get();
  if (!user) {
    const r = await signupUser({ email: `${name.toLowerCase()}@example.com`, username: name, password }, 'script');
    if (!r.ok) die(`  signup failed: ${r.error}`);
    console.log(`  created account${r.walletReady ? '' : ' (wallet pending: ' + (r as { walletError?: string }).walletError + ')'}`);
    user = db.select().from(users).where(eq(users.id, (r as { userId: string }).userId)).get()!;
  } else {
    console.log('  account exists');
    if (user.status !== 'active') { const p = await provisionWallet(user.id); if (!p.ok) die(`  wallet setup failed: ${p.error}`); }
  }
  const w = db.select().from(wallets).where(eq(wallets.userId, user.id)).get();
  if (!w) die('  no wallet; cannot fund.');

  // Record BEFORE sending so a crash can never lead to a blind resend.
  const entry: Entry = { id: randomUUID(), username: name, recipient: w!.address, amountRaw: amount.raw.toString(), startBlock: await reader.getBlockNumber(), createdAt: Date.now() };
  state.prepareRuns.push(entry); save();
  try {
    const r = await getWalletAdapter().sendUsdcTransfer({ providerWalletId: state.sender.id, to: w!.address, amountRaw: amount.raw, referenceId: entry.id });
    entry.userOp = r.userOperationHash; entry.transactionId = r.transactionId; save();
  } catch (e) {
    die(`  send did not complete cleanly (${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}). It may or may not have been submitted: NOT resending. Run again to check the chain first.`, 2);
  }
  console.log(`  submitted (transaction_id ${entry.transactionId}); waiting for confirmation...`);
  await waitConfirmed(entry);
}
console.log(`\nDone. Validation sender balance now ${formatUsdc((await getUsdcBalance(sender, { fresh: true })).raw)} USDC.`);
process.exit(0);
