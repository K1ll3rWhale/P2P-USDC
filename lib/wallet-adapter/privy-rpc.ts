import { createPrivateKey, sign } from 'node:crypto';

// Signed Privy wallet RPC call, extracted from the validated scripts/privy-validate.mjs send.
// Server-only. Never log the request headers or environment values.
const API = 'https://api.privy.io/v1';

const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k])).join(',')}}`
  : JSON.stringify(v);

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing server environment variable ${name}`);
  return v;
}

/** POST /wallets/{id}/rpc signed by our authorization key. Throws with secrets redacted. Never auto-retries. */
export async function privySignedRpc<T>(walletId: string, body: Record<string, unknown>): Promise<T> {
  const appId = required('PRIVY_APP_ID');
  const secret = required('PRIVY_APP_SECRET');
  const authKey = required('PRIVY_AUTHORIZATION_PRIVATE_KEY');
  const path = `/wallets/${walletId}/rpc`;
  const payload = { version: 1, method: 'POST', url: API + path, body, headers: { 'privy-app-id': appId } };
  const key = createPrivateKey({ key: Buffer.from(authKey.replace(/^wallet-auth:/, ''), 'base64'), format: 'der', type: 'pkcs8' });
  const signature = sign('sha256', Buffer.from(canon(payload)), key).toString('base64');

  const res = await fetch(API + path, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${appId}:${secret}`).toString('base64'),
      'privy-app-id': appId,
      'privy-authorization-signature': signature,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const redacted = [secret, authKey].reduce((t, s) => t.split(s).join('[REDACTED]'), text);
    throw new Error(`Privy rpc failed: HTTP ${res.status} ${redacted}`);
  }
  return JSON.parse(text) as T;
}
