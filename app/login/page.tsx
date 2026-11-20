'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction } from '../actions';
import { Spinner } from '../components/Spinner';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <div className="auth">
      <p className="brand-big">P2P <span>USDC</span></p>
      <p className="tagline">Send test USDC to friends. A testnet demo.</p>
      <div className="card">
        <h1>Log in</h1>
        <form action={action}>
          <label htmlFor="identifier">Email or username</label>
          <input id="identifier" name="identifier" autoComplete="username" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {state?.error && <p className="alert alert-error" role="alert">{state.error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-block" disabled={pending} aria-busy={pending}>
              {pending ? <><Spinner /> Logging in…</> : 'Log in'}
            </button>
          </div>
        </form>
      </div>
      <p className="auth-switch muted">
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </div>
  );
}
