import { redirect } from 'next/navigation';
import { TransferForm } from '../components/TransferForm';
import { CopyButton } from './CopyButton';
import { USDC_ADDRESS } from '@/lib/chain';
import { getWalletFor, requireUser } from '@/lib/session';

export default async function WalletPage() {
  const user = await requireUser();
  const wallet = getWalletFor(user.id);
  if (user.status !== 'active' || !wallet) redirect('/');

  return (
    <>
      <div className="card" id="deposit">
        <h1>Your wallet</h1>
        <p className="muted">Your deposit address on Base Sepolia (testnet):</p>
        <div className="address" data-testid="wallet-address">{wallet.address}</div>
        <CopyButton text={wallet.address} />
      </div>
      <div className="card">
        <h2>How to add test USDC</h2>
        <ol className="steps">
          <li>
            <span>Open the <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Circle faucet</a>.</span>
          </li>
          <li><span>Choose <strong>Base Sepolia</strong> as the network and <strong>USDC</strong> as the token.</span></li>
          <li><span>Paste the address above and request funds.</span></li>
        </ol>
        <p className="muted">
          Only send USDC on Base Sepolia to this address. Sending other networks or tokens can lose them. The USDC
          contract is <code>{USDC_ADDRESS}</code>. Sending a transfer costs a small USDC fee, so keep a little extra.
        </p>
      </div>
      <TransferForm mode="withdraw" />
    </>
  );
}
