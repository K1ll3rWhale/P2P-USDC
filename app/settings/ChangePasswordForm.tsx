'use client';

import { useActionState } from 'react';
import { Spinner } from '../components/Spinner';
import { changePasswordAction } from './actions';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action}>
      <label htmlFor="current" style={{ marginTop: 0 }}>Current password</label>
      <input id="current" name="current" type="password" autoComplete="current-password" required />
      <label htmlFor="next">New password</label>
      <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required />
      <p className="field-hint">At least 10 characters.</p>
      <label htmlFor="confirm">Confirm new password</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      {state?.error && <p className="alert alert-error" role="alert">{state.error}</p>}
      {state?.ok && <p className="alert alert-ok" role="status">{state.message}</p>}
      <div className="form-actions">
        <button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <><Spinner /> Changing…</> : 'Change password'}
        </button>
      </div>
    </form>
  );
}
