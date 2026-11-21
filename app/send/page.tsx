import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LiveBalance } from '../components/LiveBalance';
import { TransferForm } from '../components/TransferForm';
import { listAcceptedFriends } from '@/lib/friends';
import { getWalletFor, requireUser } from '@/lib/session';
import { fmtAmount } from '../components/format';
import { formatUsdc } from '@/lib/amount';
import { estimateFeeRaw, recentFeeRange } from '@/lib/fees';
import { recentRecipientUsernames } from '@/lib/recent';
import { countIncomingMoneyRequests, getPayableRequest } from '@/lib/requests';
import { getSummary } from '@/lib/summary';

export default async function SendPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);
  if (user.status !== 'active' || !wallet) redirect('/');
  const { request: requestId } = await searchParams;
  const paying = requestId ? getPayableRequest(user.id, requestId) : null;
  const friends = listAcceptedFriends(user.id);
  const waiting = paying ? 0 : countIncomingMoneyRequests(user.id);
  const range = recentFeeRange();
  const initial = await getSummary(user.id, wallet.address, 10);
  return (
    <>
      <h1>Send</h1>
      <p className="page-intro">
        The amount you enter is what your friend receives. You also pay the actual network fee in USDC, which is
        recorded after the transfer. Testnet only.
      </p>
      {requestId && !paying && (
        <p className="alert alert-warn" role="alert">
          That money request can no longer be paid. It may have expired, been cancelled, or already be paid. <Link href="/friends?tab=money">Back to requests</Link>
        </p>
      )}
      {paying && (
        <p className="alert alert-info" role="status">
          Paying @{paying.requesterUsername}&apos;s request for {fmtAmount(paying.amount)} USDC. <Link href="/friends?tab=money">Back to requests</Link>
        </p>
      )}
      {waiting > 0 && (
        <p className="alert alert-info" role="status">
          You have {waiting} money {waiting === 1 ? 'request' : 'requests'} waiting. <Link href="/friends?tab=money">View {waiting === 1 ? 'it' : 'them'}</Link>
        </p>
      )}
      <LiveBalance initial={initial} />
      <TransferForm
        mode="send"
        friends={paying ? friends.filter((f) => f.username === paying.requesterUsername) : friends}
        recent={recentRecipientUsernames(user.id)}
        feeEstimate={formatUsdc(estimateFeeRaw())}
        feeRange={range ? { min: formatUsdc(range.min), max: formatUsdc(range.max) } : null}
        request={paying ? { id: paying.id, username: paying.requesterUsername, amount: paying.amount, note: paying.note } : undefined}
      />
      {!paying && <p className="muted" style={{ textAlign: 'center' }}>Want to ask for money instead? <Link href="/friends?tab=money">Request money</Link></p>}
    </>
  );
}
