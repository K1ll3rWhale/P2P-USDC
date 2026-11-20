/** Loading placeholders (decorative; the wrapper announces "Loading"). */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </>
  );
}
export function SkeletonHero() {
  return <div className="skeleton skeleton-hero" />;
}
