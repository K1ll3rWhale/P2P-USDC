import { redirect } from 'next/navigation';
import { acceptRequestAction, cancelRequestAction, declineRequestAction, sendRequestAction } from '../friend-actions';
import { listFriendships, searchUsers } from '@/lib/friends';
import { requireUser } from '@/lib/session';

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string }> }) {
  const user = await requireUser();
  if (user.status !== 'active') redirect('/');
  const { q = '', notice } = await searchParams;
  const results = q ? searchUsers(user.id, q) : [];
  const { incoming, outgoing, accepted } = listFriendships(user.id);

  return (
    <>
      <h1>Friends</h1>
      {notice && <p className="card" role="status">{notice}</p>}

      <div className="card">
        <h2>Find people</h2>
        <form method="get" className="row">
          <input name="q" defaultValue={q} placeholder="Search by username" aria-label="Search by username" style={{ flex: 1 }} />
          <button type="submit">Search</button>
        </form>
        {q && results.length === 0 && <p className="muted">No users found (type at least 2 characters).</p>}
        <ul className="list">
          {results.map((r) => (
            <li key={r.id} className="row">
              <strong style={{ flex: 1 }}>@{r.username}</strong>
              {r.relation === 'none' && (
                <form action={sendRequestAction}>
                  <input type="hidden" name="username" value={r.username} />
                  <button type="submit">Add friend</button>
                </form>
              )}
              {r.relation === 'friends' && <span className="muted">Friends</span>}
              {r.relation === 'outgoing' && <span className="muted">Request sent</span>}
              {r.relation === 'incoming' && <span className="muted">Wants to be friends. See below.</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Incoming requests</h2>
        {incoming.length === 0 && <p className="muted">None.</p>}
        <ul className="list">
          {incoming.map((r) => (
            <li key={r.id} className="row">
              <strong style={{ flex: 1 }}>@{r.otherUsername}</strong>
              <form action={acceptRequestAction}><input type="hidden" name="id" value={r.id} /><button type="submit">Accept</button></form>
              <form action={declineRequestAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="secondary">Decline</button></form>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Outgoing requests</h2>
        {outgoing.length === 0 && <p className="muted">None.</p>}
        <ul className="list">
          {outgoing.map((r) => (
            <li key={r.id} className="row">
              <strong style={{ flex: 1 }}>@{r.otherUsername}</strong>
              <form action={cancelRequestAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="secondary">Cancel</button></form>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Your friends</h2>
        {accepted.length === 0 && <p className="muted">No friends yet.</p>}
        <ul className="list">
          {accepted.map((r) => (
            <li key={r.id}><strong>@{r.otherUsername}</strong></li>
          ))}
        </ul>
      </div>
    </>
  );
}
