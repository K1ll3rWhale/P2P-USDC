import { retryProvisionAction } from './actions';
import { LiveSummary } from './components/LiveSummary';
import { SubmitButton } from './components/SubmitButton';
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
  return <LiveSummary initial={initial} limit={5} showBalance />;
}
