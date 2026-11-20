import type { ActivityItem } from '@/lib/summary';
import { Avatar } from './Avatar';
import { fmtAmount, fmtFee, utc } from './format';
import { StatusPill } from './StatusPill';

/** One activity entry: avatar, counterpart, note, signed amount, status pill, date, fee, BaseScan link. */
export function ActivityRow({ a }: { a: ActivityItem }) {
  const incoming = a.type === 'deposit' || a.type === 'receipt';
  const who = a.counterpart ?? 'unknown';
  return (
    <li>
      <div className="item" style={{ alignItems: 'flex-start' }}>
        <Avatar name={who} />
        <div className="item-main">
          <div className="item-title">{who}</div>
          {a.note && <div className="item-sub">Note: “{a.note}”</div>}
          <div className="activity-meta">
            <span>{utc(a.when)}</span>
            {a.fee && <span>· Network fee {fmtFee(a.fee)} USDC</span>}
            {!a.fee && a.feeEstimate && <span>· Estimated network fee ≈ {fmtFee(a.feeEstimate)} USDC</span>}
            {a.txHash && (
              <a href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer">BaseScan</a>
            )}
          </div>
          {a.status === 'stuck' && <div className="error" style={{ marginTop: 4 }}>This is taking longer than usual. We are checking the chain. Nothing is resent automatically.</div>}
          {a.status === 'failed' && <div className="error" style={{ marginTop: 4 }}>{a.error || 'This transfer failed.'}</div>}
        </div>
        <div className="item-side">
          <div className={incoming ? 'amount in' : 'amount'}>{incoming ? '+' : '−'}{fmtAmount(a.amount)}</div>
          <div className="item-sub">USDC</div>
          <StatusPill status={a.status} />
        </div>
      </div>
    </li>
  );
}
