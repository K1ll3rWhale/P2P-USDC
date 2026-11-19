'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction } from '../actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <div className="card">
      <h1>Log in</h1>
      <form action={action}>
        <label htmlFor="identifier">Email or username</label>
        <input id="identifier" name="identifier" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {state?.error && <p className="error" role="alert">{state.error}</p>}
        <p>
          <button type="submit" disabled={pending}>{pending ? 'Logging in…' : 'Log in'}</button>
        </p>
      </form>
      <p className="muted">
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </div>
  );
}
