// Minimal Privy validation script. Standalone; raw REST, no dependencies.
// Usage: node scripts/privy-validate.mjs create
// Prints only public data. Secrets are never logged.
import { createPublicKey, createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

process.loadEnvFile('.env.local');
const API = 'https://api.privy.io/v1';
const STATE = 'scripts/.privy-validate-state.json';
const { PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_PRIVATE_KEY } = process.env;

const redact = (s) =>
  [PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_PRIVATE_KEY]
    .filter(Boolean)
    .reduce((t, secret) => t.split(secret).join('[REDACTED]'), String(s));

async function privy(path, body) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64'),
      'privy-app-id': PRIVY_APP_ID,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${redact(text)}`);
  return JSON.parse(text);
}

// Authorization key public key (base64 SPKI DER) derived from the private key (PKCS8 base64).
function authPublicKey() {
  const der = Buffer.from(PRIVY_AUTHORIZATION_PRIVATE_KEY.replace(/^wallet-auth:/, ''), 'base64');
  const priv = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  return createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64');
}

async function create() {
  if (existsSync(STATE)) throw new Error(`${STATE} exists; wallets already created`);
  const publicKey = authPublicKey();
  const out = {};
  for (const role of ['sender', 'receiver']) {
    const w = await privy('/wallets', {
      chain_type: 'ethereum',
      external_id: `p2p-usdc-validate-${role}`,
      owner: { public_key: publicKey },
    });
    out[role] = { id: w.id, address: w.address, owner_id: w.owner_id, external_id: w.external_id };
    console.log(`${role}: ${w.address}  (external_id ${w.external_id ?? 'not returned'}, owner_id set: ${Boolean(w.owner_id)})`);
  }
  writeFileSync(STATE, JSON.stringify(out, null, 2));
}

// Compare each wallet's owner (key quorum) members to our derived public key. Prints booleans only.
async function verifyOwner() {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  const norm = (k) => String(k).replace(/-----[A-Z ]+-----|\s/g, '');
  const mine = norm(authPublicKey());
  for (const role of ['sender', 'receiver']) {
    const w = await privy(`/wallets/${state[role].id}`);
    const q = await privy(`/key_quorums/${w.owner_id}`);
    const keys = (q.authorization_keys ?? []).map((k) => norm(k.public_key));
    console.log(
      `${role}: owner matches derived key: ${keys.includes(mine)}; ` +
        `owner_id equals PRIVY_AUTHORIZATION_KEY_ID: ${w.owner_id === process.env.PRIVY_AUTHORIZATION_KEY_ID}; ` +
        `members: ${keys.length}, user_ids: ${q.user_ids?.length ?? 0}, threshold: ${q.authorization_threshold}`,
    );
  }
}

// ---- on-chain reads (raw JSON-RPC, Base Sepolia) ----
const RPC = process.env.BASE_SEPOLIA_RPC_URL?.trim() || 'https://sepolia.base.org';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`RPC ${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const call = (data) => rpc('eth_call', [{ to: USDC, data }, 'latest']);
const decodeString = (hex) => {
  const b = Buffer.from(hex.slice(2), 'hex');
  const len = Number(BigInt('0x' + b.subarray(32, 64).toString('hex')));
  return b.subarray(64, 64 + len).toString('utf8');
};
async function balances() {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  console.log(`rpc: ${RPC}  chainId: ${Number(await rpc('eth_chainId', []))}`);
  const decimals = Number(BigInt(await call('0x313ce567')));
  const symbol = decodeString(await call('0x95d89b41'));
  console.log(`USDC ${USDC}: symbol ${symbol}, decimals ${decimals}`);
  for (const role of ['sender', 'receiver']) {
    const a = state[role].address;
    const usdc = BigInt(await call('0x70a08231' + a.slice(2).toLowerCase().padStart(64, '0')));
    const eth = BigInt(await rpc('eth_getBalance', [a, 'latest']));
    console.log(`${role} ${a}: USDC ${Number(usdc) / 10 ** decimals} (raw ${usdc}), ETH ${eth} wei`);
  }
}

// ---- send 1 USDC, user-pays gas in USDC. ONE transaction per invocation; never auto-retries. ----
const canon = (v) =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}`
  : JSON.stringify(v);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a) => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
const bal = async (a) => BigInt(await call('0x70a08231' + pad(a).slice(2)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send() {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  if (state.send) throw new Error('state already has a send; refusing to send again');
  const { sender, receiver } = state;
  const before = { s: await bal(sender.address), r: await bal(receiver.address) };
  const startBlock = Number(await rpc('eth_blockNumber', []));
  console.log(`before: sender ${before.s}, receiver ${before.r} (raw USDC)`);

  const path = `/wallets/${sender.id}/rpc`;
  const body = {
    method: 'eth_sendTransaction',
    caip2: 'eip155:84532',
    chain_type: 'ethereum',
    sponsor: true,
    sponsor_options: { asset: 'usdc' },
    params: {
      transaction: {
        to: USDC,
        value: '0x0',
        data: '0xa9059cbb' + pad(receiver.address).slice(2) + (1_000_000n).toString(16).padStart(64, '0'),
      },
    },
  };
  const payload = { version: 1, method: 'POST', url: API + path, body, headers: { 'privy-app-id': PRIVY_APP_ID } };
  const der = Buffer.from(PRIVY_AUTHORIZATION_PRIVATE_KEY.replace(/^wallet-auth:/, ''), 'base64');
  const sig = (await import('node:crypto')).sign('sha256', Buffer.from(canon(payload)), createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).toString('base64');

  const res = await fetch(API + path, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64'),
      'privy-app-id': PRIVY_APP_ID,
      'privy-authorization-signature': sig,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = redact(await res.text());
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text}`);
  const resp = JSON.parse(text);
  state.send = { response: resp, startBlock };
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log('privy response:', JSON.stringify(resp, null, 2));

  // Find the tx on chain: use returned hash, else look for our Transfer log.
  let hash = resp.data?.hash || '';
  for (let i = 0; i < 30 && !hash; i++) {
    await sleep(2000);
    const logs = await rpc('eth_getLogs', [{ address: USDC, fromBlock: '0x' + startBlock.toString(16), toBlock: 'latest', topics: [TRANSFER_TOPIC, pad(sender.address), pad(receiver.address)] }]);
    if (logs.length) hash = logs[0].transactionHash;
  }
  console.log('tx hash:', hash || 'NOT FOUND on chain yet (do not resend)');
  if (!hash) return;
  let rcpt = null;
  for (let i = 0; i < 30 && !rcpt; i++) { rcpt = await rpc('eth_getTransactionReceipt', [hash]); if (!rcpt) await sleep(2000); }
  if (!rcpt) { console.log('no receipt yet (do not resend)'); return; }
  const tx = await rpc('eth_getTransactionByHash', [hash]);
  console.log(`receipt: status ${rcpt.status}, block ${Number(rcpt.blockNumber)}, gasUsed ${Number(rcpt.gasUsed)}, effectiveGasPrice ${Number(rcpt.effectiveGasPrice)}`);
  console.log(`tx.from (submitter/bundler): ${tx.from}, tx.to: ${rcpt.to}`);
  for (const l of rcpt.logs) {
    if (l.topics[0] === TRANSFER_TOPIC && l.address.toLowerCase() === USDC.toLowerCase())
      console.log(`USDC Transfer: from 0x${l.topics[1].slice(26)} to 0x${l.topics[2].slice(26)} value ${BigInt(l.data)}`);
    else console.log(`other log: ${l.address} topic0 ${l.topics[0]}`);
  }
  const after = { s: await bal(sender.address), r: await bal(receiver.address) };
  console.log(`after: sender ${after.s}, receiver ${after.r}; sender delta ${after.s - before.s}, receiver delta ${after.r - before.r}`);
  console.log(`ETH after: sender ${BigInt(await rpc('eth_getBalance', [sender.address, 'latest']))}, receiver ${BigInt(await rpc('eth_getBalance', [receiver.address, 'latest']))}`);
}

// ---- two sequential 0.01 USDC sends (no idempotency key), then code check ----
async function sendSmall() {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  const { sender, receiver } = state;
  state.small = state.small ?? [];
  const path = `/wallets/${sender.id}/rpc`;
  const key = createPrivateKey({ key: Buffer.from(PRIVY_AUTHORIZATION_PRIVATE_KEY.replace(/^wallet-auth:/, ''), 'base64'), format: 'der', type: 'pkcs8' });
  const { sign } = await import('node:crypto');
  for (let n = 1; n <= 2; n++) {
    const before = await bal(sender.address);
    const startBlock = Number(await rpc('eth_blockNumber', []));
    const body = {
      method: 'eth_sendTransaction', caip2: 'eip155:84532', chain_type: 'ethereum',
      sponsor: true, sponsor_options: { asset: 'usdc' },
      params: { transaction: { to: USDC, value: '0x0', data: '0xa9059cbb' + pad(receiver.address).slice(2) + (10_000n).toString(16).padStart(64, '0') } },
    };
    const payload = { version: 1, method: 'POST', url: API + path, body, headers: { 'privy-app-id': PRIVY_APP_ID } };
    const sig = sign('sha256', Buffer.from(canon(payload)), key).toString('base64');
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64'), 'privy-app-id': PRIVY_APP_ID, 'privy-authorization-signature': sig, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = redact(await res.text());
    if (!res.ok) throw new Error(`send ${n}: HTTP ${res.status}: ${text}`);
    const d = JSON.parse(text).data;
    state.small.push({ n, response: d });
    writeFileSync(STATE, JSON.stringify(state, null, 2));
    let hash = d.hash || '';
    for (let i = 0; i < 40 && !hash; i++) {
      await sleep(2000);
      const logs = await rpc('eth_getLogs', [{ address: USDC, fromBlock: '0x' + startBlock.toString(16), toBlock: 'latest', topics: [TRANSFER_TOPIC, pad(sender.address), pad(receiver.address)] }]);
      if (logs.length) hash = logs[0].transactionHash;
    }
    const rcpt = hash ? await rpc('eth_getTransactionReceipt', [hash]) : null;
    const after = await bal(sender.address);
    console.log(`send ${n}: transaction_id ${d.transaction_id}, user_op ${d.user_operation_hash}, response hash "${d.hash}", chain hash ${hash || 'NOT FOUND'}, receipt ${rcpt ? rcpt.status + ' gasUsed ' + Number(rcpt.gasUsed) : 'none'}, sender delta ${after - before}, USDC fee ${before - after - 10000n} raw`);
    if (!hash) throw new Error('hash not found; stopping, do not resend');
  }
}
async function code() {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  const c = await rpc('eth_getCode', [state.sender.address, 'latest']);
  console.log(`sender eth_getCode: ${c} (length ${(c.length - 2) / 2} bytes)`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'create') await create();
  else if (cmd === 'send-small') await sendSmall();
  else if (cmd === 'code') await code();
  else if (cmd === 'send') await send();
  else if (cmd === 'balances') await balances();
  else if (cmd === 'verify-owner') await verifyOwner();
  else throw new Error('usage: node scripts/privy-validate.mjs create');
} catch (e) {
  console.error(redact(e.message));
  process.exit(1);
}
