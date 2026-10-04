import "server-only";
import { publicClient } from "./supabase/server";

/** Tenant legal documents are configured by the tenant; the platform provides no legal text of its own. */
export async function tenantLegalText(tenantId: string, kind: "terms" | "privacy"): Promise<{ body: string | null; version: string }> {
  const { data } = await publicClient().rpc("tenant_legal_documents", { p_tenant: tenantId });
  const row = (data ?? {}) as { terms?: string | null; privacy?: string | null; version?: string };
  return { body: row[kind] ?? null, version: row.version ?? "1" };
}
