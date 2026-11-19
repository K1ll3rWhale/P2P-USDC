# P2P USDC (Base Sepolia testnet)

Testnet demo: app-controlled wallets (Privy) holding test USDC on Base Sepolia. No real-money value.
This slice covers signup/login, wallet provisioning, and the Home and Wallet pages.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in values locally (never commit them).
3. `npm run db:migrate` creates the SQLite database in `data/` (gitignored).
4. `npm run dev`, then open http://localhost:3000.
5. Optional: `npm run demo:accounts` creates the `alice` and `bob` demo accounts through the normal signup path.
   Their password is `DEMO_PASSWORD` if set, otherwise a documented testnet-only default in the script.

Checks: `npm run typecheck`, `npm test` (deposit dedup, cursor restart, friend pairs, authorization), `npm run build`.

## Running the app and the worker
Run these in two terminals (the worker is a separate process, not tied to a browser tab):
1. `npm run dev` (or `npm run build` then `npm start`) serves the app on http://localhost:3000.
2. `npm run worker` scans Base Sepolia USDC `Transfer` logs into app wallets and confirms them after 3 blocks.
   - The first run starts `WORKER_START_LOOKBACK` blocks behind head (default 2000). Later runs resume from the saved
     cursor and re-scan a 10-block overlap, so restarts are safe (records are unique per tx hash and log index).
   - The public RPC limits `eth_getLogs` to 200 blocks; the worker detects this and shrinks its range. Set
     `BASE_SEPOLIA_RPC_URL` to a provider URL for faster catch-up.
   - Stop with Ctrl+C. Home and Activity refresh every 10 seconds, so deposits appear without a manual edit.
3. `npm run fund:demo` sends about 5 USDC to alice and bob from the validation sender wallet (needs
   `scripts/.privy-validate-state.json`), one at a time, waiting for on-chain confirmation. It never resends when an outcome is unclear.

Friends, Send, Activity and the Home recent list are available once signed in. Withdrawals are on the Wallet page.

## Sends and withdrawals
- The amount you enter is what the recipient receives; the sender also pays the actual USDC network fee. The quote shows an
  **estimated** fee (median of recent recorded fees, else 0.003 USDC). The actual fee is recorded after sending.
- Quotes last 30 seconds and are single-use. Notes are plain text, up to 140 characters. Demo maximum is 100 USDC.
- Sends go only to accepted friends. One unresolved transfer per wallet at a time (sends and withdrawals together).
- The worker resolves outgoing transfers from the chain (EntryPoint `UserOperationEvent`, then USDC Transfer logs). Keep
  `npm run worker` running or transfers stay pending. Nothing is ever resent automatically; a transfer with no result
  after 5 minutes is shown as taking longer than expected.
- Live test (needs the app on port 3111 and the worker running): `npx tsx scripts/live-core-test.ts`.

## Environment variable names (values go in `.env.local`, server-only)
- `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`, `PRIVY_AUTHORIZATION_KEY_ID`
- `BASE_SEPOLIA_RPC_URL` (optional; falls back to the public Base Sepolia RPC)
- `DATABASE_PATH` (optional; defaults to `data/app.db`)
- `WORKER_START_LOOKBACK` (optional; blocks behind head on the worker's first run, default 2000)
- `DEMO_PASSWORD` (optional; demo accounts only)
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (unused; CDP was skipped)

None are `NEXT_PUBLIC_*`. Never expose provider credentials to the browser.

## Notes
- Provider decision and observed behavior: `docs/provider-decision.md`.
- Wallets are created through `lib/wallet-adapter/` with the user ID as the write-once external ID, owned by our authorization key.
- Startup and balance reads verify chain ID 84532, the USDC contract and 6 decimals, and fail closed on mismatch.
- Rate limits live in `lib/ratelimit.ts` (`RATE_LIMITS`).
