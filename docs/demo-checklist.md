# Demo checklist (two browsers, Base Sepolia testnet)

Setup: **normal window = alice**, **incognito window = bob**, and a **third tab on BaseScan** (https://sepolia.basescan.org).
Say up front: testnet, test funds only, app-controlled wallets with provider-protected keys, no real-money value.

## Preparation (about 20 minutes before)
1. `npm run demo:start`. Wait for "Demo is up". It checks config and the chain, builds, and starts the web app and the worker.
2. `npm run demo:status`. Expect: worker lag under about 50 blocks and "updated a few seconds ago", for alice and bob
   "OK: the balance matches the confirmed records", and "unresolved outgoing intents: 0".
3. If an account is missing or short of funds: `npm run demo:prepare -- --amount 5 alice bob`. It prints the validation
   sender's balance first and refuses if it cannot cover the amounts plus fees. Wait for "Done".
4. Log in as alice (normal window) and bob (incognito). Demo password is `DEMO_PASSWORD` or the documented testnet default.
5. Confirm alice and bob are friends (Friends page). If not: alice searches "bob", Add friend; bob Accepts.
6. Keep alice's balance at 1 USDC or more. Open BaseScan to alice's and bob's wallet addresses (Wallet page) in tabs.

## What to show, and what to expect
| # | Do this | Expect |
|---|---|---|
| 1 | Both windows: Home. Point at the testnet banner. | Balance read from the chain with an "as of" time, refreshing every 10 s. |
| 2 | Alice: Wallet. Show the address, Copy, the faucet steps. | Address, instructions, Circle faucet link. |
| 3 | External deposit: send a little USDC to alice from outside (Circle faucet, or `npm run demo:prepare -- --amount 0.1 alice` in a terminal). | In Activity: "Deposit … Pending", then "Confirmed". Measured: about a minute for a deposit to be observed in an earlier test, so rehearse and allow up to a minute or two. BaseScan link works. The worker, not the browser, records it. |
| 4 | Alice: Send. Pick bob, amount `0.25`, note "Lunch". Review. | Three lines: recipient receives 0.25; **estimated** network fee (about 0.003); estimated total. A 30 s countdown. |
| 5 | Alice: Confirm send (click once; the button disables while submitting). | "Submitted". Activity shows "Sent to @bob … Pending". |
| 6 | Wait about 10 to 20 s (measured: resolved 3 to 7 s after submit, plus up to 10 s for the page refresh). Both windows. | Alice: "Confirmed", **actual fee** shown, balance down by 0.25 plus the actual fee. Bob: "Received from @alice", note "Lunch", balance up by exactly 0.25. Bob has **no** deposit entry for it. |
| 7 | BaseScan tab: open the send's transaction. | Success, and **two** USDC transfers from alice: 0.25 to bob (the payment) and a small one to a separate fee address (the network fee; we have not verified who operates it). |
| 8 | Bob: Wallet, Withdraw. Address `0x59dA01Eb6754480f1f9FB9efA23a409e52e55134`, amount `0.1`. Review. | The full destination address is shown with the same three-line quote. Confirm. Later: "Withdrawal … Confirmed" with the actual fee; BaseScan shows the transfer. |
| 8b | Optional: Bob: Friends, Money requests. Ask alice for `0.05` with note "Coffee" and expiry `7`. Alice: Friends, Money requests, Pay, then Confirm send. | Alice sees the request with a Pay button; Send opens with bob's name and `0.05` locked. After confirming, the request shows Paying, then Paid once Activity says Confirmed. |
| 9 | Safety points (talk, or try): double-click Confirm; send to a non-friend; withdraw to one of the app's own addresses; send more than the balance. | One transfer only; "only accepted friends"; "use Send"; an insufficient-balance message that names amount plus estimated fee. |

Measured timings (worker running): a send or withdrawal was resolved 3 to 7 s after submit (the first send 6.9 s, the withdrawal
3.0 s); the recipient's receipt was seen about 0.3 s after its block and confirmed about 5 s later; pages refresh every 10 s on top
of that. Deposits were observed about a minute after their block in earlier tests, so rehearse that step. These are single runs on
a testnet, not guarantees.

## If something stalls (never claim a transfer is confirmed without a receipt)
- **Balance shows "unavailable" or a stale warning:** the RPC is slow. Wait and refresh. Do not quote a balance you cannot see.
  Run `npm run demo:status` (it reads the chain directly). Consider a keyed RPC in `BASE_SEPOLIA_RPC_URL` next time.
- **A transfer stays "Pending" or says "taking longer than expected":** Privy or the chain is slow. **Do not resend.** Check BaseScan
  for the wallet address. Only call it done when Activity says **Confirmed** or BaseScan shows a **successful** transaction with
  the right transfer. Run `npm run intents:status` to see exactly what the chain shows.
- **Activity is not updating at all:** the worker may be down. `npm run demo:status` shows a stale cursor. Restart with
  `npm run worker`. It catches up and records everything once.
- **Privy is down (wallet setup or sends fail):** say so. Show the pending state and the Retry button, and continue with the
  read-only parts (balances, Activity, BaseScan). Do not retry sends in a loop.
- **Last resort:** `npm run intents:resolve -- <id> --confirm-no-onchain` only if the chain truly shows nothing after 5 minutes.

## After the demo
Press Ctrl+C in the `demo:start` terminal (stops both processes). Nothing needs resetting; balances are on-chain.
