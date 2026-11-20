'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Summary } from '@/lib/summary';
import { ActivityRow } from './ActivityRow';
import { EmptyState } from './EmptyState';
import { clock, fmtAmount } from './format';

const POLL_MS = 10_000;
const OLD_MS = 45_000; // a balance older than this is flagged as stale

export function LiveSummary({ initial, limit, showBalance }: { initial: Summary; limit: number; showBalance: boolean }) {
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
        {data.activity.length === 0 ? (
          <EmptyState title="No activity yet">Deposit test USDC to your wallet address and it will show up here.</EmptyState>
        ) : (
          <ul className="rows">
            {data.activity.map((a) => <ActivityRow key={a.id} a={a} />)}
          </ul>
        )}
        {showBalance && data.activity.length > 0 && <p style={{ margin: '12px 0 0' }}><Link href="/activity">See all activity</Link></p>}
      </div>
    </>
  );
}
