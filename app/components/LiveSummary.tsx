'use client';

import { useEffect, useState } from 'react';
import type { Summary } from '@/lib/summary';

const POLL_MS = 10_000;
const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', failed: 'Failed', stuck: 'Taking longer than expected' } as const;
const TITLE = { deposit: 'Deposit from', receipt: 'Received from', send: 'Sent to', withdrawal: 'Withdrawal to' } as const;
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
              {stale && <p className="error">Could not refresh just now. This balance may be out of date (as of {clock(data.balance.asOf)}).</p>}
            </>
          ) : (
            <p className="error">Balance unavailable right now. Retrying.</p>
          )}
          <a className="btn" href="/wallet#deposit">Deposit</a>
        </div>
      )}
      <div className="card">
        <h2>{showBalance ? 'Recent activity' : 'All activity'}</h2>
        {stale && <p className="muted">Could not refresh. Showing the last data.</p>}
        {data.activity.length === 0 ? (
          <p className="muted">No activity yet. Deposit test USDC to your wallet address.</p>
        ) : (
          <ul className="list">
            {data.activity.map((a) => {
              const incoming = a.type === 'deposit' || a.type === 'receipt';
              return (
                <li key={a.id}>
                  <div className="row">
                    <strong>{incoming ? '+' : '−'}{a.amount} USDC</strong>
                    <span className="muted">{TITLE[a.type]} {a.counterpart}</span>
                  </div>
                  {a.note && <div>“{a.note}”</div>}
                  <div className="muted">
                    {STATUS_LABEL[a.status]} · {utc(a.when)}
                    {a.txHash && (
                      <>
                        {' '}· <a href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer">BaseScan</a>
                      </>
                    )}
                  </div>
                  {a.fee && <div className="muted">Network fee {a.fee} USDC</div>}
                  {!a.fee && a.feeEstimate && <div className="muted">Estimated network fee ≈ {a.feeEstimate} USDC</div>}
                  {a.status === 'stuck' && <div className="error">This is taking longer than usual. We are checking the chain. Nothing is resent automatically.</div>}
                  {a.status === 'failed' && <div className="error">{a.error || 'This transfer failed.'}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
