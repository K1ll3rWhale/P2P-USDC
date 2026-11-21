'use server';

import { revalidatePath } from 'next/cache';
import { markActivitySeen } from '@/lib/notifications';
import { requireUser } from '@/lib/session';

/** Records that the signed-in user has looked at Activity, then refreshes the tab badges. */
export async function markActivitySeenAction() {
  const user = await requireUser();
  markActivitySeen(user.id);
  revalidatePath('/', 'layout');
}
