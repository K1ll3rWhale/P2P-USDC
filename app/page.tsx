import { retryProvisionAction } from './actions';
import { LiveSummary } from './components/LiveSummary';
import { SubmitButton } from './components/SubmitButton';
import Link from 'next/link';
import { waitingCounts } from '@/lib/notifications';
import { getSummary } from '@/lib/summary';
import { getWalletFor, requireUser } from '@/lib/session';

export default async function HomePage() {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);

  if (user.status !== 'active' || !wallet) {
    return (
      <div className="card">
        <h1>Setting up your wallet</h1>
        <p>Your account exists, but your wallet is not ready yet.</p>
        {user.provisioningError && <p className="alert alert-error" role="alert">{user.provisioningError}</p>}
        <form action={retryProvisionAction}>
          <SubmitButton pendingText="Setting up…">Retry wallet setup</SubmitButton>
        </form>
      </div>
    );
  }

  const initial = await getSummary(user.id, wallet.address, 5);
  const waiting = waitingCounts(user.id);
  return (
    <>
      {waiting.total > 0 && (
        <div className="card waiting" role="status">
          <div style={{ flex: 1 }}>
            <strong>{waiting.total} {waiting.total === 1 ? 'thing is' : 'things are'} waiting for you</strong>
            <div className="item-sub">
              {waiting.moneyRequests > 0 && <>{waiting.moneyRequests} money {waiting.moneyRequests === 1 ? 'request' : 'requests'}</>}
              {waiting.moneyRequests > 0 && waiting.friendRequests > 0 && ' · '}
              {waiting.friendRequests > 0 && <>{waiting.friendRequests} friend {waiting.friendRequests === 1 ? 'request' : 'requests'}</>}
            </div>
          </div>
          <Link href={waiting.moneyRequests > 0 ? '/friends?tab=money' : '/friends?tab=requests'}>View</Link>
        </div>
      )}
      <LiveSummary initial={initial} limit={5} showBalance />
    </>
  );
}
