'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signupAction } from '../actions';

export default function SignupPage() {
  const [state, action, pending] = useActionState(signupAction, undefined);
  return (
    <div className="card">
      <h1>Create account</h1>
      <form action={action}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoComplete="username" minLength={3} maxLength={20} required />
        <label htmlFor="password">Password (at least 10 characters)</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        {state?.error && <p className="error" role="alert">{state.error}</p>}
        <p>
          <button type="submit" disabled={pending}>{pending ? 'Creating wallet…' : 'Sign up'}</button>
        </p>
      </form>
      <p className="muted">
        Already registered? <Link href="/login">Log in</Link>
      </p>
    </div>
  );
}
