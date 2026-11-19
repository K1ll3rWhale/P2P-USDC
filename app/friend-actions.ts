'use server';

import { redirect } from 'next/navigation';
import { acceptRequest, cancelRequest, declineRequest, sendRequest, type FriendResult } from '@/lib/friends';
import { requireUser } from '@/lib/session';

const field = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');
const back = (r: FriendResult, ok: string): never =>
  redirect('/friends?notice=' + encodeURIComponent(r.ok ? ok : r.error));

// Every action resolves the actor from the session; IDs from the form are never trusted for identity.
export async function sendRequestAction(fd: FormData) {
  const user = await requireUser();
  back(sendRequest(user.id, field(fd, 'username')), 'Request sent.');
}
export async function acceptRequestAction(fd: FormData) {
  const user = await requireUser();
  back(acceptRequest(user.id, field(fd, 'id')), 'Friend added.');
}
export async function declineRequestAction(fd: FormData) {
  const user = await requireUser();
  back(declineRequest(user.id, field(fd, 'id')), 'Request declined.');
}
export async function cancelRequestAction(fd: FormData) {
  const user = await requireUser();
  back(cancelRequest(user.id, field(fd, 'id')), 'Request cancelled.');
}
