import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { isAddress } from 'viem';
import { formatUsdc, parseUsdcAmount } from './amount';
import { db } from './db';
import { quotes, wallets } from './db/schema';
import { estimateFeeRaw } from './fees';
import { getAcceptedFriendByUsername } from './friends';
import { hit, RATE_LIMITS } from './ratelimit';

export const QUOTE_TTL_MS = 30_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type Failure = { ok: false; status: number; code: string; error: string };
export const fail = (status: number, code: string, error: string): Failure => ({ ok: false, status, code, error });

export type QuoteView = {
  id: string;
  op: 'send' | 'withdraw';
  recipientLabel: string; // @username (send) or the full destination address (withdraw)
  receives: string; // exactly what the recipient gets
  estimatedFee: string; // an estimate; the actual fee is recorded after sending
  estimatedTotal: string;
  expiresAt: number;
};

/** Withdrawal destination rules. Returns the lowercase address or a failure. */
export function validateWithdrawAddress(input: string): { ok: true; address: string } | Failure {
  const a = input.trim();
  if (!isAddress(a)) return fail(422, 'invalid_address', 'Enter a valid Base Sepolia address (0x followed by 40 hex characters, with a valid checksum if mixed case).');
  const lower = a.toLowerCase();
  if (lower === ZERO_ADDRESS) return fail(422, 'zero_address', 'The zero address is not allowed.');
  if (db.select({ id: wallets.id }).from(wallets).where(eq(wallets.address, lower)).get()) {
    return fail(422, 'own_wallet', 'That is a wallet in this app. Use Send to pay another user.');
  }
  return { ok: true, address: lower };
}

export function createQuote(
  userId: string,
  input: { op: 'send' | 'withdraw'; recipient: string; amount: string },
  now: number = Date.now(),
): { ok: true; quote: QuoteView } | Failure {
  if (!hit(`quote:user:${userId}`, RATE_LIMITS.quotesPerMinutePerUser, RATE_LIMITS.shortWindowMs)) {
    return fail(429, 'rate_limited', 'Too many quote requests. Wait a moment and try again.');
  }
  const amount = parseUsdcAmount(String(input.amount ?? ''));
  if (!amount.ok) return fail(422, 'invalid_amount', amount.error);

  let recipientKey: string;
  let label: string;
  if (input.op === 'send') {
    const friend = getAcceptedFriendByUsername(userId, String(input.recipient ?? ''));
    if (!friend) return fail(403, 'not_friends', 'You can only send to accepted friends.');
    recipientKey = friend.id;
    label = `@${friend.username}`;
  } else if (input.op === 'withdraw') {
    const dest = validateWithdrawAddress(String(input.recipient ?? ''));
    if (!dest.ok) return dest;
    recipientKey = dest.address;
    label = dest.address;
  } else {
    return fail(422, 'invalid_op', 'Unknown operation.');
  }

  const fee = estimateFeeRaw();
  const id = randomUUID();
  db.insert(quotes)
    .values({ id, userId, op: input.op, recipientKey, amountRaw: amount.raw.toString(), estFeeRaw: fee.toString(), createdAt: now, expiresAt: now + QUOTE_TTL_MS })
    .run();
  return {
    ok: true,
    quote: {
      id,
      op: input.op,
      recipientLabel: label,
      receives: formatUsdc(amount.raw),
      estimatedFee: formatUsdc(fee),
      estimatedTotal: formatUsdc(amount.raw + fee),
      expiresAt: now + QUOTE_TTL_MS,
    },
  };
}
