'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/send', label: 'Send' },
  { href: '/friends', label: 'Friends' },
  { href: '/activity', label: 'Activity' },
  { href: '/wallet', label: 'Wallet' },
];

/** `badges` maps a tab href to a count to show next to its label (only when greater than zero). */
export function NavTabs({ badges = {} }: { badges?: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map((t) => {
        const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
        const n = badges[t.href] ?? 0;
        return (
          <Link key={t.href} href={t.href} className="tab" aria-current={active ? 'page' : undefined}>
            {t.label}
            {n > 0 && <span className="badge" aria-label={`${n} new`}>{n > 99 ? '99+' : n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
