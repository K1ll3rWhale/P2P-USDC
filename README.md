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

Checks: `npm run typecheck`, `npm run build`.

## Environment variable names (values go in `.env.local`, server-only)
- `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`, `PRIVY_AUTHORIZATION_KEY_ID`
- `BASE_SEPOLIA_RPC_URL` (optional; falls back to the public Base Sepolia RPC)
- `DATABASE_PATH` (optional; defaults to `data/app.db`)
- `DEMO_PASSWORD` (optional; demo accounts only)
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (unused; CDP was skipped)

None are `NEXT_PUBLIC_*`. Never expose provider credentials to the browser.

## Notes
- Provider decision and observed behavior: `docs/provider-decision.md`.
- Wallets are created through `lib/wallet-adapter/` with the user ID as the write-once external ID, owned by our authorization key.
- Startup and balance reads verify chain ID 84532, the USDC contract and 6 decimals, and fail closed on mismatch.
- Rate limits live in `lib/ratelimit.ts` (`RATE_LIMITS`).
