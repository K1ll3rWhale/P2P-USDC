'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';
import { fmtAmount, fmtFee } from './format';
import { REFRESH_EVENT } from './LiveBalance';
import { Spinner } from './Spinner';

type Quote = { id: string; recipientLabel: string; receives: string; estimatedFee: string; estimatedTotal: string; expiresAt: number };
type Friend = { id: string; username: string };

const NOTE_MAX = 140;

const newKey = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Send (mode "send": pick an accepted friend) or withdraw (mode "withdraw": full destination address).
 * Flow: enter details, get a server quote (30 s), review it, confirm. An expired quote is refreshed and must be
 * confirmed again. Notes and names are rendered as plain text by React.
 */
export function TransferForm({ mode, friends = [] }: { mode: 'send' | 'withdraw'; friends?: Friend[] }) {
  const [recipient, setRecipient] = useState(friends[0]?.username ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info' | 'ok'; text: string } | null>(null);
  const key = useRef('');

  useEffect(() => {
    if (!quote) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [quote]);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, json };
  }

  async function getQuote(): Promise<boolean> {
    const { res, json } = await post('/api/quotes', { op: mode, recipient: recipient.trim(), amount });
    if (!res.ok) {
      setQuote(null);
      setMessage({ kind: 'error', text: String(json.error ?? 'Could not get a quote.') });
      return false;
    }
    setQuote(json.quote as Quote);
    key.current = newKey(); // one key per reviewed quote: double-clicks and retries return the same transfer
    return true;
  }

  async function onQuote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    await getQuote();
    setBusy(false);
  }

  async function onConfirm() {
    if (!quote || busy) return;
    setBusy(true);
    setMessage(null);
    const { res, json } = await post('/api/payments', { quoteId: quote.id, idempotencyKey: key.current, note: mode === 'send' ? note : undefined });
    if (res.ok) {
      setQuote(null);
      setAmount('');
      setNote('');
      setMessage({ kind: 'ok', text: 'Submitted. It shows in Activity as pending until the chain confirms it.' });
      window.dispatchEvent(new Event(REFRESH_EVENT)); // presentation only: tells the balance card to re-read /api/summary
    } else if (json.code === 'quote_expired' || json.code === 'quote_used') {
      const ok = await getQuote();
      if (ok) setMessage({ kind: 'info', text: 'The quote expired. Review the updated amounts and confirm again.' });
    } else {
      setMessage({ kind: 'error', text: String(json.error ?? 'Transfer failed.') });
      if (json.code !== 'transfer_in_progress' && json.code !== 'rate_limited') setQuote(null);
    }
    setBusy(false);
  }

  const expired = quote !== null && secondsLeft === 0;
  const label = mode === 'send' ? 'Send' : 'Withdraw';
  const noFriends = mode === 'send' && friends.length === 0;

  return (
    <div className="card">
      <h2>{mode === 'send' ? 'Send USDC to a friend' : 'Withdraw to an external address'}</h2>
      {noFriends ? (
        <EmptyState title="No friends to send to yet">
          Only accepted friends can receive a send. <a href="/friends">Add a friend</a> first.
        </EmptyState>
      ) : (
        <form onSubmit={onQuote}>
          {mode === 'send' ? (
            <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="label" style={{ padding: 0, marginTop: 0 }}>1. Choose a friend</legend>
              <div className="choice-list" role="radiogroup">
                {friends.map((f) => (
                  <label key={f.id} className="choice">
                    <input
                      type="radio"
                      name="friend"
                      value={f.username}
                      checked={recipient === f.username}
                      onChange={() => { setRecipient(f.username); setQuote(null); }}
                    />
                    <Avatar name={f.username} />
                    @{f.username}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <>
              <label htmlFor="dest" style={{ marginTop: 0 }}>Destination address (Base Sepolia)</label>
              <input id="dest" value={recipient} onChange={(e) => { setRecipient(e.target.value); setQuote(null); }} placeholder="0x…" autoComplete="off" spellCheck={false} style={{ fontFamily: 'var(--mono)' }} />
            </>
          )}
          <label htmlFor={`amount-${mode}`}>{mode === 'send' ? '2. ' : ''}Amount (USDC the recipient receives)</label>
          <input id={`amount-${mode}`} className="amount-input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} placeholder="0.00" autoComplete="off" />
          {mode === 'send' && (
            <>
              <label htmlFor="note">3. Note (optional)</label>
              <input id="note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} autoComplete="off" placeholder="What is it for?" />
              <p className="field-hint right" aria-live="polite">{[...note].length}/{NOTE_MAX}</p>
            </>
          )}
          <div className="form-actions">
            <button type="submit" className="btn-block" disabled={busy}>
              {busy && !quote ? <><Spinner /> Getting quote…</> : quote ? 'Refresh quote' : 'Review'}
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={`alert alert-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>
      )}

      {quote && (
        <div className="quote" aria-live="polite">
          <div className="to">
            {mode === 'withdraw' ? 'Withdraw to (full address):' : 'To:'}{' '}
            {mode === 'withdraw' ? <div className="address dest" data-testid="withdraw-destination">{quote.recipientLabel}</div> : <strong>{quote.recipientLabel}</strong>}
          </div>
          <dl>
            <div className="line"><dt>Recipient receives</dt><dd>{fmtAmount(quote.receives)} USDC</dd></div>
            <div className="line"><dt>Estimated network fee</dt><dd>≈ {fmtFee(quote.estimatedFee)} USDC</dd></div>
            <div className="line"><dt>Estimated total debit</dt><dd>{fmtAmount(quote.estimatedTotal)} USDC</dd></div>
          </dl>
          <p className="field-hint">The network fee is an estimate; the actual fee is recorded after sending.</p>
          <p className={expired ? 'countdown expired' : 'countdown'}>{expired ? 'This quote expired.' : `Quote valid for ${secondsLeft}s`}</p>
          <button type="button" className="btn-primary btn-block" onClick={expired ? getQuote : onConfirm} disabled={busy}>
            {busy ? <><Spinner /> Submitting…</> : expired ? 'Refresh quote' : `Confirm ${label.toLowerCase()}`}
          </button>
        </div>
      )}
    </div>
  );
}
