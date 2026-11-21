import { ChangePasswordForm } from './ChangePasswordForm';
import { revokeOtherSessionsAction } from './actions';
import { SubmitButton } from '../components/SubmitButton';
import { utc } from '../components/format';
import { listSessions } from '@/lib/account-security';
import { getCurrentSessionId, requireUser } from '@/lib/session';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await requireUser();
  const { notice } = await searchParams;
  const current = await getCurrentSessionId();
  const sessions = listSessions(user.id, current);
  const others = sessions.filter((s) => !s.current).length;

  return (
    <>
      <h1>Settings</h1>
      {notice && <p className="alert alert-info" role="status">{notice}</p>}

      <div className="card">
        <h2>Account</h2>
        <p className="item-sub" style={{ margin: 0 }}>Username</p>
        <p style={{ marginTop: 0 }}><strong>@{user.username}</strong></p>
        <p className="item-sub" style={{ margin: 0 }}>Email</p>
        <p style={{ marginTop: 0, overflowWrap: 'anywhere' }}><strong>{user.email}</strong></p>
      </div>

      <div className="card">
        <h2>Change password</h2>
        <ChangePasswordForm />
      </div>

      <div className="card">
        <h2>Where you are signed in</h2>
        <ul className="rows">
          {sessions.map((s) => (
            <li key={s.id} className="item">
              <div className="item-main">
                <div className="item-title">{s.current ? 'This device' : 'Another session'}</div>
                <div className="item-sub">Signed in {utc(s.createdAt)} · expires {utc(s.expiresAt)}</div>
              </div>
              {s.current && <span className="pill pill-confirmed">Current</span>}
            </li>
          ))}
        </ul>
        {others > 0 ? (
          <form action={revokeOtherSessionsAction} style={{ marginTop: 12 }}>
            <SubmitButton className="secondary" pendingText="Signing out…">Sign out {others} other {others === 1 ? 'session' : 'sessions'}</SubmitButton>
          </form>
        ) : (
          <p className="muted">No other sessions are signed in.</p>
        )}
      </div>
    </>
  );
}
