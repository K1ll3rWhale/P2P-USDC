import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Avatar } from '../components/Avatar';
import { MoneyTab } from './MoneyTab';
import { EmptyState } from '../components/EmptyState';
import { SubmitButton } from '../components/SubmitButton';
import { utc } from '../components/format';
import { acceptRequestAction, cancelRequestAction, declineRequestAction, removeFriendAction, sendRequestAction } from '../friend-actions';
import { listFriendEvents, listFriendships, searchUsers, type FriendEventView } from '@/lib/friends';
import { countIncomingMoneyRequests } from '@/lib/requests';
import { requireUser } from '@/lib/session';

function describeEvent(e: FriendEventView): string {
  const who = '@' + e.otherUsername;
  switch (e.type) {
    case 'accepted': return e.mine ? `You accepted ${who}'s request` : `${who} accepted your request`;
    case 'declined': return e.mine ? `You declined ${who}'s request` : `${who} declined your request`;
    case 'cancelled': return e.mine ? `You cancelled your request to ${who}` : `${who} cancelled their request to you`;
    case 'removed': return e.mine ? `You removed ${who} as a friend` : `${who} removed you as a friend`;
  }
}

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; tab?: string; kind?: string; again?: string }> }) {
  const user = await requireUser();
  if (user.status !== 'active') redirect('/');
  const { q = '', notice, tab, kind, again } = await searchParams;
  const showRequests = tab === 'requests';
  const showMoney = tab === 'money';
  const moneyIncoming = countIncomingMoneyRequests(user.id);
  const results = q ? searchUsers(user.id, q) : [];
  const { incoming, outgoing, accepted } = listFriendships(user.id);
  const history = showRequests ? listFriendEvents(user.id) : [];

  return (
    <>
      <h1>Friends</h1>
      {notice && <p className={kind === 'error' ? 'alert alert-error' : 'alert alert-info'} role={kind === 'error' ? 'alert' : 'status'}>{notice}</p>}

      <nav className="subtabs" aria-label="Friends sections">
        <Link href="/friends" className="subtab" aria-current={showRequests || showMoney ? undefined : 'page'}>Friends</Link>
        <Link href="/friends?tab=requests" className="subtab" aria-current={showRequests ? 'page' : undefined}>
          Friend requests{incoming.length > 0 && <span className="badge" aria-label={`${incoming.length} incoming`}>{incoming.length}</span>}
        </Link>
        <Link href="/friends?tab=money" className="subtab" aria-current={showMoney ? 'page' : undefined}>
          Money requests{moneyIncoming > 0 && <span className="badge" aria-label={`${moneyIncoming} incoming`}>{moneyIncoming}</span>}
        </Link>
      </nav>

      {showMoney ? (
        <MoneyTab userId={user.id} againId={again} />
      ) : showRequests ? (
        <>
      <div className="card">
        <h2>Incoming requests</h2>
        {incoming.length === 0 ? (
          <EmptyState title="No incoming requests">When someone adds you, it shows up here.</EmptyState>
        ) : (
          <ul className="rows">
            {incoming.map((r) => (
              <li key={r.id} className="item">
                <Avatar name={r.otherUsername} />
                <div className="item-main"><div className="item-title">@{r.otherUsername}</div></div>
                <div className="item-actions">
                  <form action={acceptRequestAction}><input type="hidden" name="id" value={r.id} /><SubmitButton>Accept</SubmitButton></form>
                  <form action={declineRequestAction}><input type="hidden" name="id" value={r.id} /><SubmitButton className="secondary">Decline</SubmitButton></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Outgoing requests</h2>
        {outgoing.length === 0 ? (
          <EmptyState title="No outgoing requests">Search above to add a friend.</EmptyState>
        ) : (
          <ul className="rows">
            {outgoing.map((r) => (
              <li key={r.id} className="item">
                <Avatar name={r.otherUsername} />
                <div className="item-main"><div className="item-title">@{r.otherUsername}</div><div className="item-sub">Waiting for them to accept</div></div>
                <form action={cancelRequestAction}><input type="hidden" name="id" value={r.id} /><SubmitButton className="secondary">Cancel</SubmitButton></form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>History</h2>
        {history.length === 0 ? (
          <EmptyState title="Nothing yet">Accepted, declined, cancelled and removed friendships show up here.</EmptyState>
        ) : (
          <ul className="rows">
            {history.map((e) => (
              <li key={e.id} className="item">
                <Avatar name={e.otherUsername} />
                <div className="item-main">
                  <div className="item-title" style={{ fontWeight: 500 }}>{describeEvent(e)}</div>
                  <div className="item-sub">{utc(e.createdAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

        </>
      ) : (
        <>
      <div className="card">
        <h2>Find people</h2>
        <form method="get" className="search-row">
          <input name="q" type="search" defaultValue={q} placeholder="Search by username" aria-label="Search by username" />
          <button type="submit">Search</button>
        </form>
        {q && results.length === 0 && <EmptyState title="No users found">Type at least 2 characters of a username.</EmptyState>}
        {results.length > 0 && (
          <ul className="rows" style={{ marginTop: 8 }}>
            {results.map((r) => (
              <li key={r.id} className="item">
                <Avatar name={r.username} />
                <div className="item-main">
                  <div className="item-title">@{r.username}</div>
                  {r.relation === 'friends' && <div className="item-sub">Friends</div>}
                  {r.relation === 'outgoing' && <div className="item-sub">Request sent</div>}
                  {r.relation === 'incoming' && <div className="item-sub">Wants to be friends. See below.</div>}
                </div>
                {r.relation === 'none' && (
                  <form action={sendRequestAction} style={{ margin: 0 }}>
                    <input type="hidden" name="username" value={r.username} />
                    <SubmitButton pendingText="Sending…">Add</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Your friends</h2>
        {accepted.length === 0 ? (
          <EmptyState title="No friends yet">Search for a username above to get started.</EmptyState>
        ) : (
          <ul className="rows">
            {accepted.map((r) => (
              <li key={r.id} className="item">
                <Avatar name={r.otherUsername} />
                <div className="item-main"><div className="item-title">@{r.otherUsername}</div></div>
                <details className="confirm">
                  <summary>Remove</summary>
                  <div className="confirm-body">
                    <p style={{ margin: '0 0 8px' }}>Remove @{r.otherUsername}? You will not be able to send to each other until you are friends again.</p>
                    <form action={removeFriendAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn-danger btn-sm" pendingText="Removing…">Yes, remove</SubmitButton>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
        </>
      )}
    </>
  );
}
