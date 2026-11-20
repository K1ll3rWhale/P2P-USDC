import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { SubmitButton } from '../components/SubmitButton';
import { acceptRequestAction, cancelRequestAction, declineRequestAction, sendRequestAction } from '../friend-actions';
import { listFriendships, searchUsers } from '@/lib/friends';
import { requireUser } from '@/lib/session';

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; tab?: string }> }) {
  const user = await requireUser();
  if (user.status !== 'active') redirect('/');
  const { q = '', notice, tab } = await searchParams;
  const showRequests = tab === 'requests';
  const results = q ? searchUsers(user.id, q) : [];
  const { incoming, outgoing, accepted } = listFriendships(user.id);

  return (
    <>
      <h1>Friends</h1>
      {notice && <p className="alert alert-info" role="status">{notice}</p>}

      <nav className="subtabs" aria-label="Friends sections">
        <Link href="/friends" className="subtab" aria-current={showRequests ? undefined : 'page'}>Friends</Link>
        <Link href="/friends?tab=requests" className="subtab" aria-current={showRequests ? 'page' : undefined}>
          Friend requests{incoming.length > 0 && <span className="badge" aria-label={`${incoming.length} incoming`}>{incoming.length}</span>}
        </Link>
      </nav>

      {showRequests ? (
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
