export interface WalletRecord {
  providerWalletId: string;
  /** Checksummed or lowercase as returned by the provider; callers lowercase before storing. */
  address: string;
}

/** The provider definitely did not execute the request (a clear 4xx rejection). Anything else is "unclear". */
export class ProviderRejectedError extends Error {}

export interface SendUsdcArgs {
  providerWalletId: string;
  to: string;
  amountRaw: bigint;
  /** Our payment ID, passed to the provider as its reference ID. */
  referenceId: string;
}

/** Provider hints only. Privy returns no fee quote, no status and an empty hash on send. */
export interface SendResult {
  transactionId?: string;
  userOperationHash?: string;
  txHash?: string;
}

export interface TransactionHint {
  status?: string;
  txHash?: string;
  userOperationHash?: string;
}

export interface WalletAdapter {
  readonly provider: string;
  /** Creates an app-controlled wallet with the given write-once external ID. */
  createWallet(externalId: string): Promise<WalletRecord>;
  /** Returns the existing wallet for the external ID, or null. Throws if the result is ambiguous or not ours. */
  findWalletByExternalId(externalId: string): Promise<WalletRecord | null>;
  /**
   * Submits a USDC transfer with gas paid in USDC by the sender. Throws ProviderRejectedError only on a clear
   * rejection; any other error means the outcome is unknown and the chain must be checked. Never auto-retried.
   */
  sendUsdcTransfer(args: SendUsdcArgs): Promise<SendResult>;
  /** Optional provider status lookup by transaction ID. A hint, never the source of truth. */
  getTransactionHint?(transactionId: string): Promise<TransactionHint | null>;
}
