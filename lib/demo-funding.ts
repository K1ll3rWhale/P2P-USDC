import { formatUsdc } from './amount';

/** Hard cap on the total sent from the validation sender in one demo:prepare run (named constant). */
export const MAX_FUND_PER_RUN_RAW = 20_000_000n; // 20 USDC
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export type FundingPlan =
  | { ok: true; usernames: string[]; totalRaw: bigint; neededRaw: bigint }
  | { ok: false; error: string };

/**
 * Pure planning/refusal logic for demo:prepare. Refuses when the per-run cap would be exceeded, or when the
 * validation sender cannot cover the requested amounts PLUS estimated network fees (one fee per recipient).
 */
export function planFunding(input: { amountRaw: bigint; usernames: string[]; senderBalanceRaw: bigint; estFeeRaw: bigint }): FundingPlan {
  const names = [...new Set(input.usernames.map((u) => u.trim()).filter(Boolean))];
  if (names.length === 0) return { ok: false, error: 'Give at least one username.' };
  const bad = names.find((n) => !USERNAME_RE.test(n));
  if (bad) return { ok: false, error: `"${bad}" is not a valid username (3-20 letters, numbers or underscores).` };
  if (input.amountRaw <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };
  const total = input.amountRaw * BigInt(names.length);
  if (total > MAX_FUND_PER_RUN_RAW) {
    return { ok: false, error: `Refusing: ${formatUsdc(total)} USDC in one run exceeds the ${formatUsdc(MAX_FUND_PER_RUN_RAW)} USDC cap.` };
  }
  const needed = total + input.estFeeRaw * BigInt(names.length);
  if (input.senderBalanceRaw < needed) {
    return {
      ok: false,
      error: `Refusing: the validation sender holds ${formatUsdc(input.senderBalanceRaw)} USDC but ${formatUsdc(needed)} USDC is needed (${formatUsdc(total)} plus estimated fees ${formatUsdc(input.estFeeRaw * BigInt(names.length))}).`,
    };
  }
  return { ok: true, usernames: names, totalRaw: total, neededRaw: needed };
}
