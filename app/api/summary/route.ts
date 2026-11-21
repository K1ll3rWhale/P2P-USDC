import { NextResponse } from 'next/server';
import { getSummary } from '@/lib/summary';
import { getCurrentUser, getWalletFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const wallet = getWalletFor(user.id);
  if (user.status !== 'active' || !wallet) return NextResponse.json({ error: 'Wallet not ready' }, { status: 409 });
  const limit = Math.min(200, Math.max(1, Number.parseInt(new URL(req.url).searchParams.get('limit') ?? '5', 10) || 5));
  return NextResponse.json(await getSummary(user.id, wallet.address, limit), { headers: { 'Cache-Control': 'no-store' } });
}
