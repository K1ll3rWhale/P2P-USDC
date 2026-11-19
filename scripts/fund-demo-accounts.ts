// Funds the alice and bob demo wallets from the validation sender wallet (external-deposit test).
// Sequential: each send must be confirmed on-chain before the next. NEVER resends when an outcome is unclear.
import '../lib/load-env';
import { readFileSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { encodeFunctionData, erc20Abi, formatUnits, getAddress } from 'viem';
import { assertChainConfig, getUsdcBalance, USDC_ADDRESS } from '../lib/chain';
import { db } from '../lib/db';
import { users, wallets } from '../lib/db/schema';
import { privySignedRpc } from '../lib/wallet-adapter/privy-rpc';
import { CONFIRMATIONS } from '../lib/worker/scanner';
import { createViemReader } from '../lib/worker/viem-reader';

const STATE = 'scripts/.privy-validate-state.json'; // gitignored; holds the sender wallet + progress
const AMOUNT = 5_000_000n; // 5 USDC
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Entry = { startBlock: number; userOp?: string; transactionId?: string; hash?: string; confirmed?: boolean };
const state = JSON.parse(readFileSync(STATE, 'utf8')) as { sender: { id: string; address: string }; fund?: Record<string, Entry> };
state.fund ??= {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

await assertChainConfig();
const reader = createViemReader();
const sender = state.sender.address.toLowerCase();

/** Looks on-chain for our transfer (sender -> recipient, exact amount) since startBlock. */
async function findTransfer(recipient: string, startBlock: number) {
  const head = await reader.getBlockNumber();
  const logs = await reader.getTransferLogs({ fromBlock: startBlock, toBlock: head, recipients: [recipient] });
  return logs.find((l) => l.from === sender && l.value === AMOUNT) ?? null;
}

async function waitConfirmed(name: string, e: Entry, recipient: string) {
  let found = null;
  for (let i = 0; i < 60 && !found; i++) {
    found = await findTransfer(recipient, e.startBlock);
    if (!found) await sleep(2000);
  }
  if (!found) {
    console.error(`${name}: outcome UNCLEAR, no matching Transfer on-chain yet (user_operation_hash ${e.userOp}). Do NOT resend. Ask before doing anything.`);
    process.exit(2);
  }
  e.hash = found.txHash;
  save();
  for (let i = 0; i < 60; i++) {
    const [r, head] = await Promise.all([reader.getReceipt(found.txHash), reader.getBlockNumber()]);
    if (r && r.status === 'success' && head - r.blockNumber >= CONFIRMATIONS) {
      e.confirmed = true;
      save();
      console.log(`${name}: confirmed in block ${r.blockNumber}, tx ${found.txHash}`);
      return;
    }
    if (r && r.status === 'reverted') {
      console.error(`${name}: tx ${found.txHash} REVERTED. Stopping; do not resend without asking.`);
      process.exit(2);
    }
    await sleep(2000);
  }
  console.error(`${name}: tx ${found.txHash} not yet ${CONFIRMATIONS} blocks deep after waiting. Stopping; do not resend.`);
  process.exit(2);
}

for (const name of ['alice', 'bob']) {
  const row = db
    .select({ address: wallets.address })
    .from(wallets)
    .innerJoin(users, eq(users.id, wallets.userId))
    .where(eq(users.usernameNorm, name))
    .get();
  if (!row) { console.error(`${name}: no wallet in the database. Run npm run demo:accounts first.`); process.exit(1); }
  const recipient = row.address.toLowerCase();

  const existing = state.fund[name];
  if (existing?.confirmed) { console.log(`${name}: already funded (tx ${existing.hash}), skipping`); continue; }
  if (existing) {
    console.log(`${name}: a send was already submitted earlier; checking the chain, NOT resending`);
    await waitConfirmed(name, existing, recipient);
    continue;
  }

  const bal = await getUsdcBalance(sender); // cached up to 10s; fine for a sufficiency check
  if (bal.raw < AMOUNT + 100_000n) { console.error(`sender has only ${bal.formatted} USDC; need about 5.1`); process.exit(1); }

  const startBlock = await reader.getBlockNumber();
  const entry: Entry = { startBlock };
  state.fund[name] = entry;
  save(); // record BEFORE sending so a crash can never lead to a blind resend
  const resp = await privySignedRpc<{ data: { transaction_id?: string; user_operation_hash?: string; hash?: string } }>(state.sender.id, {
    method: 'eth_sendTransaction',
    caip2: 'eip155:84532',
    chain_type: 'ethereum',
    sponsor: true,
    sponsor_options: { asset: 'usdc' },
    params: { transaction: { to: USDC_ADDRESS, value: '0x0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [getAddress(recipient), AMOUNT] }) } },
  });
  entry.userOp = resp.data.user_operation_hash;
  entry.transactionId = resp.data.transaction_id;
  save();
  console.log(`${name}: submitted (transaction_id ${entry.transactionId}, user_op ${entry.userOp}); waiting for confirmation`);
  await waitConfirmed(name, entry, recipient);
}
console.log(`sender balance now ${formatUnits((await getUsdcBalance(sender)).raw, 6)} USDC (cache may lag up to 10s)`);
