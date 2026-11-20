import { NextResponse } from 'next/server';
import { failure, sameOrigin } from '@/lib/http';
import { submitPayment } from '@/lib/payments';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Bad origin', code: 'bad_origin' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Wallet not ready', code: 'no_wallet' }, { status: 409 });
  const body = (await req.json().catch(() => null)) as { quoteId?: string; idempotencyKey?: string; note?: unknown; requestId?: unknown } | null;
  if (!body) return NextResponse.json({ error: 'Invalid request', code: 'invalid_request' }, { status: 400 });

  const r = await submitPayment(user.id, { quoteId: String(body.quoteId ?? ''), idempotencyKey: String(body.idempotencyKey ?? ''), note: body.note, requestId: body.requestId });
  if (!r.ok) return failure(r);
  return NextResponse.json(
    { replay: r.replay, payment: { id: r.payment.id, status: r.payment.status, kind: r.payment.kind } },
    { status: r.replay ? 200 : 201 },
  );
}
