import Link from 'next/link';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { fmtAmount, utc } from '../components/format';
import { RequestForm } from '../components/RequestForm';
import { RequestPill } from '../components/RequestPill';
import { SubmitButton } from '../components/SubmitButton';
import { cancelMoneyRequestAction, declineMoneyRequestAction } from '../request-actions';
import { listAcceptedFriends } from '@/lib/friends';
import { listMoneyRequests } from '@/lib/requests';

/** The "Money requests" sub-tab: ask a friend for USDC, answer requests, and see recent ones. */
export function MoneyTab({ userId }: { userId: string }) {
  const money = listMoneyRequests(userId);
  return (
    <>
      <RequestForm friends={listAcceptedFriends(userId)} />

      <div className="card">
        <h2>Requests to you</h2>
        {money.incoming.length === 0 ? (
          <EmptyState title="Nobody is asking you for money">When a friend requests USDC, it shows up here.</EmptyState>
        ) : (
          <ul className="rows">
            {money.incoming.map((r) => (
              <li key={r.id} className="item" style={{ alignItems: 'flex-start' }}>
                <Avatar name={r.otherUsername} />
                <div className="item-main">
                  <div className="item-title">@{r.otherUsername} asks for {fmtAmount(r.amount)} USDC</div>
                  {r.note && <div className="item-sub">Note: “{r.note}”</div>}
                  <div className="activity-meta"><span>Expires {utc(r.expiresAt)}</span> <RequestPill state={r.state} /></div>
                </div>
                {r.state === 'pending' && (
                  <div className="item-actions">
                    <Link className="btn btn-primary btn-sm" href={`/send?request=${encodeURIComponent(r.id)}`}>Pay</Link>
                    <form action={declineMoneyRequestAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="secondary btn-sm">Decline</SubmitButton>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Your requests</h2>
        {money.outgoing.length === 0 ? (
          <EmptyState title="No open requests">Use the form above to ask a friend to pay you.</EmptyState>
        ) : (
          <ul className="rows">
            {money.outgoing.map((r) => (
              <li key={r.id} className="item" style={{ alignItems: 'flex-start' }}>
                <Avatar name={r.otherUsername} />
                <div className="item-main">
                  <div className="item-title">{fmtAmount(r.amount)} USDC from @{r.otherUsername}</div>
                  {r.note && <div className="item-sub">Note: “{r.note}”</div>}
                  <div className="activity-meta"><span>Expires {utc(r.expiresAt)}</span> <RequestPill state={r.state} /></div>
                </div>
                {r.state === 'pending' && (
                  <form action={cancelMoneyRequestAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="secondary btn-sm">Cancel</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {money.recent.length > 0 && (
        <div className="card">
          <h2>Recent</h2>
          <ul className="rows">
            {money.recent.map((r) => (
              <li key={r.id} className="item">
                <Avatar name={r.otherUsername} />
                <div className="item-main">
                  <div className="item-title">{r.mine ? `You asked @${r.otherUsername}` : `@${r.otherUsername} asked you`} for {fmtAmount(r.amount)} USDC</div>
                  {r.note && <div className="item-sub">Note: “{r.note}”</div>}
                </div>
                <RequestPill state={r.state} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
