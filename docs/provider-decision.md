# Provider decision: Privy (CDP skipped)

## Choice and why
Privy server wallets on Base Sepolia, owned by our authorization key. Validated end to end:
wallets created, 1 USDC sent, gas paid in USDC by the sender, sender held 0 ETH throughout.
Dashboard: sponsor gas fees OFF, USDC enabled as gas payment token for Base Sepolia.

## Working request shape (no secrets)
- Create: `POST https://api.privy.io/v1/wallets`, Basic auth (app id : app secret), header `privy-app-id`,
  body `{chain_type:"ethereum", external_id, owner:{public_key:<auth key SPKI base64>}}`.
- Send: `POST https://api.privy.io/v1/wallets/{id}/rpc`, same auth plus `privy-authorization-signature`.
  Body: `{method:"eth_sendTransaction", caip2:"eip155:84532", chain_type:"ethereum", sponsor:true,
  sponsor_options:{asset:"usdc"}, params:{transaction:{to:<USDC>, value:"0x0", data:<transfer calldata>}}}`.
- Signature: ECDSA P-256 / SHA-256 over canonical (sorted-key) JSON of
  `{version:1, method, url, body, headers:{"privy-app-id"}}`, base64 DER. Accepted first try.
- Response: `data.{transaction_id, user_operation_hash, caip2, hash:""}`. No status field.
- USDC (Base Sepolia) `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals.

## Observed fees (paid in USDC by the sender, same transaction)
- 1 USDC send: fee 0.003445 USDC (gasUsed 242279).
- 0.01 USDC send, twice: fee 0.002794 USDC each (gasUsed 185543 and 182743).
- Fee goes as a second USDC Transfer to `0xa5d3...ef7a1` (assumed paymaster/fee collector, unverified).
- Sender account has EIP-7702 delegation code (`0xef0100` + `0xd6cedde8...5b28`); txs go through the
  ERC-4337 EntryPoint `0x0000000071727de22e5e9d8baf0edac6f37da032`, submitted by a bundler.

## Still unknown
- Pre-send gas fee estimate: none found in the docs read. A transfer quote page exists
  (`wallets/actions/transfer/quote`) but was not checked.
- Status/hash lookup by `transaction_id`: not found in the docs read.
- Idempotency header on the wallet RPC: unconfirmed (documented on wallet create as `privy-idempotency-key`;
  RPC body also has `reference_id`, "unique per app"). Dedup behavior untested.
- Identity of the fee recipient and the delegate contract; whether fees vary with load or on mainnet.

## Design consequences
1. The sender must hold amount plus fee (about 0.003 USDC on testnet); check balance >= amount + margin.
2. A send produces two USDC Transfer logs (payment and fee), so outgoing verification must match the
   intended from/to/value among several logs, not assume one.
3. Privy returned no status or hash on send, so the app must reconcile through the chain (scan Transfer
   logs / receipts after the send) and keep `transaction_id` and `user_operation_hash` for correlation.
