import { randomBytes } from 'node:crypto';

/** A fresh per-request nonce for the Content-Security-Policy. */
export const newNonce = (): string => randomBytes(16).toString('base64');

/**
 * Content-Security-Policy for the app. Scripts run only with this request's nonce ('strict-dynamic' lets Next's
 * own bootstrap load its chunks). The browser never calls the RPC or the wallet provider, so connect-src is
 * same-origin only. React inline style attributes need 'unsafe-inline' for styles (no script risk).
 */
export function buildCsp(nonce: string, dev: boolean = process.env.NODE_ENV !== 'production'): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  return directives.join('; ');
}

/** Headers added to every response (besides the CSP itself). */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Set CSP_REPORT_ONLY=1 to send the policy as Content-Security-Policy-Report-Only (a rollback switch). */
export const cspHeaderName = (): string =>
  process.env.CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
