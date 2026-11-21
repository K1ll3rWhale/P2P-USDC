# P2P USDC (Base Sepolia testnet)

A testnet demo of peer-to-peer USDC payments between friends. Users sign up, get an app-controlled wallet, deposit test
USDC, add friends, send to accepted friends, and withdraw to any external address. **Testnet only. Test funds only. No
real-money value.**

## Wallet model (read this first)
- Wallets are **app-controlled**: each user's wallet is created and held by the wallet provider (Privy). Users never see or
  hold a private key and cannot export it. The keys are protected by the provider, and only this app's server, holding the
  app's authorization key, can ask the provider to sign. Whoever operates the app can therefore move user funds. That is
  acceptable for a testnet demo and would need a different design (user-held keys or regulated custody) for real money.
- Wallets are normal Ethereum addresses on Base Sepolia (chain ID 84532) that use EIP-7702 delegation. USDC can be received
  at them like at any address. The USDC contract is `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals).
- **The chain is the source of truth.** Balances are read from the chain, and a transfer is only shown as confirmed after a
  successful receipt with the exact expected USDC Transfer, 3 blocks deep. Provider responses are treated as hints.

## Fees (an estimate first, then the recorded actual)
- The amount you enter is what the recipient receives. The sender also pays the **actual** network fee in USDC (the sender
  needs no ETH). The fee is never taken out of the recipient's amount, no buffer is added, and the app charges no fee.
- The provider gives no fee quote. The quote therefore shows an **estimated network fee**: the median of the last 10 recorded
  actual fees, or 0.003 USDC when none exist. It is an estimate and never a maximum.
- After the transfer confirms, the **actual fee** is read from the receipt (the sender's other USDC transfer(s) in the same
  transaction) and shown in Activity. Observed fees so far: 0.0028 to 0.0034 USDC.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values locally. Never commit them.
3. `npm run db:migrate` creates the SQLite database in `data/` (gitignored).
4. Optional: `npm run demo:accounts` creates `alice` and `bob` through the normal signup path.

## Environment variable names (values go in `.env.local`, server-only)
Required: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`, `PRIVY_AUTHORIZATION_KEY_ID`.
Optional: `BASE_SEPOLIA_RPC_URL`, `DATABASE_PATH`, `WORKER_START_LOOKBACK`, `TRUST_PROXY`, `PORT`, `DEMO_PASSWORD`, `CSP_REPORT_ONLY`.
Unused: `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (CDP was skipped).
None are `NEXT_PUBLIC_*`; secrets are never sent to the browser. `TRUST_PROXY=1` makes the app trust `x-forwarded-for` and
`x-forwarded-proto`; set it only behind a proxy you control (otherwise all clients share one rate-limit bucket).

## Run commands
| Command | What it does |
|---|---|
| `npm run demo:start` | Checks config (true/false only) and the chain, migrates, builds, then runs the web app and the worker together. Ctrl+C stops both. |
| `npm run demo:status` | Per account: on-chain balance vs the app's ledger, unresolved transfers, and how far the worker lags the chain. |
| `npm run demo:prepare -- --amount 5 alice bob` | Creates missing accounts and funds each from the validation sender, one at a time. Refuses if the sender cannot cover amounts plus estimated fees. Hard cap 20 USDC per run. |
| `npm run dev` / `npm run build` / `npm start` | The web app on its own (port 3000). |
| `npm run worker` | The worker on its own (deposits, receipts, outgoing transfers). Safe to stop and restart. |
| `npm run intents:status` | Lists unresolved sends/withdrawals and what the chain shows for each. |
| `npm run intents:resolve -- <id>` | Re-runs the chain check for one transfer. |
| `npm test`, `npm run typecheck` | Unit tests and type check. |
| `npm run security:check` | HTTP security checks against a running build (see `scripts/security-check.ts` for how to start it). |

The worker must be running for deposits to appear and for sends and withdrawals to resolve. After downtime it resumes from
its saved cursor, so a long outage means a long catch-up (about 2 minutes per 280,000 blocks on the public RPC).

## Money requests
A user can ask an accepted friend to pay them, with an optional note (Friends, then Money requests). The requester chooses an
expiry in whole days: 1 to 365, default 7. Below 1 becomes 1 and above 365 becomes 365, each with a message on screen; text that
is not a whole number becomes 7 with a message. Requests are never paid automatically: the friend presses Pay, which opens Send
with the recipient, amount and note filled in and the amount locked, and the normal quote, 30-second confirm and send path.
The server only accepts a payment for a request from its payer, to its requester, for its exact amount, while it is open, and
links only one payment to it at a time. A failed payment makes the request payable again; a confirmed one marks it paid.
Declining, cancelling and expiry never move money. Limits: at most 5 open requests per requester and friend, 20 new requests
per user per hour, amounts and notes follow the same rules as sends.

## Everyday features
- **Badges and Home card:** the Activity tab shows how many incoming transfers or resolved sends you have not looked at yet (opening
  Activity clears it); Friends shows incoming friend and money requests. Home shows a card when something is waiting.
- **Activity:** filter by type, status and UTC date (over your latest 200 items) and download **everything** (up to 2000 items) as CSV.
  Notes and names that start with a spreadsheet formula character are prefixed with an apostrophe so they cannot run. Exports are
  limited to 10 per minute.
- **Settings** (click your username): change your password (needs the current one, 5 attempts per 15 minutes; it signs out your other
  sessions) and see or sign out your other sessions. There is still no email, so no password reset.
- **Friends:** Remove a friend (either side, with a confirm step). Refused while a send between you is unresolved or a money request
  between you is open. Money requests: time left, one reminder per request per 24 hours (it floats to the top of the payer's list),
  and "Ask again" on a declined, cancelled or expired request.
- **Send:** "Use max" fills your balance minus the estimated network fee (capped at 100 USDC), recent recipients are listed first, and
  the quote shows the range of recent actual fees next to the estimate.

## Limits
- Per transfer: at most 100 USDC (demo maximum); amounts have at most 6 decimals. Notes are plain text, at most 140 characters.
- Quotes last 30 seconds and are single-use. Sends go only to accepted friends. One unresolved transfer per wallet at a time
  (sends and withdrawals together).
- Rate limits: login 10 per 15 minutes per identifier and 30 per IP; signup 20 per 15 minutes per IP; quotes 30 per minute per
  user; sends and withdrawals 10 per minute per user combined (constants in `lib/ratelimit.ts`).
- Withdrawals reject the zero address and any wallet that belongs to this app (use Send for those).

## Known issues and limitations
- **Worker dependency:** nothing resolves while the worker is down. `npm run demo:status` warns when the cursor is stale.
- **Public RPC:** it limits log queries to 200 blocks and may rate-limit. Base Sepolia currently produces about 5 blocks per
  second, so catch-up after downtime is slow. A keyed RPC (`BASE_SEPOLIA_RPC_URL`) is recommended for the demo.
- **Shallow confirmation depth:** 3 blocks is under a second at the current block time. Fine for a testnet demo.
- **No provider fee quote or reliable status:** the estimate can differ from the actual fee, and the provider returns an empty
  hash on send. The app finds the transaction on-chain instead. A transfer with no result after 5 minutes shows as "taking longer
  than expected"; it is never resent automatically.
- **A stuck transfer blocks its wallet** (one unresolved transfer per wallet) until it resolves or an operator marks it failed.
- **No email verification or password reset.** Demo accounts share a documented testnet password unless `DEMO_PASSWORD` is set.
- **Security headers:** every response carries a per-request-nonce Content-Security-Policy (scripts only with the nonce, same-origin connections, no framing), `nosniff`, `Referrer-Policy: same-origin` and `X-Frame-Options: DENY` (set in `proxy.ts`, policy in `lib/csp.ts`). The CSP has not been checked against every page in a real browser; if a page misbehaves, set `CSP_REPORT_ONLY=1` to send it as report-only. Single SQLite file, single node. HTTPS is expected to be terminated by a
  proxy; the session cookie is `Secure` only when the request is HTTPS.
- **Friend declines and cancels still delete the request row**, but a short history (accepted, declined, cancelled, removed) is kept
  and shown under Friends, Friend requests.
- `npm audit` reports 4 moderate findings, all in the dev-only `drizzle-kit` toolchain (old esbuild); production dependencies: 0.
- The browser UI was reviewed by reading the code and exercised over HTTP, not by an automated browser test.

## Recovery steps (nothing here ever resends a transfer)
1. **A transfer looks stuck:** `npm run demo:status`, then `npm run intents:status`. It prints the intent, provider IDs and what
   the chain shows (UserOperationEvent, matching Transfer log, receipt). Check the transaction on BaseScan.
2. **Re-check the chain:** `npm run intents:resolve -- <id>`. If a valid transaction exists it confirms (or fails) the transfer.
3. **Nothing on-chain, and you are sure:** `npm run intents:resolve -- <id> --confirm-no-onchain`. It prints exactly what was
   searched, and marks the transfer failed only if the intent is at least 5 minutes old and the full search finds nothing. That
   unblocks the wallet. Risk: if the provider lands the transaction later, the worker will still record the incoming transfer
   as an unclaimed receipt for the recipient, and the sender's balance will reflect the fee and amount.
4. **A new account has no wallet** ("Setting up your wallet"): press Retry. It reuses an existing remote wallet, never makes a second.
5. **The worker died:** `npm run worker` again. Records are unique per transaction and log, so restarting is safe.
6. **Balances look wrong:** `npm run demo:status` compares the chain with the app's records and explains the difference.
7. **Never claim a transfer is confirmed without a receipt**: use Activity ("Confirmed") or BaseScan.

## More
- `docs/demo-checklist.md`: the step-by-step demo script and what to do if the RPC or Privy stalls.
- `docs/provider-decision.md`: why Privy, the request shape that works, and observed fees.
