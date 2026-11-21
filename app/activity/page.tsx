import { redirect } from 'next/navigation';
import { LiveSummary } from '../components/LiveSummary';
import { MarkSeen } from '../components/MarkSeen';
import { unreadActivityCount } from '@/lib/notifications';
import { getSummary } from '@/lib/summary';
import { getWalletFor, requireUser } from '@/lib/session';

export default async function ActivityPage() {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);
  if (user.status !== 'active' || !wallet) redirect('/');
  const unread = unreadActivityCount(user.id);
  const initial = await getSummary(user.id, wallet.address, 200);
  return (
    <>
      <MarkSeen unread={unread} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1>Activity</h1>
        <a className="btn btn-secondary btn-sm" href="/api/activity/export" download>Download CSV</a>
      </div>
      <p className="page-intro">Deposits, payments, and withdrawals. Transfers are confirmed only after a successful on-chain receipt.</p>
      <LiveSummary initial={initial} limit={200} showBalance={false} filters />
    </>
  );
}
