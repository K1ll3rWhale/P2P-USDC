import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { logoutAction } from './actions';
import { NavTabs } from './components/NavTabs';
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
          <strong>Base Sepolia testnet.</strong> Test funds only. App-controlled wallets with provider-protected keys. No real-money value.
        </div>
        <header className="topbar">
          <div className="topbar-inner">
            <div className="topbar-row">
              <Link href="/" className="brand">
                P2P <span>USDC</span>
              </Link>
              {user ? (
                <div className="userbox">
                  <span className="username">@{user.username}</span>
                  <form action={logoutAction}>
                    <button className="link" type="submit">
                      Log out
                    </button>
                  </form>
                </div>
              ) : (
                <nav className="authnav" aria-label="Account">
                  <Link href="/login">Log in</Link>
                  <Link href="/signup">Sign up</Link>
                </nav>
              )}
            </div>
            {user && <NavTabs />}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
