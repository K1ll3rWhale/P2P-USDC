import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { abbreviateAddress, formatUsdc } from './amount';
import { getUsdcBalance } from './chain';
import { db } from './db';
import { payments, transfers, users, wallets } from './db/schema';
import { STUCK_AFTER_MS } from './payments/resolve';

export type ActivityType = 'deposit' | 'receipt' | 'send' | 'withdrawal';
export type ActivityStatus = 'pending' | 'confirmed' | 'failed' | 'stuck';

export type ActivityItem = {
  id: string;
  type: ActivityType;
  amount: string; // formatted USDC (what the recipient receives)
  fee: string | null; // actual network fee, when known
  feeEstimate: string | null; // shown only while the actual fee is unknown (outgoing)
  status: ActivityStatus;
  counterpart: string | null; // @username or abbreviated address; plain text
  note: string | null; // plain text
  txHash: string | null;
  error: string | null;
  when: number; // ms
};

export type Summary = {
  balance: { formatted: string; asOf: number } | null;
  activity: ActivityItem[];
};

/**
 * The user's own activity, newest first. Deposits and receipts come from observed on-chain transfers; sends and
 * withdrawals come from the user's intents, so a payment is never counted twice (the sender sees one send, the
 * recipient sees one receipt, and a payment from another app user is never a deposit).
 */
export function listActivity(userId: string, limit: number, now: number = Date.now()): ActivityItem[] {
  const names = new Map(
    db.select({ address: wallets.address, username: users.username }).from(wallets).innerJoin(users, eq(users.id, wallets.userId)).all().map((r) => [r.address, r.username]),
  );

  const tRows = db
    .select()
    .from(transfers)
    .where(and(eq(transfers.userId, userId), ne(transfers.status, 'dropped')))
    .orderBy(desc(transfers.blockNumber), desc(transfers.logIndex))
    .limit(limit)
    .all();
  const claimedIds = tRows.map((t) => t.claimedIntentId).filter((x): x is string => Boolean(x));
  const claimed = claimedIds.length ? new Map(db.select().from(payments).where(inArray(payments.id, claimedIds)).all().map((p) => [p.id, p])) : new Map<string, typeof payments.$inferSelect>();

  const items: ActivityItem[] = tRows.map((t) => {
    const intent = t.claimedIntentId ? claimed.get(t.claimedIntentId) : undefined;
    const sender = names.get(t.fromAddress);
    return {
      id: `t:${t.id}`,
      type: t.kind === 'receipt' ? 'receipt' : 'deposit',
      amount: formatUsdc(t.amountRaw),
      fee: null,
      feeEstimate: null,
      status: t.status === 'confirmed' ? 'confirmed' : 'pending',
      counterpart: t.kind === 'receipt' ? (sender ? `@${sender}` : abbreviateAddress(t.fromAddress)) : abbreviateAddress(t.fromAddress),
      note: intent?.note ?? null,
      txHash: t.txHash,
      error: null,
      when: t.blockTimestamp ? t.blockTimestamp * 1000 : t.observedAt,
    };
  });

  const pRows = db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(limit).all();
  for (const p of pRows) {
    const unresolved = p.status === 'created' || p.status === 'submitted';
    const recipientName = p.recipientUserId ? db.select({ u: users.username }).from(users).where(eq(users.id, p.recipientUserId)).get()?.u : undefined;
    items.push({
      id: `p:${p.id}`,
      type: p.kind === 'send' ? 'send' : 'withdrawal',
      amount: formatUsdc(p.amountRaw),
      fee: p.actualFeeRaw ? formatUsdc(p.actualFeeRaw) : null,
      feeEstimate: !p.actualFeeRaw && unresolved ? formatUsdc(p.estFeeRaw) : null,
      status: unresolved ? (now - p.createdAt > STUCK_AFTER_MS ? 'stuck' : 'pending') : p.status === 'confirmed' ? 'confirmed' : 'failed',
      counterpart: recipientName ? `@${recipientName}` : abbreviateAddress(p.toAddress),
      note: p.note,
      txHash: p.txHash,
      error: p.status === 'failed' ? p.error : null,
      when: p.createdAt,
    });
  }
  return items.sort((a, b) => b.when - a.when).slice(0, limit);
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
