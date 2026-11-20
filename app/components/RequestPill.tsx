import type { RequestState } from '@/lib/requests';

const LABEL: Record<RequestState, string> = { pending: 'Open', paying: 'Paying', paid: 'Paid', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' };
const TONE: Record<RequestState, string> = { pending: 'pending', paying: 'pending', paid: 'confirmed', declined: 'failed', cancelled: '', expired: '' };

export function RequestPill({ state }: { state: RequestState }) {
  return <span className={`pill ${TONE[state] ? `pill-${TONE[state]}` : ''}`}>{LABEL[state]}</span>;
}
