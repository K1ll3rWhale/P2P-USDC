import { SkeletonHero, SkeletonLines } from './components/Skeleton';

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <SkeletonHero />
      <div className="card">
        <SkeletonLines count={4} />
      </div>
    </div>
  );
}
