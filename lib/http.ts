import { NextResponse } from 'next/server';
import type { Failure } from './quotes';

/** CSRF defense for JSON POST routes (on top of SameSite=Lax cookies): the Origin must match this host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const failure = (f: Failure) => NextResponse.json({ error: f.error, code: f.code }, { status: f.status });
