import type { MetadataRoute } from "next";
import { listCatalog } from "@rental/api-client";
import { getTenantOrNull } from "@/lib/tenant";
import { publicClient } from "@/lib/supabase/server";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await getTenantOrNull();
  if (!tenant?.primaryHostname) return [];
  const base = `https://${tenant.primaryHostname}`;
  const vehicles = await listCatalog(publicClient(), tenant.id, { limit: 500 });
  const pages = ["", "/fleet", "/about", "/contact", "/faq", "/terms", "/privacy"].map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const }));
  return [...pages, ...vehicles.map((v) => ({ url: `${base}/vehicles/${v.id}`, lastModified: new Date(v.created_at), changeFrequency: "weekly" as const }))];
}
