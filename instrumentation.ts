export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertChainConfig, ChainConfigError } = await import('./lib/chain');
  try {
    await assertChainConfig();
    console.log('[chain] Base Sepolia (84532), USDC contract and 6 decimals verified');
  } catch (e) {
    if (e instanceof ChainConfigError) throw e; // misconfiguration: refuse to start
    console.warn('[chain] startup check could not reach the RPC; it will be retried before any balance read');
  }
}
