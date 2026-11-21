import type { ActivityItem } from './summary';

/**
 * One CSV cell. Quotes are doubled and the cell is wrapped when it needs it. A cell that starts with a character a
 * spreadsheet would treat as a formula (= + - @, tab, carriage return) gets a leading apostrophe so notes and names
 * from other users can never run as formulas when the file is opened.
 */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const TYPE_LABEL = { deposit: 'Deposit', receipt: 'Received', send: 'Sent', withdrawal: 'Withdrawal' } as const;
export const CSV_HEADER = ['Date (UTC)', 'Type', 'Counterpart', 'Direction', 'Amount (USDC)', 'Status', 'Network fee (USDC)', 'Estimated fee (USDC)', 'Note', 'Transaction', 'BaseScan'];

export function activityToCsv(items: ActivityItem[]): string {
  const rows = items.map((a) => {
    const incoming = a.type === 'deposit' || a.type === 'receipt';
    return [
      new Date(a.when).toISOString(),
      TYPE_LABEL[a.type],
      a.counterpart?.replace(/^@/, '') ?? '', // usernames are plain [A-Za-z0-9_]; the @ would read as a formula start
      incoming ? 'in' : 'out',
      a.amount,
      a.status,
      a.fee,
      a.fee ? '' : a.feeEstimate,
      a.note,
      a.txHash,
      a.txHash ? `https://sepolia.basescan.org/tx/${a.txHash}` : '',
    ];
  });
  // Amounts and hashes never start with a formula character, but every cell goes through csvCell anyway.
  return [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
