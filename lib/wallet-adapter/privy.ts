import { createPrivateKey, createPublicKey } from 'node:crypto';
import { encodeFunctionData, erc20Abi, getAddress } from 'viem';
import { USDC_ADDRESS } from '../chain';
import { PrivyHttpError, privySignedRpc } from './privy-rpc';
import { ProviderRejectedError, type SendResult, type SendUsdcArgs, type TransactionHint, type WalletAdapter, type WalletRecord } from './types';

const API = 'https://api.privy.io/v1';

type PrivyWallet = {
  id: string;
  address: string;
  chain_type: string;
  owner_id: string | null;
  external_id?: string;
};

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing server environment variable ${name}`);
  return v;
}

export class PrivyWalletAdapter implements WalletAdapter {
  readonly provider = 'privy';

  private get appId() {
    return required('PRIVY_APP_ID');
  }
  private get secret() {
    return required('PRIVY_APP_SECRET');
  }

  /** Authorization key public key (base64 SPKI DER), derived from the private key (PKCS8 base64). */
  private ownerPublicKey(): string {
    const der = Buffer.from(required('PRIVY_AUTHORIZATION_PRIVATE_KEY').replace(/^wallet-auth:/, ''), 'base64');
    return createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }))
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
  }

  private redact(text: string): string {
    return [process.env.PRIVY_APP_SECRET, process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY]
      .filter((s): s is string => Boolean(s))
      .reduce((t, s) => t.split(s).join('[REDACTED]'), text);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.appId}:${this.secret}`).toString('base64'),
        'privy-app-id': this.appId,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Privy ${method} ${path.split('?')[0]} failed: HTTP ${res.status} ${this.redact(text)}`);
    return JSON.parse(text) as T;
  }

  private toRecord(w: PrivyWallet, externalId: string): WalletRecord {
    if (w.chain_type !== 'ethereum') throw new Error('Wallet is not an ethereum wallet');
    if (w.external_id !== externalId) throw new Error('Wallet external ID mismatch');
    // Only wallets owned by our authorization key are acceptable (only our server can sign for them).
    if (!w.owner_id || w.owner_id !== required('PRIVY_AUTHORIZATION_KEY_ID')) {
      throw new Error('Wallet is not owned by our authorization key');
    }
    return { providerWalletId: w.id, address: w.address };
  }

  async createWallet(externalId: string): Promise<WalletRecord> {
    const w = await this.request<PrivyWallet>('POST', '/wallets', {
      chain_type: 'ethereum',
      external_id: externalId,
      owner: { public_key: this.ownerPublicKey() },
    });
    return this.toRecord(w, externalId);
  }

  async findWalletByExternalId(externalId: string): Promise<WalletRecord | null> {
    const q = new URLSearchParams({ external_id: externalId, chain_type: 'ethereum', limit: '2' });
    const { data } = await this.request<{ data: PrivyWallet[] }>('GET', `/wallets?${q}`);
    if (data.length === 0) return null;
    if (data.length > 1) throw new Error('Multiple wallets share this external ID');
    return this.toRecord(data[0], externalId);
  }

  async sendUsdcTransfer({ providerWalletId, to, amountRaw, referenceId }: SendUsdcArgs): Promise<SendResult> {
    try {
      const resp = await privySignedRpc<{ data: { transaction_id?: string; user_operation_hash?: string; hash?: string } }>(providerWalletId, {
        method: 'eth_sendTransaction',
        caip2: 'eip155:84532',
        chain_type: 'ethereum',
        sponsor: true, // with sponsor_options.asset: user-pays gas in USDC (dashboard: app-pays sponsorship is off)
        sponsor_options: { asset: 'usdc' },
        reference_id: referenceId,
        params: {
          transaction: {
            to: USDC_ADDRESS,
            value: '0x0',
            data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [getAddress(to), amountRaw] }),
          },
        },
      });
      return { transactionId: resp.data.transaction_id, userOperationHash: resp.data.user_operation_hash, txHash: resp.data.hash || undefined };
    } catch (e) {
      // Only a clear client-side rejection means nothing was executed. Timeouts, 5xx and network errors are unclear.
      if (e instanceof PrivyHttpError && [400, 401, 403, 404, 422].includes(e.status)) throw new ProviderRejectedError(e.message.slice(0, 300));
      throw e;
    }
  }

  async getTransactionHint(transactionId: string): Promise<TransactionHint | null> {
    const t = await this.request<{ status?: string; transaction_hash?: string | null; user_operation_hash?: string }>('GET', `/transactions/${encodeURIComponent(transactionId)}`);
    return { status: t.status, txHash: t.transaction_hash || undefined, userOperationHash: t.user_operation_hash };
  }
}
