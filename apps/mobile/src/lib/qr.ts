/** Extract the vehicle token from a fleet QR code (`…/t/<slug>/scan/<token>`) or a bare token. */
export function tokenFromQr(data: string): string | null {
  const m = /\/scan\/([A-Za-z0-9_-]{8,})\/?$/.exec(data.trim());
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{8,}$/.test(data.trim()) ? data.trim() : null;
}
