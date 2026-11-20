'use client';

// Last-resort boundary (replaces the root layout), so it repeats the testnet banner itself and does not rely on globals.css.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#f5f7fa', color: '#111827' }}>
        <div role="note" style={{ background: '#fff3cd', color: '#5c4300', padding: '6px 16px', textAlign: 'center', fontSize: 12 }}>
          Base Sepolia testnet. Test funds only. App-controlled wallets with provider-protected keys. No real-money value.
        </div>
        <main style={{ maxWidth: 560, margin: '0 auto', padding: 16 }} role="alert">
          <h1>Something went wrong</h1>
          <p>The app hit an unexpected error. Funds are not affected. Please try again.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ background: '#0b6bcb', color: '#fff', border: 0, borderRadius: 10, padding: '12px 18px', font: 'inherit', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
