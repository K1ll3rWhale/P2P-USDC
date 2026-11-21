'use client';

import { useActionState, useEffect, useState } from 'react';
import { createRequestAction } from '../request-actions';
import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';

const NOTE_MAX = 140;

/** Ask an accepted friend to pay you. Expiry is in whole days (1 to 365, default 7); the server clamps and explains. */
export function RequestForm({ friends, prefill }: { friends: { id: string; username: string }[]; prefill?: { friend: string; amount: string; note: string | null } }) {
  const [state, action, pending] = useActionState(createRequestAction, undefined);
  const [friend, setFriend] = useState(prefill?.friend ?? friends[0]?.username ?? '');
  const [amount, setAmount] = useState(prefill?.amount ?? '');
  const [note, setNote] = useState(prefill?.note ?? '');
  const [days, setDays] = useState('');

  useEffect(() => {
    if (state?.ok) { setAmount(''); setNote(''); setDays(''); }
  }, [state]);

  if (friends.length === 0) {
    return (
      <div className="card">
        <h2>Request money</h2>
        <EmptyState title="No friends to ask yet">Only accepted friends can be asked for money. <a href="/friends">Add a friend</a> first.</EmptyState>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Request money</h2>
      {prefill && <p className="alert alert-info" role="status">Asking again: check the details and send.</p>}
      <form action={action}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <legend className="label" style={{ padding: 0, marginTop: 0 }}>Ask who?</legend>
          <div className="choice-list" role="radiogroup">
            {friends.map((f) => (
              <label key={f.id} className="choice">
                <input type="radio" name="friend" value={f.username} checked={friend === f.username} onChange={() => setFriend(f.username)} />
                <Avatar name={f.username} />
                @{f.username}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="req-amount">Amount (USDC)</label>
        <input id="req-amount" name="amount" className="amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoComplete="off" />
        <label htmlFor="req-note">Note (optional)</label>
        <input id="req-note" name="note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} autoComplete="off" placeholder="What is it for?" />
        <p className="field-hint right" aria-live="polite">{[...note].length}/{NOTE_MAX}</p>
        <label htmlFor="req-days">Expires after (days)</label>
        <input id="req-days" name="expiryDays" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="7" autoComplete="off" />
        <p className="field-hint">1 to 365 days. Leave empty for 7.</p>
        {state?.error && <p className="alert alert-error" role="alert">{state.error}</p>}
        {state?.ok && !state.warning && <p className="alert alert-ok" role="status">{state.message}</p>}
        {state?.ok && state.warning && <p className="alert alert-warn" role="alert">{state.message} {state.warning}</p>}
        <div className="form-actions">
          <button type="submit" className="btn-block" disabled={pending} aria-busy={pending}>
            {pending ? <><Spinner /> Sending request…</> : 'Send request'}
          </button>
        </div>
      </form>
    </div>
  );
}
