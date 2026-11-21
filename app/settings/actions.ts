'use server';

import { redirect } from 'next/navigation';
import { changePassword, revokeOtherSessions } from '@/lib/account-security';
import { getCurrentSessionId, requireUser } from '@/lib/session';

export type PasswordFormState = { ok?: boolean; error?: string; message?: string } | undefined;
const field = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');

// The actor and the session to keep both come from the session cookie, never from the form.
export async function changePasswordAction(_: PasswordFormState, fd: FormData): Promise<PasswordFormState> {
  const user = await requireUser();
  const sessionId = await getCurrentSessionId();
  if (!sessionId) return { error: 'Your session has ended. Please log in again.' };
  const r = await changePassword(user.id, sessionId, { current: field(fd, 'current'), next: field(fd, 'next'), confirm: field(fd, 'confirm') });
  return r.ok ? { ok: true, message: r.message } : { error: r.error };
}

export async function revokeOtherSessionsAction() {
  const user = await requireUser();
  const sessionId = await getCurrentSessionId();
  if (!sessionId) redirect('/login');
  const n = revokeOtherSessions(user.id, sessionId);
  redirect(`/settings?notice=${encodeURIComponent(n === 0 ? 'No other sessions were signed in.' : `Signed out ${n} other ${n === 1 ? 'session' : 'sessions'}.`)}`);
}
