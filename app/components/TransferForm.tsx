'use client';

import { useEffect, useRef, useState } from 'react';

type Quote = { id: string; recipientLabel: string; receives: string; estimatedFee: string; estimatedTotal: string; expiresAt: number };
type Friend = { id: string; username: string };

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

  return (
    <div className="card">
      <h2>{mode === 'send' ? 'Send USDC to a friend' : 'Withdraw to an external address'}</h2>
      <form onSubmit={onQuote}>
        {mode === 'send' ? (
          friends.length === 0 ? (
            <p className="muted">You have no accepted friends yet. Add one on the Friends page.</p>
          ) : (
            <>
              <label htmlFor="friend">Friend</label>
              <select id="friend" value={recipient} onChange={(e) => { setRecipient(e.target.value); setQuote(null); }} style={{ width: '100%', padding: 10 }}>
                {friends.map((f) => <option key={f.id} value={f.username}>@{f.username}</option>)}
              </select>
            </>
          )
        ) : (
          <>
            <label htmlFor="dest">Destination address (Base Sepolia)</label>
            <input id="dest" value={recipient} onChange={(e) => { setRecipient(e.target.value); setQuote(null); }} placeholder="0x…" autoComplete="off" spellCheck={false} />
          </>
        )}
        <label htmlFor={`amount-${mode}`}>Amount (USDC the recipient receives)</label>
        <input id={`amount-${mode}`} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} placeholder="1.00" autoComplete="off" />
        {mode === 'send' && (
          <>
            <label htmlFor="note">Note (optional, up to 140 characters)</label>
            <input id="note" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          </>
        )}
        <p>
          <button type="submit" disabled={busy || (mode === 'send' && friends.length === 0)}>
            {busy && !quote ? 'Getting quote…' : quote ? 'Refresh quote' : 'Review'}
          </button>
        </p>
      </form>

      {message && <p className={message.kind === 'error' ? 'error' : 'muted'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      {quote && (
        <div className="address" aria-live="polite">
          <div>To: <strong>{quote.recipientLabel}</strong></div>
          <div>Recipient receives: <strong>{quote.receives} USDC</strong></div>
          <div>Estimated network fee: ≈ {quote.estimatedFee} USDC <span className="muted">(an estimate; the actual fee is recorded after sending)</span></div>
          <div>Estimated total debit: <strong>{quote.estimatedTotal} USDC</strong></div>
          <p className="muted">{expired ? 'This quote expired.' : `Valid for ${secondsLeft}s`}</p>
          <button type="button" onClick={expired ? getQuote : onConfirm} disabled={busy}>
            {busy ? 'Submitting…' : expired ? 'Refresh quote' : `Confirm ${label.toLowerCase()}`}
          </button>
        </div>
      )}
    </div>
  );
}
