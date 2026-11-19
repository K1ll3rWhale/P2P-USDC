import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { logoutAction } from './actions';
import './globals.css';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'P2P USDC (Base Sepolia testnet)' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <div className="banner" role="note">
          Base Sepolia testnet. Test funds only. App-controlled wallets with provider-protected keys. No real-money value.
        </div>
        <header className="top">
          <Link href="/">
            <strong>P2P USDC</strong>
          </Link>
          {user ? (
            <nav>
              <Link href="/">Home</Link>
              <Link href="/wallet">Wallet</Link>
              <span className="muted">@{user.username}</span>
              <form action={logoutAction}>
                <button className="link" type="submit">
                  Log out
                </button>
              </form>
            </nav>
          ) : (
            <nav>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Sign up</Link>
            </nav>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
