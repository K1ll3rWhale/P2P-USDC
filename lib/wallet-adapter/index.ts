import { PrivyWalletAdapter } from './privy';
import type { WalletAdapter } from './types';

export type { WalletAdapter, WalletRecord } from './types';

let adapter: WalletAdapter | undefined;

/** The one place that chooses the wallet provider. */
export function getWalletAdapter(): WalletAdapter {
  return (adapter ??= new PrivyWalletAdapter());
}
