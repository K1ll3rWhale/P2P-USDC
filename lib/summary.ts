import { and, desc, eq, ne } from 'drizzle-orm';
import { formatUnits } from 'viem';
import { getUsdcBalance } from './chain';
import { db } from './db';
import { transfers } from './db/schema';
import { USDC_DECIMALS } from './chain';

export type ActivityItem = {
  id: string;
  kind: string;
  amount: string; // formatted USDC
  status: 'observed' | 'confirmed' | 'dropped';
  txHash: string;
  blockNumber: number;
  when: number; // ms: block time if known, else first observed
};

export type Summary = {
  balance: { formatted: string; asOf: number } | null;
  activity: ActivityItem[];
};

/** The user's own deposits only (rows are scoped by user ID), newest first. */
export function listActivity(userId: string, limit: number): ActivityItem[] {
  return db
    .select()
    .from(transfers)
    .where(and(eq(transfers.userId, userId), ne(transfers.status, 'dropped')))
    .orderBy(desc(transfers.blockNumber), desc(transfers.logIndex))
    .limit(limit)
    .all()
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: formatUnits(BigInt(t.amountRaw), USDC_DECIMALS),
      status: t.status,
      txHash: t.txHash,
      blockNumber: t.blockNumber,
      when: t.blockTimestamp ? t.blockTimestamp * 1000 : t.observedAt,
    }));
}

export async function getSummary(userId: string, address: string, limit: number): Promise<Summary> {
  let balance: Summary['balance'] = null;
  try {
    const b = await getUsdcBalance(address);
    balance = { formatted: b.formatted, asOf: b.asOf };
  } catch (e) {
    console.error('[summary] balance read failed:', e instanceof Error ? e.message : 'unknown');
  }
  return { balance, activity: listActivity(userId, limit) };
}
