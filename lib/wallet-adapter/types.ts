export interface WalletRecord {
  providerWalletId: string;
  /** Checksummed or lowercase as returned by the provider; callers lowercase before storing. */
  address: string;
}

/**
 * Provider-neutral wallet operations. Sending (not built yet) must stay compatible with what Privy
 * returned: no fee quote, no status, and an empty hash, so a future `send` should return the provider
 * operation IDs and let the app reconcile through the chain.
 */
export interface WalletAdapter {
  readonly provider: string;
  /** Creates an app-controlled wallet with the given write-once external ID. */
  createWallet(externalId: string): Promise<WalletRecord>;
  /** Returns the existing wallet for the external ID, or null. Throws if the result is ambiguous or not ours. */
  findWalletByExternalId(externalId: string): Promise<WalletRecord | null>;
}
