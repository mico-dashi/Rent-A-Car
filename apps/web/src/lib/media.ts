/**
 * Resolve a stored media path to a URL. Public marketing media lives in the
 * `vehicle-media` / `tenant-branding` buckets; demo seed data points at local
 * original SVG placeholders (no third-party photography is bundled).
 */
export function mediaUrl(path: string | null | undefined, bucket: "vehicle-media" | "tenant-branding" = "vehicle-media"): string | null {
  if (!path) return null;
  if (path.startsWith("demo/")) return `/placeholders/vehicles/${path.slice(5)}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Supabase image transformation for list thumbnails (never load originals in lists). */
export function thumbnailUrl(path: string | null | undefined, width = 640): string | null {
  const url = mediaUrl(path);
  if (!url || url.startsWith("/")) return url;
  return url.replace("/object/public/", "/render/image/public/") + `?width=${width}&quality=70&resize=contain`;
}
