# P2P USDC Payment App on Base Sepolia
## Implementation specification

**Revision:** November 18, 2026  
**Demo target:** November 20, 2026  
**Document purpose:** Product and technical specification for implementation planning and staged delivery.

This document consolidates the original project specification, the planning review, and the latest decisions. It is intended to guide implementation in a separate Claude Code session. The user's private Claude may review the plan and help prepare prompts; it is not the implementation agent. This document contains no prompt for that private Claude.

### Status labels

- **Confirmed**: explicitly required or clarified by the user.
- **Recommendation**: a concrete implementation default, subject to the repo and a small feasibility check.
- **Open**: requires user input or evidence before the dependent feature is finalized.

---

## 1. Product summary

Build a responsive Venmo-style web app that lets two people send test USDC to each other by username. Each app account is provisioned with a wallet controlled by the application service through a wallet provider. The app server requests signatures and submits on-chain transfers; end users do not install a wallet extension and do not approve each transaction in a provider login flow.

Payments are real ERC-20 transfers on Base Sepolia. The chain is the source of truth for balances and settlement. The database stores app identity, friendships, payment notes, requests, and a searchable mirror of observed transaction metadata.

The app is a testnet prototype. It must prominently say that it uses Base Sepolia test tokens, that tokens have no intended real-world value, and that wallets are app/server controlled with keys protected by the selected wallet provider. Do not imply users control their private keys.

### Success definition

The demo succeeds when Alice and Bob can use two isolated browser sessions on one laptop to:

1. Sign up and receive different app-managed wallet addresses.
2. Deposit test USDC from an external wallet and see it detected without a manual database edit.
3. Find each other by username and become friends.
4. Send USDC with an understandable fee/total breakdown and an explicit confirmation step.
5. See the transfer confirmed on Base Sepolia and in both users' activity.
6. Withdraw USDC to an external address and verify the transaction.
7. Retry a request safely without creating a duplicate on-chain transfer.

The demo must run against Base Sepolia, with no mainnet funds or real money.

---

## 2. Decisions and implementation defaults

| Topic | Status | Specification |
|---|---|---|
| Product | Confirmed | Responsive web app for P2P USDC payments between friends by username. |
| Network | Confirmed | Base Sepolia, chain ID 84532. |
| Token | Confirmed, verify before use | Circle testnet USDC, six decimals. Candidate Base Sepolia contract: 0x036CbD53842c5426634e7929541eC2318f3dCF7e. Confirm against Circle's current published contract list and on-chain decimals before configuring it. |
| Transfer model | Confirmed | Direct ERC-20 transfers between the sender and recipient app wallet addresses. No custom payment contract is needed for the demo. |
| Identity | Confirmed | App signup/login uses email, username, and password. Provider wallet accounts are not the app's identity system. |
| Wallet provisioning | Confirmed | Automatically create one wallet per app user and store provider wallet ID and address. The service initiates transactions without an end-user signature prompt. |
| Key handling | Confirmed | Wallet keys remain with the selected provider. Never store private keys in the app database, repo, logs, browser, or user profile. |
| Provider | Open | Compare Privy and Coinbase CDP by the minimum Base Sepolia test. Do not select a final provider on docs alone. |
| Circle wallet product | Updated decision | The user does not have a Circle account. Do not make Circle Developer-Controlled Wallets, Gas Station, or Paymaster onboarding a prerequisite. Circle's public testnet faucet may still be used for test USDC. |
| Gas | Open, critical | Goal: the user should not need Base Sepolia ETH. Privy documents USDC user-pays on Base Sepolia; CDP documents gasless Base Sepolia smart-account user operations. Verify actual account flow and gas payer. |
| Fee display | Open | Sponsored gas is not a USDC fee paid by the user. Do not display a fabricated charge. Decide amount/fee semantics before implementing quote and confirmation UI. |
| Amount semantics | Open | Recommended default: amount entered is what the recipient receives; the confirmation shows network fee and total sender debit separately. For a sponsored transaction, show the user fee as zero and disclose that the app sponsors gas. |
| Balance | Confirmed | Read from the chain; no authoritative mutable balance column. A short-lived cache is acceptable, target maximum age 10 seconds. |
| Settlement | Recommendation from source spec | Mark confirmed only after a successful on-chain receipt and configured confirmation depth; use three blocks as the initial demo threshold. A provider webhook alone is not confirmation. |
| Pending timeout | Recommendation | After five minutes without a verifiable receipt, show the transaction as pending/stuck with a refresh action. Never automatically resend. |
| Scope cut line | Confirmed | Payment requests and optional polish are cut before deposits, friend flow, send, withdrawal, or reliable transaction status. |
| Spend | Confirmed | Claude usage ceiling is $40 for now; less is preferred. Do not proceed beyond $40 without asking the user. Use early checkpoints and a forecast review before the ceiling. |

### Correct fee and amount model

The prior source spec had conflicting fee math: it said the sender pays the fee while also subtracting that fee from the entered amount. The implementation must not reproduce that contradiction.

Recommended policy, pending confirmation:

- The amount the user enters is the amount the recipient should receive.
- The confirmation screen shows: recipient receives, estimated network fee, and estimated total sender debit.
- For Privy user-pays gas, the provider's actual stablecoin fee is a separate debit from the sending wallet. Show the fee as an estimate before confirmation and record the actual fee after execution. Do not add an arbitrary 20% buffer. If the provider supports a maximum fee or quote expiry, use it and explain it.
- For CDP sponsored/gasless gas, the user's USDC fee is 0.00 USDC. Network cost may be shown as informational text, clearly marked as paid by the app/provider.
- If there is no reliable fee quote before confirmation, do not label an estimate as exact. State the limit in the UI or use a sponsored route that does not charge the user.
- Never invent a separate app fee to make the UI appear to collect gas. A separate fee transfer is additional scope and is not in the initial plan.

---

## 3. Scope

### Required for the demo

- Email, username, and password signup/login; username uniqueness ignoring case.
- Automatic one-wallet-per-user provisioning.
- Wallet page with address, copy control, Base Sepolia and USDC instructions.
- Automatic detection of external USDC deposits.
- Username search, friend request, accept/decline, and accepted friends list.
- Send USDC to an accepted friend with optional note, fee quote, and confirmation.
- Withdraw USDC to an external address with validation and confirmation.
- Activity history for deposits, sends, and withdrawals, with consistent status and explorer links.
- Chain-derived balance with a short-lived cache.
- Server-side authorization, amount validation, idempotency, and safe transaction tracking.
- README with local setup, required environment variables, wallet model disclosure, gas/fee behavior, limitations, and demo steps.

### Cut first if delivery time is short

- Payment requests (request, approve, decline, cancel).
- Email verification.
- Nonessential animations, advanced polish, or extra profile fields.
- Provider webhooks if reliable polling works for the local demo.

### Out of scope

- Mainnet or real-money transfers.
- Fiat, bank, or card on-ramps.
- Multi-chain or mobile apps.
- Group payments, feeds, or nonpayment social features.
- Custom smart contracts.
- Production compliance program or security audit.
- User-controlled private keys or wallet-connect approval flows.

---

## 4. User flows

### Signup and wallet provisioning

1. User submits email, username, and password.
2. Server normalizes email and username, validates length/format/password policy, and enforces case-insensitive uniqueness.
3. Auth service creates the account and a profile with wallet provisioning state set to pending.
4. Wallet adapter creates one Base Sepolia wallet for that profile using a stable app user ID as external reference/idempotency key when supported.
5. Server stores provider, provider wallet ID, normalized address, chain ID, and wallet state.
6. Once provisioned, the account becomes active and the user sees Home with zero balance and a deposit action.
7. On provider or database failure, record a recoverable provisioning error. Do not silently create a login account that looks ready but has no wallet. Retry provisioning idempotently; if a wallet was created remotely before a DB error, query by stable external ID or provider wallet ID before creating another.

### Login/logout

- Authenticate against the app identity service, not a wallet provider account.
- Use server-side session cookies, not a wallet signature prompt.
- Logout revokes the server session and clears the cookie.
- Enforce email/username uniqueness and session ownership on every API call.

### Deposit

1. Wallet page displays the user's receiving address, Base Sepolia network, USDC token identity, copy button, and brief instructions.
2. User sends test USDC from an external wallet or requests it from Circle's public faucet.
3. Background watcher scans the configured USDC contract's Transfer logs for the user's wallet address.
4. Watcher creates a deposit record keyed by chain ID, transaction hash, and log index.
5. The app confirms it only after a successful transaction receipt and the configured confirmation depth.
6. Activity and chain-derived balance refresh without a manual database edit.

The Circle faucet is a token faucet, not the Circle Wallets product; using it does not imply Circle is the wallet provider.

### Friend request

- Search by username, excluding the current user.
- A request can be sent once per unordered user pair.
- Recipient can accept or decline. Sender can cancel while pending.
- Only accepted friends can receive in-app payments or requests.
- Prevent duplicate reciprocal rows; if the other party already requested friendship, surface the pending request for acceptance.

### Send

1. Sender chooses an accepted friend, enters an amount and optional note.
2. Server validates the session, friendship, positive amount, sender wallet state, and current chain balance.
3. Server obtains a short-lived quote, if supported by selected gas route.
4. Confirmation displays recipient amount, estimated user-paid fee or sponsored-by-app status, total sender debit, recipient identity, and quote expiry.
5. On confirmation, server rechecks current balance, friendship, quote expiry, amount, recipient address, and provider state.
6. Server creates or retrieves the idempotent transaction intent before submitting.
7. Wallet adapter submits one ERC-20 transfer. Persist operation ID and transaction hash as soon as available.
8. Worker checks chain receipt, event content, and confirmation depth. Update both activity views.

For gas paid separately in USDC, the ERC-20 transfer amount is the recipient amount and the provider gas charge is recorded separately. For sponsored gas, the ERC-20 transfer amount is the recipient amount; the app must not deduct a pretend fee.

### Withdraw

1. User enters an external EVM address and amount.
2. Server validates address, amount, wallet status, and balance.
3. Show destination in full or safely abbreviated with copy/review, fee model, and estimated total debit.
4. Require explicit confirmation.
5. Submit with idempotency key and track status using the same receipt verification lifecycle as send.
6. Display explorer link once a transaction hash exists.

### Payment requests (optional)

If time allows, requester selects an accepted friend, amount, and note. The payer may approve using the normal send flow at then-current quote, decline, or leave pending. Request approval must never bypass the regular send checks or create a transfer before explicit payer action.

---

## 5. Recommended architecture and stack

### Recommendation

Use the existing repository and its established conventions if present. Do not replace a working stack to match this document.

If starting from an empty repository:

- TypeScript with Next.js App Router for the responsive web app and server routes.
- PostgreSQL for app metadata. Supabase is a reasonable fast setup if already available; avoid adding a second auth system if the repo already has one.
- Server-side app authentication, with a standard session library or managed auth service; do not hand-roll password/session cryptography.
- viem for Base Sepolia reads, ERC-20 encoding, receipt/event verification, and address validation.
- A wallet-provider adapter so Privy/CDP choice does not leak through business logic.
- One worker process for deposit scanning and transaction polling. For the hackathon, this may live in the same repo and deployment, but it must not depend on a browser tab being open.
- A dedicated Base Sepolia RPC if accessible; otherwise use a public endpoint only for early spike, with retry/backoff and clear rate-limit behavior.
- Server environment variables for secrets. Never expose provider credentials through NEXT_PUBLIC variables.

### Logical components

1. Browser: pages and forms; never signs or submits privileged provider operations.
2. Next.js server/API: authentication, authorization, input validation, quotes, idempotency, transaction submission.
3. PostgreSQL: profiles, wallet mappings, friendships, transaction intents and observed logs.
4. Wallet adapter: common interface for create/get wallet, send ERC-20, quote fee, query operation, verify webhooks if chosen.
5. Chain reader: balances, logs, receipts, blocks, token contract metadata.
6. Worker: scans incoming Transfer logs, polls outgoing receipts, reconciles recent state.
7. Base Sepolia: canonical test network and source of truth.

### Provider adapter boundary

Expose a small interface such as:

- createWallet(appUserId) → providerWalletId, address, walletType
- getWallet(providerWalletId)
- sendToken(walletId, tokenAddress, recipient, amountBaseUnits, appOperationId) → providerOperationId, txHash if available
- estimateFee(operation) → supported flag, fee model, estimate and expiry if the provider can supply them
- getOperation(providerOperationId or txHash) → provider status and transaction hash
- verifyWebhook(headers, body) → verified event, if webhooks are enabled

Provider-specific response objects must not be returned to the browser or used as the app's state machine.

---

## 6. Wallet model and provider evaluation

### Wallet control model

The app identity belongs to the application. Each wallet is a provider-managed key/account associated to an app user. The backend makes authorized requests to the provider and initiates transfers; users do not individually sign each transfer. Wallet keys remain in the provider's protected key environment.

For user-facing disclosure, call this an **app-controlled or server-managed wallet with provider-protected keys**. Providers may use the term non-custodial for their infrastructure because they do not necessarily control the app's accounts. Do not imply the app user personally has self-custody or key recovery.

Access control must be enforced by the app server before every provider call. Provider policy features are additional defense, not a substitute for application checks.

### Current candidate comparison

| Provider | Documented fit | Important caveat | Current position |
|---|---|---|---|
| Privy | Service-controlled wallet ownership is configurable. Server-authenticated wallet API supports transaction requests. Its gas docs list USDC user-pays for Base Sepolia. | Confirm that user-pays works for the exact service-controlled Server Wallet/API flow, and that a usable quote can be shown before confirmation. App-paid native sponsorship has separate requirements, including TEE execution and configured chain/billing. | First candidate if a true user-paid USDC network fee is important and the spike passes. |
| Coinbase CDP | API Key Wallet docs describe programmatic account creation and server ownership/control with keys in a TEE. SDK docs support Base Sepolia smart accounts, USDC transfers, and gasless user operations by default on Base Sepolia. | Gasless means the user does not pay USDC gas; it does not fulfill a product requirement to charge the user an actual gas fee. Confirm how the chosen smart-account owner and transfer flow behave on the account. | Strong fallback for a fast no-test-ETH demo if app/provider sponsorship and zero user fee are acceptable. |
| Circle Developer-Controlled Wallets | Earlier planning review compared Circle Gas Station and Paymaster as separate mechanisms. | User has no Circle account and no reason to start Circle wallet onboarding now. Earlier review did not establish that Circle Paymaster works with the proposed developer-controlled wallet flow. | Not in initial validation. Circle may be used only for the public test USDC faucet unless both candidates fail and the user approves reconsideration. |

### Required feasibility gate

No full app feature may depend on a provider until the minimal test records:

- Wallet creation from the server using app-side identity only.
- A sender wallet and receiver wallet on Base Sepolia.
- One small USDC transfer to the expected recipient address.
- Successful on-chain receipt and matching ERC-20 Transfer event.
- Sender/receiver USDC balance changes.
- Whether sender needs native ETH.
- Who pays network gas, and whether an actual USDC fee was charged.
- Provider operation IDs, idempotency behavior, error path, and useful confirmation data.
- Dashboard/account requirements and any direct cost.

Provider decision rule:

1. If Privy service-controlled server flow can charge the sender USDC gas, provides an adequate pre-send estimate/guard, and completes a verified Base Sepolia transfer, select Privy.
2. Otherwise, if CDP's server-controlled smart-account flow completes a verified gasless Base Sepolia transfer, select CDP and revise the UI to show zero user gas fee and sponsorship disclosure.
3. If neither works, stop before building dependent flows. Report what failed and ask the user whether to accept pre-funded test ETH or revisit Circle. Do not quietly change the no-ETH requirement.

---

## 7. Chain and token configuration

- Network: Base Sepolia.
- Chain ID: 84532 decimal / 0x14a34 hex.
- Explorer: https://sepolia.basescan.org/tx/{transactionHash}
- Public RPC may be used for a brief spike; configure its URL in server environment, not client code.
- USDC token candidate: 0x036CbD53842c5426634e7929541eC2318f3dCF7e.
- Token decimals: six.
- Faucet: https://faucet.circle.com/ — select Base Sepolia and USDC.

Before any send or scanner implementation:
1. Confirm the contract address against Circle's current [USDC contract address list](https://developers.circle.com/stablecoins/usdc-contract-addresses).
2. Read token decimals on-chain and require six.
3. At startup or in a configuration check, verify the connected RPC returns chain ID 84532.
4. Verify the configured contract emits the ERC-20 Transfer event signature.
5. Fail closed on chain, token, or decimals mismatch. Never silently substitute bridged USDC or another token.

Store base-unit amounts as integers. Convert user-entered decimal amounts using exact decimal parsing; never use binary floating point for currency arithmetic.

---

## 8. Transaction lifecycle, deposits, and confirmation

### Outgoing lifecycle

Use states:

- **created**: validated request and intent are persisted; not yet submitted.
- **submitting**: provider request is in progress.
- **submitted**: provider accepted it, with provider ID and/or transaction hash persisted.
- **confirmed**: successful chain receipt, matching expected event, and configured block depth.
- **failed**: provider or chain reports definitive failure, or receipt reverted.
- **stuck**: derived display condition when submission has no terminal chain result after five minutes; retain an underlying submitted state and allow safe refresh/reconciliation.

Provider acceptance is not on-chain confirmation. Provider webhooks are hints and may be delayed, duplicated, or out of order. Chain receipt and event verification are authoritative.

On timeout after submission, query provider operation and chain by hash before retry. Never auto-resubmit an uncertain operation. A retry using the same application idempotency key returns the existing app transaction.

### On-chain verification

For a successful outgoing receipt:

- Receipt status must be success.
- Verify a Transfer log emitted by the configured USDC contract.
- Verify decoded from, to, and value match the persisted intent exactly.
- Store chain ID, transaction hash, log index, block number, timestamp if available, and confirmation time.
- If expected log is missing or mismatched, do not mark confirmed; flag for investigation.

For deposits, transaction hash and log index identify one transfer log. Reprocessing must be safe. Use uniqueness on (chain ID, token address, transaction hash, log index).

### Deposit scanner

- Scan bounded block ranges and persist a cursor.
- Query Transfer logs from/to the set of active app wallet addresses.
- On restart, replay an overlap window and deduplicate by chain/hash/log index.
- Commit inserted logs and cursor atomically where possible.
- Handle rate limits with backoff; do not advance cursor past a failed range.
- Reconcile a recent window against receipts so reorgs or transient RPC errors can be repaired.
- Use three blocks as the initial demo confirmation threshold, configurable in one place.
- Ignore other tokens and other chains.
- Do not infer a deposit solely from balance changes.

For the small hackathon user count, polling every 10–15 seconds is sufficient. Webhooks are optional. If used, validate provider signature, timestamp, and replay protections, then still verify on-chain.

### Balance

- Read ERC-20 balanceOf for the user's configured wallet address and token.
- Cache at most 10 seconds; show an as-of time or stale indicator when RPC is unavailable.
- Never alter balance by adding a database ledger amount. The ledger is a history/index, not the balance authority.
- Recheck sender balance immediately before submitting a send/withdrawal.

---

## 9. Data model

Use UUID primary keys, UTC timestamps, foreign keys, database migrations, and normalized lowercase usernames and EVM addresses. Keep token amounts as integer base units. Avoid a mutable balances table.

| Entity | Important fields | Constraints and notes |
|---|---|---|
| auth user | id, normalized email, password hash/identity provider fields, created_at | Prefer established auth service/library. Never return or log password/hash. |
| profile | user_id, username, normalized_username, created_at | One-to-one with auth user; normalized username unique. |
| wallet | id, user_id, provider, provider_wallet_id, address, chain_id, wallet_type, status, created_at | One per user and chain for demo; provider wallet ID unique; address unique per chain; provisioning states pending/active/failed. |
| friendship | id, requester_id, addressee_id, status, created_at, updated_at | No self-link; prevent duplicate unordered user pair; statuses pending/accepted/declined/cancelled. |
| transaction | id, type, sender_user_id, recipient_user_id, from_address, to_address, token_address, chain_id, amount_base_units, fee_base_units, fee_payer, fee_model, note, status, tx_hash, provider_operation_id, block_number, log_index, idempotency_key, failure_code, created_at, submitted_at, confirmed_at | App-level idempotency unique per user; observed deposit uniqueness by chain/token/hash/log index. Store exact intended transfer and observed result. |
| fee_quote | id, user_id, operation_type, recipient_address, amount_base_units, estimated_fee_base_units, estimated_total_debit, fee_model, provider_quote_id, expires_at, consumed_at, created_at | Immutable quote snapshot; short expiry (initially 30 seconds); bind to user and exact transaction parameters. |
| payment_request (optional) | id, requester_id, payer_id, amount_base_units, note, status, transaction_id, created_at, resolved_at | Only accepted friends; can be omitted until core payment flow is stable. |
| chain_cursor | chain_id, token_address, last_scanned_block, updated_at | One cursor per scanner/network/token; update with processed range. |
| provider_operation (optional) | id, transaction_id, provider, provider_operation_id, attempt_number, state, request_fingerprint, created_at | Supports reconciliation without storing secrets or full sensitive provider payloads. |

Indexes:
- unique normalized username.
- unique wallet per user and chain; unique chain and lowercase address.
- friendship pair uniqueness regardless of direction.
- transaction user history by created_at.
- unique transaction hash and log index for observed on-chain events.
- unique application idempotency key per initiating user.
- chain cursor lookup by chain and token.

Do not store a provider private key, wallet secret, authorization private key, raw session token, or full authentication cookie in the database.

---

## 10. API contracts

Use JSON over HTTPS. All routes except signup/login require a valid app session. Every route uses server-side authorization and validates ownership/participation. Use decimal strings for base-unit amounts in JSON to avoid JavaScript precision loss. UI decimal input is parsed exactly to six decimals on the server. Return stable error codes and a request ID; never return stack traces, secrets, or raw provider error bodies.

### Authentication and profile

- POST /api/auth/signup — email, username, password; creates profile and begins wallet provisioning.
- POST /api/auth/login — email/username and password; creates secure session.
- POST /api/auth/logout — revokes session and clears cookie.
- GET /api/me — user profile, username, wallet state/address, and cached chain balance.

Signup should return a provisioning state if wallet setup is asynchronous. The UI must not claim a wallet is ready until the provider wallet mapping is active.

### Friends

- GET /api/users/search?q={usernamePrefix}
- POST /api/friend-requests — recipient user ID or normalized username.
- GET /api/friends — accepted friends and incoming/outgoing pending requests.
- POST /api/friend-requests/{id}/accept
- POST /api/friend-requests/{id}/decline
- POST /api/friend-requests/{id}/cancel

### Quote and transfer

- POST /api/quotes — operation type, amount, recipient address/user, and optional withdrawal destination. Returns quote ID, amount, fee model, estimated fee, recipient amount, estimated total debit, fee payer, expiry, and whether the quote is exact or estimated.
- POST /api/payments — quote ID, recipient user ID, optional note, idempotency key.
- POST /api/withdrawals — quote ID, destination, idempotency key.
- GET /api/transactions?cursor={cursor}&limit={n}
- GET /api/transactions/{id}

Example quote response fields:

    {
      "quoteId": "uuid",
      "chainId": 84532,
      "token": "USDC",
      "amountBaseUnits": "10000000",
      "estimatedFeeBaseUnits": "12000",
      "recipientAmountBaseUnits": "10000000",
      "estimatedTotalDebitBaseUnits": "10012000",
      "feeModel": "user_pays_usdc",
      "feePayer": "sender",
      "expiresAt": "ISO-8601 timestamp",
      "isEstimate": true
    }

For sponsored gas, fee fields must clearly say user fee is zero, while any provider/network estimate is informational and app-paid. The example is illustrative; field semantics must match the selected fee model.

Idempotency behavior:
- Same key and same canonical request returns the original transaction object.
- Same key with different payload returns 409 Conflict.
- If prior submission is uncertain, return the original pending transaction and reconcile it; do not submit again.
- Application key maps to a provider idempotency key when supported. If a new provider attempt is required after definitive failure, preserve the original record and create a new attempt key; never mask a possibly submitted transfer.

Error codes should include validation_error, unauthorized, forbidden, insufficient_balance, quote_expired, quote_mismatch, conflict, provider_unavailable, transaction_pending, and chain_verification_failed.

### Optional webhooks

- POST /api/webhooks/{provider}
- Verify signature against raw request body, validate timestamp/replay window, store event ID for deduplication.
- A webhook can trigger reconciliation, but cannot alone transition an outgoing transaction to confirmed.

---

## 11. Frontend pages and behavior

| Page | Required content and actions |
|---|---|
| Signup/login | Email, username, password; password errors; testnet and app-managed wallet disclosure. |
| Home | Chain-derived USDC balance, last five transactions, Send/Request/Deposit shortcuts, balance freshness state. |
| Friends | Username search, incoming/outgoing requests, accepted list; add/accept/decline/cancel. |
| Send | Friend selector, amount, optional note, live quote, recipient amount, fee model, total debit, explicit confirmation. |
| Activity | Deposits, sends, withdrawals and optional requests; counterparty, amount, note, date, status and explorer link when hash exists. |
| Wallet | Wallet address, copy button, network/token instructions, faucet guidance, withdrawal form and confirmation. |
| Settings | Username, email, wallet address, sign out, testnet/custody disclosure. |

UX requirements:
- Never ask for a wallet address except for external withdrawal.
- Show USDC amounts to two decimals in summaries; show up to six decimals for fee/detail values so small testnet costs do not display as zero.
- Use consistent transaction statuses: pending, submitted, confirmed, failed. “Stuck” is a helper state for long-pending items.
- Disable confirmation while a request is submitting; show progress without encouraging duplicate clicks.
- If the quote expires, fetch a new quote and require a fresh confirmation.
- If provider/network is unavailable, fail closed and show a recoverable message.
- Render empty, loading, validation, insufficient-balance, pending, failed, and stale-balance states.
- Provide a Base Sepolia explorer link for every transaction with a hash.

---

## 12. Security and privacy requirements

Even on a testnet, use safe defaults:

- Secrets only in local/server environment variables or deployment secret storage. Never in source, browser bundles, issue text, screenshots, or logs. Never prefix secrets with NEXT_PUBLIC.
- User enters provider keys locally. Claude chats should receive variable names only, not secret values. Keep local secret files ignored by Git; verify before committing.
- Passwords handled by a reputable auth library/provider. If the repo requires custom password storage, use Argon2id or a vetted bcrypt implementation and rate-limit login.
- Session cookies: HttpOnly, Secure in hosted deployment, SameSite=Lax or stricter, expiry and rotation; revoke on logout. Protect state-changing routes from CSRF.
- Enforce object-level access checks on every user, wallet, friend, quote, request and transaction ID.
- Validate amounts as positive and within a configured demo maximum. Validate address checksum/format, configured chain and token, decimals, quote expiry, recipient, and balance server-side.
- Idempotency is mandatory for payment and withdrawal.
- Add rate limits for signup, login, search, quotes, and sends.
- Verify webhooks if enabled; dedupe and reconcile against chain.
- Minimize stored personal data. Avoid logging email, passwords, session tokens, authorization headers, signed payloads, and secret values.
- Use provider wallet policy controls and allowlists if easily available, but do not let policy setup block the core Base Sepolia validation unless required.
- Display a clear banner: Base Sepolia testnet, test funds only, app-controlled/server-managed wallets, provider-protected keys, no real-money value.
- If a secret is committed or printed into a log, stop, rotate it, remove it from history where possible, and check repo status before continuing.

---

## 13. Testing and verification plan

Do not attempt broad test coverage before the end-to-end payment works. Add focused checks as each slice is implemented.

### Unit and integration checks

- Email/username normalization and uniqueness.
- Exact decimal-to-base-unit conversion and rejection of more than six decimal places.
- Fee quote calculation, expiry, and fee-payer display for both sponsored and user-pays modes.
- Insufficient balance and maximum amount.
- Friend-pair uniqueness, self-friend prevention, and authorization.
- Signup/wallet provisioning retry and orphan recovery.
- Same idempotency key retry returns one intent; conflicting payload is rejected.
- ERC-20 Transfer log decoding and exact sender/recipient/value verification.
- Deposit deduplication by chain/hash/log index.
- Scanner restart, cursor overlap, RPC error retry, and recent reorg reconciliation.
- Provider timeout-after-submit reconciliation; no duplicate send.
- Webhook signature, timestamp, and replay rejection if webhooks are implemented.
- UI pending/confirmed/failed/empty/loading/stale states.

### Base Sepolia smoke/E2E check

- Create two app users and provider wallets.
- Fund with faucet USDC.
- Send a small transfer.
- Confirm receipt status and exact Transfer event.
- Verify sender and receiver balances.
- Verify app activity and explorer URL.
- Exercise a timeout/retry using the same idempotency key.
- Test withdrawal to a third wallet.
- Verify who pays gas and whether USDC was actually charged.

---

## 14. Acceptance criteria

### Product

- A new user can sign up and receives an active wallet address without installing wallet software.
- Usernames are unique case-insensitively.
- Alice and Bob are separate app accounts with separate wallet addresses.
- External test USDC deposits appear automatically without manual chain or database edits.
- Friend requests can be sent and accepted by username.
- Only accepted friends are eligible send recipients.
- Send confirmation clearly distinguishes recipient amount, user-paid fee (if any), app-sponsored gas (if any), and total sender debit.
- A successful send is verifiable on Base Sepolia and appears in both users' history.
- Withdrawal is explicit-confirmation only, verifiable, and visible in Activity.
- Balance is chain-derived and refreshed within the documented cache policy.
- Retrying the same request cannot cause a second transfer.
- No screen requests a user wallet address except withdrawal.
- No API key, provider secret, private key, raw session token, or unverified provider status is exposed to the user.

### Operational

- README explains setup, environment variables by name, local run commands, database migrations, wallet disclosure, provider choice, gas/fee behavior, and known limitations.
- A fresh checkout can be started from the README without manual database edits.
- The two-browser demo is rehearsed, with a recording or screenshots available if RPC/provider latency interrupts the live flow.
- Demo wallets are funded before the demo; do not depend on faucet availability at presentation time.

---

## 15. Two-browser demo on one laptop

Use two isolated browser contexts, such as one normal Chrome window and one Incognito window, so Alice and Bob keep independent session cookies. Keep a third tab for Base Sepolia Explorer. Do not use the same session in two tabs as proof of two accounts.

Preparation:
1. Start app and worker, confirm RPC and provider credentials load without printing secret values.
2. Create Alice and Bob accounts; record public wallet addresses only.
3. Request test USDC for both addresses from Circle faucet or fund from a test wallet.
4. Wait for deposits to confirm and verify on-chain balances.
5. Confirm friend request acceptance.
6. Check send quote and fee model; make sure amount semantics are consistent on screen.
7. Test one small payment and one withdrawal before the presentation.
8. Keep a short screen recording of the successful flow as a fallback.

Live flow:
1. Show app disclosure and Alice's wallet/balance.
2. Show Bob's separate window, wallet/balance, and accepted friendship.
3. Alice sends a small amount to Bob and reviews the fee/total.
4. Show pending → confirmed status and the Base Sepolia explorer receipt/event.
5. Show Bob's updated balance and both activity histories.
6. Bob withdraws a small amount to an external test wallet.
7. If time permits, demonstrate a safe same-key retry or payment request.
8. If RPC/provider stalls, explain the pending state and use the recording; never claim a transfer confirmed without a receipt.

---

## 16. Milestones through the November 20 demo

Dates are the target deadline, not a required work schedule. Work whenever available, including late hours, and move faster when possible. Preserve dependency order and cut optional work when time is short.

### Milestone 0 — Repo and credentials orientation

- Inspect the existing repo, README, package scripts, framework, and project instructions before editing.
- Confirm whether a database/auth setup already exists.
- Determine exact environment-variable names from the chosen provider SDK before asking the user to create .env.local.
- Add local secret file patterns to .gitignore before credentials are entered.
- Do not ask the user to paste secret values into either Claude chat.

### Milestone 1 — Minimal wallet/provider validation (first)

- Compare Privy and CDP in the smallest isolated Base Sepolia flow; no full app UI or friend system.
- Create server-controlled wallets for sender and receiver.
- Obtain test USDC.
- Send one small ERC-20 transfer and inspect receipt, event, balances, gas payer, quote capability, and retry behavior.
- Prefer completing the first candidate route, then test the second only if the first misses a required product condition.
- At about $3 in Claude usage for validation, stop and review actual spend and remaining forecast before extending the spike.
- Stop before projected total Claude usage exceeds $40; ask user before any work beyond that ceiling.
- Record selected provider and unresolved limitations in docs/provider-decision.md or README.

### Milestone 2 — App foundation and vertical slice

- Establish the app's current stack and environment configuration.
- Implement auth/profile, wallet provisioning state, wallet adapter, disclosure, Home and Wallet pages.
- Confirm signup creates/retrieves one wallet idempotently.
- Create the two demo accounts early.

### Milestone 3 — Chain balance and deposit detection

- Read balances from Base Sepolia.
- Implement bounded log scanner, cursor, replay overlap, deduplication, receipt check, confirmations and Activity records.
- Test with external deposits to Alice and Bob.

### Milestone 4 — Friend flow and core payment

- Username search, friend request, accept/decline.
- Implement amount semantics and quote display based on the selected gas model.
- Add send intent persistence, idempotency, provider submission, receipt/event verification, status polling.
- Complete Alice-to-Bob end-to-end send.

### Milestone 5 — Withdrawal and recovery

- External address validation and confirmation.
- Reuse transaction lifecycle and idempotency.
- Test success, failure, timeout-after-submit, refresh, and duplicate-click behavior.

### Milestone 6 — Demo readiness

- Complete README, visible disclosures, basic responsive design and errors.
- Fund and rehearse Alice/Bob accounts; verify external links.
- Capture demo recording and recovery plan.
- Add payment requests only if all required flows are stable.

### Hard scope cuts

If core payment is not complete by November 19:
1. Drop payment requests first.
2. Drop email verification and nonessential polish.
3. Keep demo to signup/pre-created users, deposit, friendship, send, activity, and explorer proof.
4. If provider/gas path remains blocked, stop and ask whether the user accepts a revised testnet-ETH requirement. Do not silently use a different gas model or claim user-paid USDC fees.

---

## 17. Claude Code workflow and budget controls

- The user's private Claude helps review the spec and prepare prompts. It does not implement the app. A separate Claude Code session implements.
- Begin with repo inspection and the minimal provider validation. Do not ask Claude Code to generate the whole app in one response.
- Work in small, reviewable milestones. Ask for a short plan before broad edits, then implement one vertical slice at a time.
- Preserve existing working code and conventions. Avoid unnecessary dependencies or rewrites.
- Keep source specs and this document as references; do not regenerate or overwrite blindly.
- Use targeted documentation lookups for provider-specific behavior. Recheck current docs at implementation time.
- Review each diff and focused command output before continuing. Do not run broad formatters or tests outside the current slice without reason.
- Track Claude usage after validation and at milestone boundaries. Target below $40; the user must approve before projected usage crosses $40.
- Keep optional polish, payment requests, and lengthy repeated debugging out of the budget-critical path.
- Distinguish Claude usage from provider service fees, database/hosting charges, and testnet faucet limits. Confirm any paid provider setting before enabling it.

---

## 18. Open questions to resolve before dependent implementation

1. **Provider selection:** Does Privy user-pays work from an app-controlled Server Wallet with server-side authorization on Base Sepolia? Can the app obtain a meaningful pre-send fee estimate? If not, does CDP's gasless smart-account send work from a service-controlled owner account?
2. **Amount meaning:** Confirm the recommended rule that the entered amount is the amount the recipient receives and a user-paid gas fee is additional sender debit.
3. **Fee tolerance:** If the pre-send estimate can differ from actual user-paid fee, what maximum fee/variance is acceptable? If the provider cannot support a cap or intelligible estimate, prefer sponsored gas and disclose zero user fee.
4. **No-ETH requirement:** Is no native test ETH essential for the demo, or may it be revised only with explicit user approval if both provider paths fail?
5. **Auth/hosting:** Is the repo already committed to an auth/database/hosting provider? Will the demo run locally or at a hosted URL? Webhooks require public callback access; polling can support local demos.
6. **Repo/submission:** Are there hackathon repository, README, licensing, or submission requirements?
7. **Post-demo data:** What should remain after the demo—test accounts, logs, usernames—or should it be reset?
8. **Provider access and charges:** Which provider account and test features are enabled? Confirm current pricing and any account/dashboard requirements before turning on paid gas sponsorship.
9. **Confirmation policy:** Keep three blocks as the initial demo threshold unless a current provider or hackathon requirement dictates otherwise.
10. **Failure behavior:** Confirm user-facing language for pending/stuck transfers and provider outages; do not auto-resend an uncertain transaction.

---

## 19. Official documentation references

Reopen these pages during implementation because provider features, account gates, and pricing can change.

- [Privy wallet policies and controls](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) — service-controlled wallet configurations and server authorization.
- [Privy gas sponsorship setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup) — app-pays and user-pays modes, server-side transaction interfaces, supported chains and tokens, Base Sepolia USDC.
- [Privy wallet external IDs](https://docs.privy.io/wallets/wallets/external-ids) — mapping app IDs to wallets where supported.
- [Coinbase CDP API Key Wallet quickstart](https://docs.cdp.coinbase.com/wallet-api/v2/introduction/quickstart) — programmatic account creation, server ownership/control, protected keys, testnet and transaction flow.
- [Coinbase CDP TypeScript SDK](https://github.com/coinbase/cdp-sdk/blob/main/typescript/packages/cdp-sdk/README.md) — Base Sepolia smart accounts, gasless user operations, USDC transfers and receipt flow.
- [Base chain ID documentation](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId) — Base Sepolia chain ID.
- [Circle USDC contract address list](https://developers.circle.com/stablecoins/usdc-contract-addresses) — verify the configured contract.
- [Circle testnet faucet](https://faucet.circle.com/) — obtain testnet USDC; this is separate from Circle's wallet products.
- [Base Sepolia explorer](https://sepolia.basescan.org/) — inspect public transaction receipts and token transfer logs.


