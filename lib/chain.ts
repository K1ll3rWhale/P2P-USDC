import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress } from 'viem';

export const CHAIN_ID = 84532; // Base Sepolia
export const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const USDC_DECIMALS = 6;
const DEFAULT_RPC = 'https://sepolia.base.org';
const BALANCE_TTL_MS = 10_000;

export class ChainConfigError extends Error {}

const client = createPublicClient({ transport: http(process.env.BASE_SEPOLIA_RPC_URL?.trim() || DEFAULT_RPC) });

const g = globalThis as unknown as {
  __chainOk?: Promise<void>;
  __balances?: Map<string, { raw: bigint; asOf: number }>;
};

/** Fails closed: throws ChainConfigError on any mismatch. A success is cached; a failure is retried on next use. */
export function assertChainConfig(): Promise<void> {
  g.__chainOk ??= (async () => {
    const chainId = await client.getChainId();
    if (chainId !== CHAIN_ID) throw new ChainConfigError(`RPC chain ID ${chainId} != ${CHAIN_ID}`);
    const code = await client.getCode({ address: USDC_ADDRESS });
    if (!code || code === '0x') throw new ChainConfigError('No contract at the configured USDC address');
    const decimals = await client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'decimals' });
    if (decimals !== USDC_DECIMALS) throw new ChainConfigError(`USDC decimals ${decimals} != ${USDC_DECIMALS}`);
  })().catch((e) => {
    g.__chainOk = undefined;
    throw e;
  });
  return g.__chainOk;
}

export type UsdcBalance = { raw: bigint; formatted: string; asOf: number };

/** USDC balance from the chain, cached at most BALANCE_TTL_MS per address. */
export async function getUsdcBalance(address: string): Promise<UsdcBalance> {
  if (!isAddress(address)) throw new Error('Invalid address');
  await assertChainConfig();
  const cache = (g.__balances ??= new Map());
  const key = address.toLowerCase();
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.asOf > BALANCE_TTL_MS) {
    const raw = await client.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(address)],
    });
    hit = { raw, asOf: Date.now() };
    cache.set(key, hit);
  }
  return { raw: hit.raw, formatted: formatUnits(hit.raw, USDC_DECIMALS), asOf: hit.asOf };
}
