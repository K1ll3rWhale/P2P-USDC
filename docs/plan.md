# Planning Review: P2P USDC Payment App

Nov 16, 2026 · @Akhil

## 1. Bottom line

Your documentation check supports the design, so the next step is a short validation of the wallet and gas route, not an app build, and the whole plan now has to fit a $40 ceiling.

- **Design settled by your check.** The providers document app-controlled wallets created and used from the server, with keys protected by the provider and no person approving each transfer. What stays open is account-specific feature access and the best gas route, and one minimal Base Sepolia test settles both.
- **Candidates.** Coinbase CDP is first: its smart accounts page, which I opened, shows a server-created owner account, a Base Sepolia smart account, an encoded ERC-20 transfer, and sponsored user operations on Base Sepolia with no ETH needed. Privy is second: service-controlled wallets and USDC user-pays gas on Base Sepolia are documented, and the early check is whether user-pays works with the exact Server Wallet configuration we choose. Circle is a last-resort fallback only, with no account and no onboarding unless both others prove unsuitable.
- **Gas ladder (unchanged).** Try a user-paid USDC route first. If that cannot be proven quickly, use app-sponsored gas shown as "Paid by the app" with no USDC fee. If neither works, stop and ask about pre-funded test ETH.
- **Order by dependency, not pace.** Milestones are sequenced by what blocks what and by priority. Nov 20 is the only date.
- **Budget.** $40 is a hard ceiling for Claude usage, and less is preferred. The plan caps each milestone, checks spend at each one, and stops to ask before going over. My forecast is $17 to $39, so it fits only with Sonnet-first work and no Opus (section 6).
- **Roles.** This session reviews the specification and plans only, and never implements. A separate Claude Code session does all implementation (section 8).

## 2. Contradictions and unsafe assumptions

Your answers settle most of the eight problems I flagged; what remains becomes a spike check. Status is as of your corrections.

| # | Problem | Status | What remains |
| --- | --- | --- | --- |
| 1 | Amount math contradicted itself | Settled (D1): the amount entered is the recipient's amount; the sender's debit is that plus any separately charged USDC fee; gas is never subtracted from the recipient's amount | The send screen must show amount, fee, and total debit as three lines |
| 2 | "No test ETH" versus "visible USDC fee" | Settled as a ladder (D2): user-paid USDC paymaster, then app-sponsored gas labeled "Paid by the app" with a $0 USDC fee, then stop and ask about pre-funded ETH | Never describe sponsored gas as a fee charged to the user |
| 3 | The 20% quote buffer | Settled (D3): dropped; show a labeled estimate, then store the actual charge | Circle's Paymaster charges the user 10% on top of gas, so record that as part of the fee. Promise a maximum only if the implementation enforces one |
| 4 | Two sources of "confirmed" | Settled (D6): confirmed means a successful receipt plus three blocks; Circle's COMPLETE and FAILED are terminal, CONFIRMED is not | Reconcile stuck or unknown transactions; never resend them |
| 5 | EOA, SCA, and EIP-7702 accounts behave differently | Open, to be proven by the spike (D8) | Test initialization or deployment, first-use behavior, and fee settlement from a fresh account in each candidate |
| 6 | App login versus provider login | Settled in principle (D5): app-owned auth, server-side wallets, no Embedded Wallets if they are user-controlled | Verify the exact Server Wallet configuration of each candidate before relying on it |
| 7 | Idempotency across providers | Settled as a design (D7): one app-level intent and key, one provider key per attempt, new attempt record for a deliberate retry | Test what each provider does with a reused key from a failed request |
| 8 | My earlier advice was firmer than the docs support | Corrected: I treated Circle as the default and USDC-paid gas as likely; neither is proven, and Circle is now a last-resort fallback | Keep every provider unranked until a spike passes |

**What your documentation check changes**

- **Circle is a fallback only.** Whether Gas Station is limited to select enterprise customers no longer matters unless Circle is needed. I could not find that limit on Circle's Wallets page, where the "select enterprise customers" footnote belongs to Compliance Engine.
- **Privy.** Your check and the gas overview page I opened agree that USDC user-pays gas exists for Base Sepolia. The open question is whether it works with the specific app-controlled Server Wallet configuration we choose; app-pays sponsorship is a separate option with its own requirements.
- **CDP.** The smart accounts page I opened confirms a server-created owner account, a Base Sepolia smart account, an encoded ERC-20 transfer, and subsidized user operations on Base Sepolia. It shows no USDC fee path, so on CDP the user's gas fee is zero.
- **Wallet-model wording.** Say "app-controlled wallets with provider-protected keys" and do not call CDP a custodian, because CDP's docs describe these projects as non-custodial. Whether any legal definition of custody applies to the app is outside this review.
- **CDP link.** The Base Sepolia paymaster quickstart link in your earlier corrections pointed to an amplifyapp.com address, not a Coinbase domain, so I relied on docs.cdp.coinbase.com.

## 3. Prioritized risk register

The first four risks are unknowns that the validation milestone resolves, so they stay marked Unknown until a real Base Sepolia transfer and receipt prove otherwise. Likelihood and impact are my judgment, not measured.

| # | Risk | Likelihood | Impact | Mitigation | Stop condition |
| --- | --- | --- | --- | --- | --- |
| 1 | **Unknown:** no candidate has yet been shown sending Base Sepolia USDC from a fresh server-created account | Medium | High | Minimal validation with CDP first, then Privy; follow the gas ladder in D2 | Neither passes: ask whether pre-funded test ETH is acceptable, and ask before considering Circle |
| 2 | **Unknown: account-specific feature access.** CDP project setup, smart accounts, and the paymaster on this account; Privy Server Wallet, user-pays gas, TEE execution, and dashboard billing | Medium | High | Create the CDP and Privy accounts first and check each console. No Circle account is needed | A candidate has no working API access right away: drop it |
| 3 | **Unknown:** Privy user-pays gas with the exact app-controlled Server Wallet configuration we would ship | Medium | High | Early check in the validation. Privy's app-pays sponsorship is a separate option with its own requirements | Not working: use the app-sponsored path or CDP |
| 4 | **Unknown:** the CDP route with the server-owner flow we would ship, including first-use deployment and a USDC transfer through an encoded call | Medium | High | Early check in the validation. The ordinary CDP EOA quickstart is not evidence | Needs bundler or signing work beyond the validation: drop it |
| 5 | Sender debit does not equal amount plus fee in the UI, quote, ledger, and chain | Medium | Medium | Store amount, fee, and total debit separately; test the quote against a real receipt | Any mismatch between quote, receipt, and ledger |
| 6 | Fee surprises: actual cost can differ from the estimate, and a provider may add a surcharge | Medium | Medium | Label the estimate, store the actual charge, and promise a maximum only if the implementation enforces one | None; verify the real fee in the validation |
| 7 | Duplicate or lost sends after timeouts | Medium | High | App-level intent and key, a new provider key per attempt, query provider and chain first, never auto-resend | Any duplicate on-chain transfer: freeze sends until fixed |
| 8 | Deposit scanner misses or double-credits transfers | Medium | High | Bounded ranges with overlap, unique chain, hash, and log index, atomic cursor writes, recent-block reconciliation | Any mismatch between chain balance and ledger |
| 9 | Provider status and chain state disagree (stuck, late, or missing status) | Medium | Medium | Chain receipt plus three blocks is authoritative; show pending or stuck and reconcile | None; handled in design |
| 10 | Wrong token or faucet network (Ethereum Sepolia USDC instead of Base Sepolia) | Medium | High | Verify the contract, decimals, and Transfer event on-chain at startup; use Circle's faucet Base Sepolia option; pre-fund before rehearsal | Startup token check fails: do not run |
| 11 | Dependency slip: Nov 20 is the target, and the pace is flexible | High | High | Keep the dependency order; cut payment requests, email verification, and polish first | Core transfer path not working near the target: freeze scope and demo deposit, send, and withdraw only |
| 12 | Demo fragility from RPC latency, faucet limits, or provider outage | Medium | High | Pre-fund demo wallets before rehearsal, never depend on the live faucet, keep a recording as fallback | None; rehearse before the target |
| 13 | Key exposure or missing authorization checks | Low | High | Keys stay protected by the provider; API keys and wallet secrets are server-only; ownership checks on every wallet route; visible disclosure banner | Any secret committed: rotate it immediately |
| 14 | Claude spend exceeds the $40 hard ceiling | Medium | High | Milestone caps, usage checkpoints, Sonnet-first work, and no Opus without your approval | At $38, or when a milestone cap is passed, stop and ask before any more spend |
| 15 | Circle turns out to be needed after all | Low | Medium | Ask first; start Circle onboarding only if CDP and Privy both prove unsuitable | Do not start Circle onboarding without your approval |

## 4. Provider candidates and early checks

Coinbase CDP is the first route to verify and Privy the second, and neither is the final choice. Circle is only a fallback. Each row says what the docs show and what the early check must prove.

| Candidate | Wallet model and gas | What the docs show | Early check |
| --- | --- | --- | --- |
| [Coinbase CDP smart account with a server-created owner](https://docs.cdp.coinbase.com/wallets/using-wallets/smart-accounts.md) | App-controlled owner account created through the server API. CDP describes these wallet projects as non-custodial. On Base Sepolia, user operations are subsidized, so the user pays no gas and no USDC fee | I opened the page. A Node call creates the owner account, then the smart account; the contract is not deployed until the first user operation; no ETH funding is needed on Base Sepolia; an ERC-20 transfer is shown as an encoded call; reverts surface in receipts | A fresh account sends test USDC through a user operation; check the receipt, Transfer event, first-use deployment, and that the server-owner flow works with the account API we would ship |
| [Privy Server Wallet](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview.md) | Service-controlled wallet with server-side transaction requests. User-pays USDC gas on Base Sepolia is documented and collected by an Alchemy ERC-20 paymaster. App-pays sponsorship is separate and requires TEE execution | I opened the gas overview. Its user-pays table lists USDC for Base Sepolia, and the fee is taken from the wallet's token balance. Through the transfer API, the gas token is the token being transferred | Whether user-pays works with the specific app-controlled Server Wallet configuration we choose; what dashboard billing it needs; the actual fee charged and the receipt |
| [Circle developer-controlled wallets](https://www.circle.com/wallets) | Server-controlled wallets with Gas Station (app pays, plus 5%) or Circle Paymaster (user pays USDC, with a 10% surcharge) | I opened the pages. Paymaster deployment on Base Sepolia is unconfirmed, and Gas Station access depends on the account | Not started. No Circle account and no onboarding unless CDP and Privy both prove unsuitable, and only with your approval |

**Pass criteria for every candidate.** A fresh account must send the selected Base Sepolia test USDC contract, and we must verify the on-chain receipt, the Transfer event, the fee behavior, and what happens on first use, including any account initialization or deployment. If neither CDP nor Privy passes quickly, follow the gas ladder in D2, and ask before adding Circle or changing the no-test-ETH requirement.

## 5. Decisions

Ten decisions are settled by your answers and checks, and two stay open until the validation milestone runs. The provider rule at the end turns the validation results into a choice without ranking anyone in advance.

| ID | Decision | Status | What it means for the build |
| --- | --- | --- | --- |
| D1 | Amount semantics | Settled | The amount entered is what the recipient receives. The sender's debit is that amount plus any separately charged USDC fee. Gas is never subtracted from the recipient's amount. With app-sponsored gas, the recipient gets the entered amount and the user pays no USDC fee. |
| D2 | Gas model | Settled | Prefer no test ETH for users. First test a user-paid USDC route on Base Sepolia. If that cannot be proven quickly, use app-sponsored gas, show the estimated cost as "Paid by the app", and charge zero USDC. Never describe sponsored gas as a fee charged to the user. If neither works, stop and ask about pre-funded test ETH. |
| D3 | Quote behavior | Settled | No 20% buffer. Show a labeled estimate before confirmation, then store the actual charge from the completed transaction or paymaster receipt. Verify the chosen provider's real fee and settlement, because a provider surcharge is not gas cost alone. Promise a maximum only if the implementation enforces one. |
| D4 | Provider choice | Open | Run the smallest useful validation for CDP first, then Privy. Circle is considered only if both prove unsuitable, and only with your approval. A candidate passes by the criteria in section 4. |
| D5 | Wallet model and authentication | Settled | Keep username and password auth independent of the wallet provider. Wallets are app-controlled: created and used from the server, with keys protected by the provider and no person approving each transfer. Describe the model that way, and do not call CDP a custodian, since CDP describes these APIs as non-custodial. Do not choose Embedded Wallets if their user-controlled approval conflicts with automatic transfers. Verify each candidate's exact configuration. |
| D6 | Settlement status | Settled | The chain receipt is the source of truth. Provider status and webhooks are hints and can arrive late or out of order. Mark the app transaction confirmed only after a successful receipt and three blocks. Keep unresolved transactions pending or stuck and reconcile them. |
| D7 | Idempotency and retries | Settled | Persist an app-level payment intent and key before calling the provider, then use a separate provider key for each attempt. After an unclear timeout, query provider and chain first, and never auto-resend. A deliberate retry after a definite failure gets a new attempt record and key, linked to the original intent. Test what each provider does with failed-request keys. |
| D8 | Wallet type | Open | EOA, ERC-4337 smart account, and EIP-7702 flows are different options. Test the first transfer from a fresh account, including initialization or deployment and fee settlement, and do not assume an ordinary server wallet supports a paymaster flow. |
| D9 | Deposit token and faucet | Settled | Verify the Base Sepolia token contract, decimals, and Transfer event on-chain. Use the Base Sepolia option on Circle's faucet, never Ethereum Sepolia USDC. Pre-fund demo accounts before rehearsal and never depend on the faucet during the live demo. |
| D10 | Order of work | Settled | Nov 20 is the target date. Work is ordered by dependency and priority, not by assumed daily hours: validate wallet, transfer, and gas; then foundation and auth; then deposits; then friends and transfers; then hardening and rehearsal. Payment requests, email verification, and polish stay cuttable. |
| D11 | Claude roles | Settled | This private Claude session reviews the specification and helps plan only, and never implements the app. A separate Claude Code session implements, using the handoff in section 8. |
| D12 | Budget | Settled | $40 is a hard ceiling for Claude usage, and less is preferred. Do not assume permission to exceed it. Checkpoints and stop-and-ask thresholds are in section 6. |

**Provider rule after validation.** Choose among the candidates that pass: a user-paid USDC route first, then an app-sponsored one. Break ties by the least custom signing or bundler work, then by the cleanest fit with server-controlled wallets and independent app auth. Circle enters only if both CDP and Privy fail, and only with your approval.

**Still needing your input**

- Local or hosted demo: webhooks need a public URL, so local web and worker with polling is the default unless a provider requires webhooks.
- Which RPC endpoint to use for scanning and receipts, since public endpoints may be rate-limited.
- Repository and submission requirements from the club.
- Which CDP and Privy accounts you already have. No Circle account is needed.
- Where you will read actual Claude spend, so the checkpoints use real numbers.
- What user data to keep after the demo, and how to reset it.

## 6. Milestones, budget, and checkpoints

Milestones follow dependency and priority, not a pace. Each one waits for the one before it, has an exit test, and has a spend cap; Nov 20 is the only date.

&#91;embedded content: milestone dependencies and spend caps\]

The validation milestone is deliberately minimal, with no app UI and no full backend, because the providers' docs already support server-created wallets and server-initiated transfers. Payment requests are the only optional branch.

| Milestone | Exit criteria | Cut or stop condition |
| --- | --- | --- |
| Validation (minimal) | CDP and Privy accounts exist; token contract, decimals, and Transfer event verified on-chain; a fresh server-created account on each candidate sends test USDC to a second account, and the receipt, Transfer event, fee behavior, and first-use behavior are checked; D2, D4, and D8 written down. No app UI and no full backend | Neither candidate passes: ask about pre-funded test ETH, and ask before considering Circle |
| Foundation and auth | Repo and migrations; signup and login with a session cookie; wallet created through the provider adapter and saved, with rollback if either fails; chain config with a startup token check; Home and Wallet pages; demo users created | Wallet creation is unreliable: fix before adding features |
| Deposits, friends, Activity | Worker with cursor and dedup; chain balance cached up to 10 seconds; friend search and requests; Activity page; one external deposit credited automatically and surviving a worker restart | Scanner disagrees with the chain balance: fix before building sends |
| Quotes, sends, withdrawals | Quote with a labeled estimate; idempotent send with attempt records; withdrawals; status polling and reconciliation; explorer links; stable errors; one full Alice-to-Bob run | Any duplicate on-chain transfer: freeze sends. Core path not working near the target: demo deposit, send, and withdraw only |
| Hardening and rehearsal | Authorization, rate-limit, and webhook checks; the required tests; README covering setup, environment, wallet model, gas, and limits; reset plan; recording; two rehearsals with pre-funded wallets | Anything that fails rehearsal is fixed or removed from the demo |
| Payment requests (optional) | Only if sends are stable and spend allows | Cut first |
| Demo target, Nov 20 | Freeze; check provider, RPC, worker, accounts, and recording; smoke test | No new features after the freeze |

### Budget: $40 hard ceiling

These are planning estimates, not measurements or commitments. Costs use Sonnet 5.5 rates of $2 input, $10 output, and $0.10 cached input per million tokens, which I took from third-party trackers citing Anthropic's pricing, so confirm them on Anthropic's pricing page. The ranges include margin for retries and failed runs. The planning estimate is $17 to $39 in total, and the cap column is where work stops for your decision.

| Milestone | Output tokens | Total tokens processed | Estimated cost | Cumulative stop-and-ask cap |
| --- | --- | --- | --- | --- |
| Validation (minimal) | 30k to 60k | 2M to 5M | $1 to $3 | $3 |
| Foundation and auth | 100k to 180k | 6M to 14M | $3 to $7 | $10 |
| Deposits, friends, Activity | 120k to 220k | 8M to 18M | $4 to $9 | $19 |
| Quotes, sends, withdrawals | 160k to 280k | 12M to 28M | $6 to $13 | $31 |
| Hardening and rehearsal | 80k to 160k | 6M to 16M | $3 to $7 | $37 |
| **Required milestones** | **490k to 900k** | **34M to 81M** | **$17 to $39** | **$40 hard ceiling** |

- **Usage checkpoints.** After each milestone, the Claude Code session reports spend to date against the cap above and stops to ask if the cap is passed. Actual spend comes from the account's usage page, which I cannot see from here.
- **Spend rules.** At $32, which is 80% of the ceiling, only required milestones continue, with no payment requests, email verification, or polish. At $38, stop and ask before any more spend. Never exceed $40 without your explicit permission.
- **Cut order.** Payment requests first, then email verification, then polish. Never cut the idempotency, authorization, scanner, or quote-versus-receipt tests.
- **Model policy.** Sonnet 5.5 by default, and Haiku 5.5 for boilerplate, tests, and README drafts. No Opus unless you approve it for a specific problem, since it costs about twice as much per token.
- **Optional payment requests** would cost about $2 to $4 and are considered only if spend after the sends milestone is $28 or less.
- **How tight this is.** The top of the range leaves almost no reserve. A straight multiplication of the token ranges by the rates gives less than the table, but I have not measured real usage. If the validation alone costs more than $3, treat the whole forecast as too low and ask before continuing.
- **Provider and API fees** are separate from this ceiling and are listed in section 7.

## 7. Provider and API cost assumptions to verify

None of these are commitments. Each row says what I found, where it came from, and what must be checked on a live page or in your account before the plan relies on it.

| Item | What I found | Source type | Verify by |
| --- | --- | --- | --- |
| Coinbase CDP | The smart accounts page I opened says Base Sepolia user operations are subsidized and the account needs no ETH. CDP docs seen in search results also mention up to $100 in free credits | [CDP smart accounts docs](https://docs.cdp.coinbase.com/wallets/using-wallets/smart-accounts.md), official; credits seen only in search results | Limits and credit balance in the CDP portal |
| Privy | Third-party trackers report a free developer tier and paid plans, and they disagree about plan prices, which changed more than once in 2026. Gas sponsorship supports prepaid or postpaid billing, and the user-pays mode does not charge the app's gas credits | Trackers for plans; Privy's [gas overview](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview.md) for billing modes | [privy.io/pricing](https://privy.io/pricing) and the dashboard's Fee sponsorship page |
| Circle (fallback only) | Not budgeted and not started. If it were needed: the first 1,000 monthly active wallets are free, Gas Station adds 5% to sponsored gas, and Paymaster adds 10% for the user | [Circle Wallets page](https://www.circle.com/wallets) and [Paymaster docs](https://developers.circle.com/paymaster.md), official | Only if CDP and Privy both fail, and only with your approval |
| Circle testnet faucet | You report a Base Sepolia option. Per-request and per-day limits are unknown | Your note; limits unknown | The faucet page, then pre-fund early |
| Base Sepolia RPC | Public endpoints may rate-limit scanning. Free tiers of keyed providers are unpriced here | Not researched | Create a keyed endpoint and test scan volume |
| Hosting and database | A local web app, worker, and database cost nothing. Hosted free tiers are unpriced here | Not researched | Only if the demo must be hosted |
| Claude usage | $40 is your hard ceiling. The rates in section 6 come from third-party trackers citing Anthropic's pricing | Your budget; third-party trackers for rates | Anthropic's pricing page and the account's usage page |

## 8. Handoff plan for the Claude Code session

Give this section to the implementing Claude Code session together with the original specification and sections 4 to 6. This planning session reviews the specification and helps plan only, and it never implements the app. The separate Claude Code session writes all code, runs the validation, and builds. Its first task is a minimal validation, not an app.

### Working rules

- Role separation: the private planning Claude does not write code and should not be asked to. The Claude Code session implements.
- Plan first. Inspect the repository before changing anything, and do not regenerate files blindly.
- Order work by dependency and priority, not by assumed daily hours or pace. Work in vertical slices, show diffs before broad changes, and run focused checks after each slice and one end-to-end run at the end.
- Keep the wallet provider behind an adapter so a failed provider can be swapped without touching the rest.
- Build no payment requests until the core demo works. Email verification and polish are also last.
- Testnet only. Never use mainnet keys, never commit or log secrets, and redact credentials in logs.
- Budget: $40 is a hard ceiling for Claude usage. Report spend after each milestone against the cap in section 6, stop and ask the user at $38 or when a cap is passed, and never exceed $40 without explicit permission.
- Models: Sonnet 5.5 by default and Haiku 5.5 for boilerplate and tests. Do not use Opus without the user's approval for a specific problem.

### Settled decisions to follow

D1, D2, D3, D5, D6, D7, D9, D10, D11, and D12 in section 5 are fixed. The most important for code: the amount entered is the recipient's amount; the sender's debit is that plus any separately charged fee; no gas is subtracted from the recipient; no buffer; the chain receipt decides confirmation; and each provider submission uses its own key under one app-level intent. Describe the wallet model as app-controlled wallets with provider-protected keys, and do not call CDP a custodian.

### Step 0: minimal validation (no app UI, no full backend)

1. Confirm which CDP and Privy accounts and keys exist, and ask the user for any that are missing. Do not start Circle onboarding.
2. Validate CDP first with a minimal harness: create a server-controlled owner account and a smart account on Base Sepolia, fund it with test USDC from the Base Sepolia option of Circle's faucet, send test USDC to a second account through a user operation, and check the receipt, Transfer event, fee behavior, and first-use deployment behavior.
3. Validate Privy second: create an app-controlled Server Wallet, attempt a USDC transfer with user-pays gas on Base Sepolia using the exact configuration we would ship, and record the dashboard prerequisites and the actual fee. Note whether Privy's app-pays option works as an alternative, since it has separate requirements.
4. Verify the token address, decimals, and Transfer event on-chain.
5. Write a one-page decision note that settles D2, D4, and D8, lists what failed and why, states the actual fee charged for each passing transfer, and reports spend so far.
6. Stop and ask the user if neither candidate passes. Do not change the no-test-ETH requirement, and do not start Circle onboarding, without approval.

### Adapter contract (behavior, not code)

The adapter must be able to create a wallet for a user and return its provider ID and address; read a chain balance; produce a fee estimate with a clear label; submit a transfer with a per-attempt provider key; report the state of a submitted transfer from the provider; and verify a webhook signature if webhooks are used. Provider state is never the final word on confirmation.

### Data model to create

Users, wallets, sessions (hashed tokens), friendships, payment requests (last), payment intents, payment attempts (one row per provider submission), transactions (with amount, fee, total debit, status, hash, log index, block, and confirmed time), fee quotes (with expiry and consumed flag), and chain cursors. All money is integer base units with six decimals. No balance column exists; balance comes from the chain.

### Tests required before the demo

Decimal conversion; identity normalization; friend uniqueness; quote and fee math against a real receipt; quote expiry; insufficient balance; idempotency including a reused key with a different payload; authorization; event decoding and deduplication; scanner restart and reorg handling; provider timeout; webhook signature and replay if used; key UI states; and one end-to-end run on Base Sepolia.

### Ask the user before starting

Local or hosted demo; which RPC endpoint to use; the club's repository and submission requirements; which CDP and Privy accounts exist; where the user reads actual Claude spend; and what data to keep after the demo.

### Stop conditions

Stop and report if wallet creation, a USDC transfer, and a verifiable receipt do not work promptly; if any duplicate on-chain transfer occurs; if the scanner and the chain balance disagree; if spend passes a milestone cap; or if spend reaches $38. Never exceed $40 without the user's explicit permission.

## 9. Sources

Checked as of Nov 16, 2026. Reopen the official pages before implementation, because product access and capabilities change.

**Pages I opened in full**

- [CDP smart accounts docs](https://docs.cdp.coinbase.com/wallets/using-wallets/smart-accounts.md), also served at the CDP gas sponsorship path
- [Privy gas sponsorship overview](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview.md)
- [Circle Gas Station docs](https://developers.circle.com/wallets/gas-station.md)
- [Circle Paymaster docs](https://developers.circle.com/paymaster.md)
- [Circle Paymaster product page](https://www.circle.com/paymaster) and [Circle Wallets product page](https://www.circle.com/wallets), for the fallback only

**Seen only in search results, not opened in full**

- [Circle transaction states](https://developers.circle.com/api-reference/wallets/transaction-states-and-errors.md) and [asynchronous states](https://developers.circle.com/wallets/asynchronous-states-and-statuses)
- [Circle xReserve tutorial](https://developers.circle.com/xreserve/tutorials/deposit-from-cctp-blockchains.md), which lists the Base Sepolia USDC address (confirm on-chain)
- [Privy native gas sponsorship announcement](https://privy.io/blog/introducing-privy-native-gas-sponsorship), which covers app-paid sponsorship, and [Privy gas setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup.md)
- [Circle Testnet Faucet](https://faucet.circle.com/), cited in your notes

**Third-party figures, to verify**

- Privy plan pricing, from trackers such as CostBench.
- Claude model rates, from trackers such as Finout and BenchLM that cite Anthropic's pricing.

**Taken as stated, not independently checked:** your own check that CDP and Privy document server-controlled wallet creation and server-initiated transfers, and that Privy documents service-controlled wallets and server-side transaction requests. I opened the CDP smart accounts page and Privy's gas overview, but not the CDP or Privy pages on wallet creation and key protection.

**Not relied on:** the Base Sepolia paymaster quickstart link in your earlier corrections points to an amplifyapp.com address rather than a Coinbase domain.
