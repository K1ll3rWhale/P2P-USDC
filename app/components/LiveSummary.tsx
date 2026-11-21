'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Summary } from '@/lib/summary';
import { ActivityRow } from './ActivityRow';
import { EmptyState } from './EmptyState';
import { clock, fmtAmount } from './format';

const POLL_MS = 10_000;
const OLD_MS = 45_000; // a balance older than this is flagged as stale

type TypeFilter = 'all' | 'send' | 'receipt' | 'deposit' | 'withdrawal';
type StatusFilter = 'all' | 'pending' | 'confirmed' | 'failed';
const TYPE_CHIPS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'send', label: 'Sent' }, { value: 'receipt', label: 'Received' },
  { value: 'deposit', label: 'Deposits' }, { value: 'withdrawal', label: 'Withdrawals' },
];

export function LiveSummary({ initial, limit, showBalance, filters = false }: { initial: Summary; limit: number; showBalance: boolean; filters?: boolean }) {
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/summary?limit=${limit}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Summary;
        if (alive) { setData(next); setStale(false); }
      } catch {
        if (alive) setStale(true);
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [limit]);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const fromMs = from ? Date.parse(from + 'T00:00:00Z') : null;
  const toMs = to ? Date.parse(to + 'T23:59:59.999Z') : null;
  const shown = data.activity.filter((a) => {
    if (type !== 'all' && a.type !== type) return false;
    if (status === 'pending' && a.status !== 'pending' && a.status !== 'stuck') return false;
    if ((status === 'confirmed' || status === 'failed') && a.status !== status) return false;
    if (fromMs !== null && a.when < fromMs) return false;
    if (toMs !== null && a.when > toMs) return false;
    return true;
  });
  const filtered = type !== 'all' || status !== 'all' || from !== '' || to !== '';
  const clear = () => { setType('all'); setStatus('all'); setFrom(''); setTo(''); };

  const old = Boolean(data.balance && now !== null && now - data.balance.asOf > OLD_MS);

  return (
    <>
      {showBalance && (
        <div className="card hero">
          <p className="hero-label">USDC balance</p>
          {data.balance ? (
            <>
              <div className="balance">{fmtAmount(data.balance.formatted)} <small>USDC</small></div>
              <p className="hero-meta">
                As of {clock(data.balance.asOf)} · read from Base Sepolia · refreshes every 10 seconds{' '}
                {(stale || old) && <span className="pill pill-stale">Stale</span>}
              </p>
              {stale && <p className="alert alert-warn">Could not refresh just now. This balance may be out of date (as of {clock(data.balance.asOf)}).</p>}
            </>
          ) : (
            <p className="alert alert-warn" style={{ marginTop: 12 }}>Balance unavailable right now. Retrying.</p>
          )}
          <div className="btn-row">
            <Link className="btn btn-primary" href="/send">Send</Link>
            <a className="btn btn-secondary" href="/wallet#deposit">Deposit</a>
          </div>
        </div>
      )}
      <div className="card">
        <h2>{showBalance ? 'Recent activity' : 'All activity'}</h2>
        {stale && <p className="alert alert-warn">Could not refresh. Showing the last data.</p>}
        {filters && (
          <>
            <div className="chips" role="group" aria-label="Filter by type">
              {TYPE_CHIPS.map((c) => (
                <button key={c.value} type="button" className="chip" aria-pressed={type === c.value} onClick={() => setType(c.value)}>{c.label}</button>
              ))}
            </div>
            <div className="filters">
              <div>
                <label htmlFor="f-status">Status</label>
                <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-from">From (UTC date)</label>
                <input id="f-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label htmlFor="f-to">To (UTC date)</label>
                <input id="f-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </>
        )}
        {data.activity.length === 0 ? (
          <EmptyState title="No activity yet">Deposit test USDC to your wallet address and it will show up here.</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="No matching activity">
            Nothing fits these filters in your latest {data.activity.length} items.{' '}
            <button type="button" className="link" onClick={clear}>Clear filters</button>
          </EmptyState>
        ) : (
          <>
            <ul className="rows">
              {shown.map((a) => <ActivityRow key={a.id} a={a} />)}
            </ul>
            {filters && (
              <p className="field-hint" style={{ marginTop: 12 }}>
                Showing {shown.length}{filtered ? ` of ${data.activity.length}` : ''} of your latest {limit}. Download the CSV for everything.
              </p>
            )}
          </>
        )}
        {showBalance && data.activity.length > 0 && <p style={{ margin: '12px 0 0' }}><Link href="/activity">See all activity</Link></p>}
      </div>
    </>
  );
}
