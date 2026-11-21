'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cancelMoneyRequest, createMoneyRequest, declineMoneyRequest, remindMoneyRequest } from '@/lib/requests';
import { requireUser } from '@/lib/session';

const field = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');

export type RequestFormState = { ok?: boolean; error?: string; warning?: string; message?: string } | undefined;

// The actor always comes from the session; IDs and usernames from the form are never trusted for identity.
export async function createRequestAction(_: RequestFormState, fd: FormData): Promise<RequestFormState> {
  const user = await requireUser();
  if (user.status !== 'active') return { error: 'Your wallet is not ready yet.' };
  const friend = field(fd, 'friend');
  const r = createMoneyRequest(user.id, { friend, amount: field(fd, 'amount'), note: field(fd, 'note'), expiryDays: field(fd, 'expiryDays') });
  if (!r.ok) return { error: r.error };
  revalidatePath('/friends');
  return { ok: true, message: `Request sent to @${friend.replace(/^@/, '')}.`, warning: r.warning };
}

const back = (ok: boolean, text: string): never => redirect(`/friends?tab=money&notice=${encodeURIComponent(text)}${ok ? '' : '&kind=error'}`);

export async function declineMoneyRequestAction(fd: FormData) {
  const user = await requireUser();
  const r = declineMoneyRequest(user.id, field(fd, 'id'));
  back(r.ok, r.ok ? 'Request declined.' : r.error);
}
export async function cancelMoneyRequestAction(fd: FormData) {
  const user = await requireUser();
  const r = cancelMoneyRequest(user.id, field(fd, 'id'));
  back(r.ok, r.ok ? 'Request cancelled.' : r.error);
}
export async function remindMoneyRequestAction(fd: FormData) {
  const user = await requireUser();
  const r = remindMoneyRequest(user.id, field(fd, 'id'));
  back(r.ok, r.ok ? 'Reminder sent.' : r.error);
}
