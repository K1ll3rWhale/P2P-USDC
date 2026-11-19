'use client';

import { useEffect, useState } from 'react';
import type { Summary } from '@/lib/summary';

const POLL_MS = 10_000;
const STATUS_LABEL = { observed: 'Pending (waiting for confirmations)', confirmed: 'Confirmed', dropped: 'Dropped' } as const;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19) + ' UTC';

export function LiveSummary({ initial, limit, showBalance }: { initial: Summary; limit: number; showBalance: boolean }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);

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

  return (
    <>
      {showBalance && (
        <div className="card">
          <h2>USDC balance</h2>
          {data.balance ? (
            <>
              <div className="balance">{data.balance.formatted} USDC</div>
              <p className="muted">As of {clock(data.balance.asOf)} · read from Base Sepolia · refreshes every 10 seconds</p>
            </>
          ) : (
            <p className="error">Balance unavailable right now. Retrying.</p>
          )}
          <a className="btn" href="/wallet#deposit">Deposit</a>
        </div>
      )}
      <div className="card">
        <h2>{showBalance ? 'Recent activity' : 'Deposits'}</h2>
        {stale && <p className="muted">Could not refresh. Showing the last data.</p>}
        {data.activity.length === 0 ? (
          <p className="muted">No deposits yet. Send test USDC to your wallet address.</p>
        ) : (
          <ul className="list">
            {data.activity.map((a) => (
              <li key={a.id}>
                <div className="row">
                  <strong>+{a.amount} USDC</strong>
                  <span className="muted">Deposit · {STATUS_LABEL[a.status]}</span>
                </div>
                <div className="muted">
                  {utc(a.when)} ·{' '}
                  <a href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer">BaseScan</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
