const LABEL = { pending: 'Pending', submitted: 'Submitted', confirmed: 'Confirmed', failed: 'Failed', stuck: 'Taking longer than expected' } as const;
export type PillStatus = keyof typeof LABEL;

export function StatusPill({ status }: { status: PillStatus }) {
  const tone = status === 'stuck' || status === 'submitted' ? 'pending' : status;
  return <span className={`pill pill-${tone}`}>{LABEL[status]}</span>;
}
