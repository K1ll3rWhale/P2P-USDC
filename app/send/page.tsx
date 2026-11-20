import { redirect } from 'next/navigation';
import { LiveBalance } from '../components/LiveBalance';
import { TransferForm } from '../components/TransferForm';
import { listAcceptedFriends } from '@/lib/friends';
import { getWalletFor, requireUser } from '@/lib/session';
import { getSummary } from '@/lib/summary';

export default async function SendPage() {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);
  if (user.status !== 'active' || !wallet) redirect('/');
  const initial = await getSummary(user.id, wallet.address, 10);
  return (
    <>
      <h1>Send</h1>
      <p className="page-intro">
        The amount you enter is what your friend receives. You also pay the actual network fee in USDC, which is
        recorded after the transfer. Testnet only.
      </p>
      <LiveBalance initial={initial} />
      <TransferForm mode="send" friends={listAcceptedFriends(user.id)} />
    </>
  );
}
