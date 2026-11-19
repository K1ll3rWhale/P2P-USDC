import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { payments } from './db/schema';

// The provider gives no fee quote, so the quote shows an ESTIMATE: the median of recent recorded actual
// fees, or this constant when none exist. Measured so far: 0.003445 and 0.002794 USDC.
export const DEFAULT_ESTIMATED_FEE_RAW = 3000n; // 0.003 USDC
export const FEE_SAMPLE_SIZE = 10;

export function median(values: bigint[]): bigint {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2n;
}

export function estimateFeeRaw(): bigint {
  const rows = db
    .select({ fee: payments.actualFeeRaw })
    .from(payments)
    .where(and(eq(payments.status, 'confirmed'), isNotNull(payments.actualFeeRaw)))
    .orderBy(desc(payments.resolvedAt))
    .limit(FEE_SAMPLE_SIZE)
    .all();
  const fees = rows.map((r) => BigInt(r.fee!)).filter((f) => f > 0n);
  return fees.length ? median(fees) : DEFAULT_ESTIMATED_FEE_RAW;
}
