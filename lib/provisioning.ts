import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { isAddress } from 'viem';
import { CHAIN_ID } from './chain';
import { db } from './db';
import { users, wallets } from './db/schema';
import { getWalletAdapter } from './wallet-adapter';
import type { WalletAdapter } from './wallet-adapter/types';

const LEASE_MS = 60_000;
const USER_ERROR = 'Wallet setup did not finish. Please try again.';

export type ProvisionResult = { ok: true } | { ok: false; error: string };

/**
 * Idempotent and retryable. Reuses an existing remote wallet (looked up by the user ID as external ID)
 * before creating one, and marks the user active only once the wallet row is saved.
 */
export async function provisionWallet(
  userId: string,
  adapter: Pick<WalletAdapter, 'provider' | 'createWallet' | 'findWalletByExternalId'> = getWalletAdapter(),
): Promise<ProvisionResult> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false, error: 'Account not found.' };
  const existing = db.select().from(wallets).where(eq(wallets.userId, userId)).get();
  if (existing && user.status === 'active') return { ok: true };

  // Lease so two concurrent attempts cannot both create a remote wallet.
  const now = Date.now();
  const claim = db
    .update(users)
    .set({ provisioningStartedAt: now })
    .where(and(eq(users.id, userId), or(isNull(users.provisioningStartedAt), lt(users.provisioningStartedAt, now - LEASE_MS))))
    .run();
  if (claim.changes === 0) return { ok: false, error: 'Wallet setup is already in progress. Try again shortly.' };

  try {
    let w = await adapter.findWalletByExternalId(userId);
    if (!w) {
      try {
        w = await adapter.createWallet(userId);
      } catch (e) {
        w = await adapter.findWalletByExternalId(userId); // created remotely despite the error?
        if (!w) throw e;
      }
    }
    if (!isAddress(w.address)) throw new Error('Provider returned an invalid address');
    const address = w.address.toLowerCase();
    const provider = adapter.provider;

    db.transaction((tx) => {
      if (!existing) {
        tx.insert(wallets)
          .values({ id: randomUUID(), userId, provider, providerWalletId: w.providerWalletId, address, chainId: CHAIN_ID, createdAt: Date.now() })
          .run();
      }
      tx.update(users).set({ status: 'active', provisioningError: null, provisioningStartedAt: null }).where(eq(users.id, userId)).run();
    });
    return { ok: true };
  } catch (e) {
    console.error('[provisioning] failed for user', userId, e instanceof Error ? e.message : 'unknown error');
    db.update(users).set({ provisioningError: USER_ERROR, provisioningStartedAt: null }).where(eq(users.id, userId)).run();
    return { ok: false, error: USER_ERROR };
  }
}
