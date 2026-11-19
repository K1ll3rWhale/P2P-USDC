'use server';

import { redirect } from 'next/navigation';
import { loginUser, signupUser } from '@/lib/accounts';
import { provisionWallet } from '@/lib/provisioning';
import { clientIp, createSession, destroySession, requireUser } from '@/lib/session';

export type FormState = { error?: string } | undefined;

const str = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');

export async function signupAction(_: FormState, fd: FormData): Promise<FormState> {
  const result = await signupUser(
    { email: str(fd, 'email'), username: str(fd, 'username'), password: str(fd, 'password') },
    await clientIp(),
  );
  if (!result.ok) return { error: result.error };
  await createSession(result.userId); // signed in even if the wallet is pending, so it can be retried
  redirect('/');
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const result = await loginUser({ identifier: str(fd, 'identifier'), password: str(fd, 'password') }, await clientIp());
  if (!result.ok) return { error: result.error };
  await createSession(result.userId);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}

export async function retryProvisionAction(): Promise<void> {
  const user = await requireUser();
  await provisionWallet(user.id);
  redirect('/');
}
