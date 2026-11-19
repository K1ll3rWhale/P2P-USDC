import Link from 'next/link';
import { retryProvisionAction } from './actions';
import { getUsdcBalance, type UsdcBalance } from '@/lib/chain';
import { getWalletFor, requireUser } from '@/lib/session';

export default async function HomePage() {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);

  if (user.status !== 'active' || !wallet) {
    return (
      <div className="card">
        <h1>Setting up your wallet</h1>
        <p>Your account exists, but your wallet is not ready yet.</p>
        {user.provisioningError && <p className="error">{user.provisioningError}</p>}
        <form action={retryProvisionAction}>
          <button type="submit">Retry wallet setup</button>
        </form>
      </div>
    );
  }

  let balance: UsdcBalance | null = null;
  try {
    balance = await getUsdcBalance(wallet.address);
  } catch (e) {
    console.error('[home] balance read failed:', e instanceof Error ? e.message : 'unknown');
  }

  return (
    <>
      <div className="card">
        <h2>USDC balance</h2>
        {balance ? (
          <>
            <div className="balance">{balance.formatted} USDC</div>
            <p className="muted">As of {new Date(balance.asOf).toISOString().slice(11, 19)} UTC · read from Base Sepolia</p>
          </>
        ) : (
          <p className="error">Balance unavailable right now. Refresh to try again.</p>
        )}
        <Link className="btn" href="/wallet#deposit">Deposit</Link>
      </div>
      <div className="card muted">Hi @{user.username}. Deposits, friends and sends are not built yet.</div>
    </>
  );
}
