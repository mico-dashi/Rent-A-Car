"use server";

import { hostname as hostnameSchema, z } from "@rental/validation";
import { check, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

export async function saveContentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "branding.manage", async (ctx) => {
    const faqQ = fd.getAll("faq_q").map(String), faqA = fd.getAll("faq_a").map(String);
    const faq = faqQ.map((q, i) => ({ q: q.trim(), a: (faqA[i] ?? "").trim() })).filter((x) => x.q && x.a).slice(0, 30);
    const social = Object.fromEntries(["instagram", "facebook", "tiktok", "x", "youtube", "linkedin"].map((k) => [k, str(fd, `social_${k}`)]).filter(([, v]) => v && /^https:\/\//.test(v as string)));
    check(await (await userClient()).from("tenant_branding").update({
      headline: str(fd, "headline"), subheadline: str(fd, "subheadline"), about_md: str(fd, "about_md"), contact_email: str(fd, "contact_email"),
      contact_phone: str(fd, "contact_phone"), contact_address: str(fd, "contact_address"), faq, social_links: social,
    }).eq("tenant_id", ctx.tenantId));
  });
}

export async function saveLegalAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "tenant.manage", async (ctx) => {
    const db = await userClient();
    const { data: cur } = await db.from("tenant_settings").select("legal_terms_md,legal_privacy_md,legal_policy_version").eq("tenant_id", ctx.tenantId).single();
    const terms = str(fd, "terms"), privacy = str(fd, "privacy");
    const changed = terms !== cur?.legal_terms_md || privacy !== cur?.legal_privacy_md;
    check(await db.from("tenant_settings").update({
      legal_terms_md: terms, legal_privacy_md: privacy,
      legal_policy_version: changed ? String(Number(cur?.legal_policy_version ?? "1") + 1) : cur?.legal_policy_version,
    }).eq("tenant_id", ctx.tenantId));
  });
}

export async function addDomainAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "domains.manage", async (ctx) => {
    const host = hostnameSchema.parse(str(fd, "hostname"));
    const root = process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN ?? "";
    if (root && (host === root || host.endsWith(`.${root}`))) throw new Error("VALIDATION_FAILED");
    check(await (await userClient()).from("tenant_domains").insert({ tenant_id: ctx.tenantId, hostname: host }));
  });
}

export async function setPrimaryDomainAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "domains.manage", async (ctx) => {
    const db = await userClient();
    check(await db.from("tenant_domains").update({ is_primary: false }).eq("tenant_id", ctx.tenantId));
    check(await db.from("tenant_domains").update({ is_primary: true }).eq("id", z.string().uuid().parse(str(fd, "domainId"))).eq("tenant_id", ctx.tenantId).eq("status", "VERIFIED"));
  });
}

export async function removeDomainAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "domains.manage", async (ctx) => {
    check(await (await userClient()).from("tenant_domains").delete().eq("id", str(fd, "domainId")!).eq("tenant_id", ctx.tenantId).eq("is_platform_subdomain", false).eq("is_primary", false));
  });
}
