import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h1>Page not found</h1>
      <p className="muted">That page does not exist, or the link is out of date.</p>
      <Link className="btn btn-primary" href="/">Go Home</Link>
    </div>
  );
}
