'use client';

// Last-resort boundary (replaces the root layout), so it repeats the testnet banner itself.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div role="note" style={{ background: '#fff4d6', color: '#5c4300', padding: '8px 16px', textAlign: 'center', fontSize: 14 }}>
          Base Sepolia testnet. Test funds only. App-controlled wallets with provider-protected keys. No real-money value.
        </div>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: 16 }} role="alert">
          <h1>Something went wrong</h1>
          <p>The app hit an unexpected error. Funds are not affected. Please try again.</p>
          <button type="button" onClick={() => reset()}>Try again</button>
        </main>
      </body>
    </html>
  );
}
