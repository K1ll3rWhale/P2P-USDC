import { redirect } from 'next/navigation';
import { TransferForm } from '../components/TransferForm';
import { listAcceptedFriends } from '@/lib/friends';
import { getWalletFor, requireUser } from '@/lib/session';

export default async function SendPage() {
  const user = await requireUser();
  if (user.status !== 'active' || !getWalletFor(user.id)) redirect('/');
  return (
    <>
      <h1>Send</h1>
      <p className="muted">
        The amount you enter is what your friend receives. You also pay the actual network fee in USDC, which is
        recorded after the transfer. Testnet only.
      </p>
      <TransferForm mode="send" friends={listAcceptedFriends(user.id)} />
    </>
  );
}
