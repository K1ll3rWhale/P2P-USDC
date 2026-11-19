'use client';

// Route-level error boundary. Renders inside the root layout, so the testnet banner stays visible.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card" role="alert">
      <h1>Something went wrong</h1>
      <p className="muted">
        This page could not load. Your funds are not affected: balances and transfers are always read from the chain.
        Try again, and check <code>npm run demo:status</code> if it keeps happening.
      </p>
      <button type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
