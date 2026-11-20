'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Summary } from '@/lib/summary';
import { clock, fmtAmount } from './format';

const POLL_MS = 10_000;
export const REFRESH_EVENT = 'p2p:refresh-summary';

/**
 * Balance card for the Send page. Reads the existing /api/summary endpoint on the 10 s poll and whenever the
 * transfer form announces a completed send. Unresolved outgoing transfers are shown as "pending".
 */
export function LiveBalance({ initial }: { initial: Summary }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/summary?limit=10', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Summary);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    window.addEventListener(REFRESH_EVENT, refresh);
    return () => { clearInterval(id); window.removeEventListener(REFRESH_EVENT, refresh); };
  }, [refresh]);

  const pending = data.activity.filter((a) => (a.type === 'send' || a.type === 'withdrawal') && (a.status === 'pending' || a.status === 'stuck'));
  const empty = data.balance && /^0(\.0+)?$/.test(data.balance.formatted);

  return (
    <div className="card balance-card">
      <p className="muted" style={{ margin: 0 }}>Your balance</p>
      {data.balance ? (
        <>
          <p className="balance">{fmtAmount(data.balance.formatted)} USDC</p>
          <p className="muted" style={{ margin: 0 }}>
            As of {clock(data.balance.asOf)} {stale && <span className="pill pill-stale">Stale</span>}
          </p>
        </>
      ) : (
        <p className="alert alert-warn">Balance unavailable right now; the server still checks it before sending.</p>
      )}
      {pending.length > 0 && (
        <p className="alert alert-warn" role="status">
          Pending: {pending.map((p) => `${fmtAmount(p.amount)} USDC`).join(', ')} (not yet confirmed; the balance may change when it resolves)
        </p>
      )}
      {empty && <p className="muted" style={{ margin: '8px 0 0' }}>You have no USDC yet. <Link href="/wallet#deposit">Deposit test USDC first</Link>.</p>}
    </div>
  );
}
