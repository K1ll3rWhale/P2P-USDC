// One command to start the demo: env check (true/false only), chain startup check, migrations, build, then the
// web app and the worker together. Ctrl+C stops both.
import '../lib/load-env';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { assertChainConfig, CHAIN_ID, USDC_ADDRESS } from '../lib/chain';
import { db } from '../lib/db';

const REQUIRED = ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'PRIVY_AUTHORIZATION_PRIVATE_KEY', 'PRIVY_AUTHORIZATION_KEY_ID'];
const port = process.env.PORT?.trim() || '3000';

console.log('1/4 Checking configuration (names only; values are never shown)');
const names = existsSync('.env.example')
  ? readFileSync('.env.example', 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]).filter((n): n is string => Boolean(n))
  : REQUIRED;
for (const n of new Set([...REQUIRED, ...names])) console.log(`    ${n}: ${Boolean(process.env[n]?.trim())}`);
const missing = REQUIRED.filter((n) => !process.env[n]?.trim());
if (missing.length) {
  console.error(`\nCannot start: these required settings are empty in .env.local: ${missing.join(', ')}.`);
  process.exit(1);
}

console.log('2/4 Checking the blockchain connection');
try {
  await assertChainConfig();
  console.log(`    OK: Base Sepolia (chain ${CHAIN_ID}), USDC contract ${USDC_ADDRESS} verified with 6 decimals.`);
} catch (e) {
  console.error(`\nCannot start: the chain check failed (${e instanceof Error ? e.message : 'unknown error'}). The demo refuses to run against the wrong network or token.`);
  process.exit(1);
}

console.log('3/4 Preparing the database and building the app (this takes a minute)');
migrate(db, { migrationsFolder: 'drizzle' });
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const build = spawnSync(process.execPath, [nextBin, 'build'], { stdio: 'inherit' });
if (build.status !== 0) {
  console.error('\nCannot start: the build failed (see the output above).');
  process.exit(1);
}

console.log('4/4 Starting the web app and the worker');
const children = [
  { name: 'web', child: spawn(process.execPath, [nextBin, 'start', '-p', port], { stdio: ['ignore', 'pipe', 'pipe'] }) },
  { name: 'worker', child: spawn(process.execPath, ['--import', 'tsx', 'scripts/worker.ts'], { stdio: ['ignore', 'pipe', 'pipe'] }) },
];
for (const { name, child } of children) {
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream?.on('data', (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) console.log(l.startsWith(`[${name}]`) ? l : `[${name}] ${l}`);
    });
  }
  child.on('exit', (code) => {
    console.error(`\n[${name}] exited (code ${code}). Stopping everything so you do not demo with half the system down.`);
    shutdown(1);
  });
}

let stopping = false;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) child.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

setTimeout(() => {
  console.log(`\nDemo is up. Open http://localhost:${port} (testnet only).`);
  console.log('The worker is running: deposits, receipts and outgoing transfers resolve from the chain automatically.');
  console.log('Check health any time with: npm run demo:status. Press Ctrl+C here to stop everything.\n');
}, 4000);
