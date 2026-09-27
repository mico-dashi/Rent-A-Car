"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Never render the error message or stack: details are in server logs (digest correlates them).
  return (
    <div role="alert" className="container-page flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="font-display text-3xl font-black">Something went wrong</h1>
      <p className="mt-2 text-muted">Please try again. If the problem persists, contact us.</p>
      <button type="button" onClick={reset} className="btn-primary mt-8">Try again</button>
    </div>
  );
}
