import { resolveTxt } from "node:dns/promises";
import type { SupabaseClient } from "@rental/auth";

export interface HostingDomains {
  /** Attach a verified custom domain to the web deployment (issues TLS). */
  addDomain(hostname: string): Promise<void>;
  removeDomain(hostname: string): Promise<void>;
}

/** Vercel project domains API (https://vercel.com/docs/rest-api). */
export class VercelDomains implements HostingDomains {
  constructor(private token: string, private projectId: string, private teamId?: string) {}
  private url(path: string) {
    return `https://api.vercel.com${path}${this.teamId ? `?teamId=${this.teamId}` : ""}`;
  }
  async addDomain(hostname: string) {
    const res = await fetch(this.url(`/v10/projects/${this.projectId}/domains`), {
      method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: hostname }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`Vercel ${res.status}`);
  }
  async removeDomain(hostname: string) {
    const res = await fetch(this.url(`/v9/projects/${this.projectId}/domains/${hostname}`), { method: "DELETE", headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok && res.status !== 404) throw new Error(`Vercel ${res.status}`);
  }
}

export type TxtLookup = (name: string) => Promise<string[][]>;

/**
 * Verify pending custom domains by TXT record `_rental-verify.<host>` = token.
 * Verified domains are attached to hosting (when configured) before being
 * marked VERIFIED, so a domain never resolves to a tenant without TLS.
 */
export async function verifyPendingDomains(db: SupabaseClient, hosting: HostingDomains | null, lookup: TxtLookup = resolveTxt, limit = 50) {
  const { data } = await db.from("tenant_domains").select("id,hostname,verification_token,created_at").eq("status", "PENDING_VERIFICATION").limit(limit);
  let verified = 0, pending = 0, failed = 0;
  for (const d of (data ?? []) as Record<string, string>[]) {
    let records: string[] = [];
    try { records = (await lookup(`_rental-verify.${d.hostname}`)).map((r) => r.join("")); } catch { /* NXDOMAIN / not yet propagated */ }
    const ok = records.includes(d.verification_token!);
    if (ok) {
      try {
        if (hosting) await hosting.addDomain(d.hostname!);
        await db.from("tenant_domains").update({ status: "VERIFIED", verified_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }).eq("id", d.id);
        verified++;
      } catch {
        failed++;
      }
    } else {
      const ageDays = (Date.now() - Date.parse(d.created_at!)) / 86_400_000;
      await db.from("tenant_domains").update({ last_checked_at: new Date().toISOString(), ...(ageDays > 14 ? { status: "FAILED" } : {}) }).eq("id", d.id);
      if (ageDays > 14) failed++; else pending++;
    }
  }
  return { verified, pending, failed };
}
