import { NextResponse } from 'next/server';
import { activityToCsv } from '@/lib/csv';
import { hit, RATE_LIMITS } from '@/lib/ratelimit';
import { getCurrentUser } from '@/lib/session';
import { listActivity } from '@/lib/summary';

export const dynamic = 'force-dynamic';
const EXPORT_LIMIT = 2000;

/** The signed-in user's own activity as CSV. The user always comes from the session; nothing in the URL selects whose. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hit(`export:user:${user.id}`, RATE_LIMITS.exportsPerMinutePerUser, RATE_LIMITS.shortWindowMs)) {
    return NextResponse.json({ error: 'Too many exports. Wait a minute.' }, { status: 429 });
  }
  const csv = activityToCsv(listActivity(user.id, EXPORT_LIMIT));
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="activity-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
