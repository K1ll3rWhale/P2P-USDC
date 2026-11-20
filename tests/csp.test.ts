import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCsp, cspHeaderName, newNonce } from '../lib/csp';

test('csp: nonces are unique and long; policy locks scripts, framing, forms and connections', () => {
  const a = newNonce();
  assert.notEqual(a, newNonce());
  assert.ok(a.length >= 20);
  const p = buildCsp(a, false);
  assert.ok(p.includes(`script-src 'self' 'nonce-${a}' 'strict-dynamic'`));
  assert.doesNotMatch(p.split(';').find((d) => d.includes('script-src'))!, /unsafe-inline|unsafe-eval/);
  for (const d of ["default-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "form-action 'self'", "base-uri 'self'"]) {
    assert.ok(p.includes(d), d);
  }
  assert.match(buildCsp(a, true), /unsafe-eval/, 'dev only');
});

test('csp: report-only switch', () => {
  const old = process.env.CSP_REPORT_ONLY;
  process.env.CSP_REPORT_ONLY = '1';
  assert.equal(cspHeaderName(), 'Content-Security-Policy-Report-Only');
  delete process.env.CSP_REPORT_ONLY;
  assert.equal(cspHeaderName(), 'Content-Security-Policy');
  if (old !== undefined) process.env.CSP_REPORT_ONLY = old;
});
