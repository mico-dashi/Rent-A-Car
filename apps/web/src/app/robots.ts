import type { MetadataRoute } from "next";
import { getTenantOrNull } from "@/lib/tenant";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await getTenantOrNull();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/account/", "/checkout", "/sign-in", "/search"] }],
    ...(tenant?.primaryHostname ? { sitemap: `https://${tenant.primaryHostname}/sitemap.xml` } : {}),
  };
}
