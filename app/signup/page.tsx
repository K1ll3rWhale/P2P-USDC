'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signupAction } from '../actions';
import { Spinner } from '../components/Spinner';

export default function SignupPage() {
  const [state, action, pending] = useActionState(signupAction, undefined);
  return (
    <div className="auth">
      <p className="brand-big">P2P <span>USDC</span></p>
      <p className="tagline">Create an account to get a testnet wallet. No real money involved.</p>
      <div className="card">
        <h1>Create account</h1>
        <form action={action}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" minLength={3} maxLength={20} required />
          <p className="field-hint">3 to 20 characters. Friends find you by this name.</p>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          <p className="field-hint">At least 10 characters.</p>
          {state?.error && <p className="alert alert-error" role="alert">{state.error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-block" disabled={pending} aria-busy={pending}>
              {pending ? <><Spinner /> Creating wallet…</> : 'Sign up'}
            </button>
          </div>
        </form>
      </div>
      <p className="auth-switch muted">
        Already registered? <Link href="/login">Log in</Link>
      </p>
    </div>
  );
}
