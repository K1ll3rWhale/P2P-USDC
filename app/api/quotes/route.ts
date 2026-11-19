import { NextResponse } from 'next/server';
import { failure, sameOrigin } from '@/lib/http';
import { createQuote } from '@/lib/quotes';
import { getCurrentUser, getWalletFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Bad origin', code: 'bad_origin' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
  if (user.status !== 'active' || !getWalletFor(user.id)) return NextResponse.json({ error: 'Wallet not ready', code: 'no_wallet' }, { status: 409 });
  const body = (await req.json().catch(() => null)) as { op?: string; recipient?: string; amount?: string } | null;
  if (!body || (body.op !== 'send' && body.op !== 'withdraw')) return NextResponse.json({ error: 'Invalid request', code: 'invalid_request' }, { status: 400 });
  const r = createQuote(user.id, { op: body.op, recipient: String(body.recipient ?? ''), amount: String(body.amount ?? '') });
  return r.ok ? NextResponse.json({ quote: r.quote }) : failure(r);
}
