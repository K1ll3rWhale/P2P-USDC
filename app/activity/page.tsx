import { redirect } from 'next/navigation';
import { LiveSummary } from '../components/LiveSummary';
import { getSummary } from '@/lib/summary';
import { getWalletFor, requireUser } from '@/lib/session';

export default async function ActivityPage() {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);
  if (user.status !== 'active' || !wallet) redirect('/');
  const initial = await getSummary(user.id, wallet.address, 50);
  return (
    <>
      <h1>Activity</h1>
      <p className="page-intro">Deposits, payments, and withdrawals. Transfers are confirmed only after a successful on-chain receipt.</p>
      <LiveSummary initial={initial} limit={50} showBalance={false} />
    </>
  );
}
