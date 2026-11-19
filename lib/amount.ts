import { formatUnits } from 'viem';

export const USDC_DECIMALS_EXACT = 6;
export const MAX_DEMO_AMOUNT_RAW = 100_000_000n; // 100 USDC demo maximum (named constant)
export const MAX_NOTE_LENGTH = 140;

export type AmountResult = { ok: true; raw: bigint } | { ok: false; error: string };

/** Exact decimal parsing to six places. No floats anywhere. */
export function parseUsdcAmount(input: string): AmountResult {
  const s = input.trim();
  if (s.startsWith('-')) return { ok: false, error: 'Amount must be greater than zero.' };
  if (!/^\d{1,12}(\.\d+)?$/.test(s)) return { ok: false, error: 'Enter an amount like 1.25.' };
  const [whole, frac = ''] = s.split('.');
  if (frac.length > USDC_DECIMALS_EXACT) return { ok: false, error: 'USDC amounts allow at most 6 decimal places.' };
  const raw = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(USDC_DECIMALS_EXACT, '0'));
  if (raw === 0n) return { ok: false, error: 'Amount must be greater than zero.' };
  if (raw > MAX_DEMO_AMOUNT_RAW) return { ok: false, error: 'The demo maximum is 100 USDC per transfer.' };
  return { ok: true, raw };
}

export const formatUsdc = (raw: bigint | string) => formatUnits(BigInt(raw), USDC_DECIMALS_EXACT);

/** Notes are plain text: trimmed, at most 140 characters (code points), no control characters. */
export function parseNote(input: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, note: null };
  if (typeof input !== 'string') return { ok: false, error: 'Note must be text.' };
  const note = input.trim();
  if (!note) return { ok: true, note: null };
  if ([...note].length > MAX_NOTE_LENGTH) return { ok: false, error: `Note must be at most ${MAX_NOTE_LENGTH} characters.` };
  if (/[\u0000-\u001F\u007F]/.test(note)) return { ok: false, error: 'Note cannot contain control characters.' };
  return { ok: true, note };
}

export const abbreviateAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
