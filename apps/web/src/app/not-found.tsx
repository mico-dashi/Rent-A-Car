import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 font-display text-3xl font-black">Page not found</h1>
      <p className="mt-2 text-muted">The page or rental company you are looking for does not exist.</p>
      <Link href="/" className="btn-primary mt-8">Home</Link>
    </div>
  );
}
