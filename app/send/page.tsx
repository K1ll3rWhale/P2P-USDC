import { redirect } from 'next/navigation';
import Link from 'next/link';
import { TransferForm } from '../components/TransferForm';
import { getUsdcBalance } from '@/lib/chain';
import { listAcceptedFriends } from '@/lib/friends';
import { getWalletFor, requireUser } from '@/lib/session';

export default async function SendPage() {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);
  if (user.status !== 'active' || !wallet) redirect('/');
  let balance: { formatted: string; raw: bigint } | null = null;
  try {
    balance = await getUsdcBalance(wallet.address);
  } catch {
    balance = null;
  }
  return (
    <>
      <h1>Send</h1>
      <p className="muted">
        The amount you enter is what your friend receives. You also pay the actual network fee in USDC, which is
        recorded after the transfer. Testnet only.
      </p>
      <p>
        {balance ? <>Your balance: <strong>{balance.formatted} USDC</strong>.</> : <span className="error">Balance unavailable right now; the server still checks it before sending.</span>}
        {balance && balance.raw === 0n && <> You have no USDC yet. <Link href="/wallet#deposit">Deposit test USDC first</Link>.</>}
      </p>
      <TransferForm mode="send" friends={listAcceptedFriends(user.id)} />
    </>
  );
}
