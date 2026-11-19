'use client';

import { useFormStatus } from 'react-dom';

/** A submit button that disables itself while its form action is running (prevents double submits). */
export function SubmitButton({ children, className, pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (pendingText ?? 'Working…') : children}
    </button>
  );
}
