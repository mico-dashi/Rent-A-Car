"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "@rental/validation";
import { bool, check, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

function customerFields(fd: FormData) {
  return z.object({
    first_name: z.string().min(1).max(80), last_name: z.string().min(1).max(80), email: z.string().email(), phone: z.string().max(40).nullable(),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), address_line1: z.string().max(160).nullable(), city: z.string().max(80).nullable(),
    postal_code: z.string().max(20).nullable(), country_code: z.string().regex(/^[A-Z]{2}$/).nullable(), nationality: z.string().regex(/^[A-Z]{2}$/).nullable(),
    preferred_language: z.enum(["en", "sq"]).nullable(), emergency_contact_name: z.string().max(80).nullable(), emergency_contact_phone: z.string().max(40).nullable(),
    marketing_opt_in: z.boolean(),
  }).parse({
    first_name: str(fd, "first_name"), last_name: str(fd, "last_name"), email: str(fd, "email")?.toLowerCase(), phone: str(fd, "phone"),
    date_of_birth: str(fd, "date_of_birth"), address_line1: str(fd, "address_line1"), city: str(fd, "city"), postal_code: str(fd, "postal_code"),
    country_code: str(fd, "country_code")?.toUpperCase() ?? null, nationality: str(fd, "nationality")?.toUpperCase() ?? null,
    preferred_language: str(fd, "preferred_language"), emergency_contact_name: str(fd, "emergency_contact_name"),
    emergency_contact_phone: str(fd, "emergency_contact_phone"), marketing_opt_in: bool(fd, "marketing_opt_in"),
  });
}

export async function createCustomerAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const res = await tenantAction(fd, "customers.write", async (ctx) => {
    const row = check(await (await userClient()).from("customers").insert({ ...customerFields(fd), tenant_id: ctx.tenantId }).select("id").single());
    id = row!.id;
  });
  if (res?.ok && id) redirect(`/t/${fd.get("_tenant")}/customers/${id}`);
  return res;
}

export async function updateCustomerAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "customers.write", async (ctx) => {
    check(await (await userClient()).from("customers").update(customerFields(fd)).eq("id", str(fd, "customerId")!).eq("tenant_id", ctx.tenantId));
  });
}

/** Restrictions are append-only with reason + actor (the DB flips customers.is_restricted). */
export async function restrictAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "customers.restrict", async (ctx) => {
    check(await (await userClient()).from("customer_restrictions").insert({
      tenant_id: ctx.tenantId, customer_id: str(fd, "customerId")!, action: z.enum(["RESTRICT", "BLACKLIST", "LIFT"]).parse(str(fd, "action")),
      reason: z.string().min(3).max(1000).parse(str(fd, "reason")), actor_id: ctx.userId,
    }));
  });
}

export async function addCustomerNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "customers.write", async (ctx) => {
    check(await (await userClient()).from("customer_notes").insert({ tenant_id: ctx.tenantId, customer_id: str(fd, "customerId")!, body: z.string().min(1).max(4000).parse(str(fd, "body")), author_id: ctx.userId }));
    return { ok: true };
  });
}

export async function addLicenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "customers.documents", async (ctx) => {
    const customerId = str(fd, "customerId")!;
    const db = await userClient();
    const upload = async (key: string) => {
      const f = fd.get(key);
      if (!(f instanceof File) || f.size === 0) return null;
      if (!["image/jpeg", "image/png", "image/heic", "application/pdf"].includes(f.type) || f.size > 10 * 1024 * 1024) throw new Error("VALIDATION_FAILED");
      const path = `${ctx.tenantId}/${customerId}/${key}-${randomUUID()}.${f.type === "application/pdf" ? "pdf" : f.type.split("/")[1]!.replace("jpeg", "jpg")}`;
      const up = await db.storage.from("customer-documents").upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: f.type });
      if (up.error) throw new Error(up.error.message);
      return path;
    };
    check(await db.from("driver_licenses").insert({
      tenant_id: ctx.tenantId, customer_id: customerId, license_number: z.string().min(3).max(40).parse(str(fd, "license_number")),
      issuing_country: z.string().regex(/^[A-Z]{2}$/).parse(str(fd, "issuing_country")?.toUpperCase()), issued_on: str(fd, "issued_on"),
      expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "expires_on")), front_image_path: await upload("front"), back_image_path: await upload("back"),
      verification_status: fd.get("verified") === "on" ? "VERIFIED" : "PENDING", ...(fd.get("verified") === "on" ? { verified_by: ctx.userId, verified_at: new Date().toISOString() } : {}),
    }));
  });
}

export async function setDocumentStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "customers.documents", async (ctx) => {
    const table = str(fd, "table") === "customer_documents" ? "customer_documents" : "driver_licenses";
    const status = z.enum(["VERIFIED", "REJECTED"]).parse(str(fd, "status"));
    check(await (await userClient()).from(table).update({ verification_status: status, verified_by: ctx.userId, verified_at: new Date().toISOString() })
      .eq("id", str(fd, "documentId")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function setIdentityAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "customers.documents", async (ctx) => {
    const status = z.enum(["VERIFIED", "REJECTED", "PENDING"]).parse(str(fd, "status"));
    check(await (await userClient()).from("customers").update({
      identity_status: status, identity_provider: "manual", identity_verified_at: status === "VERIFIED" ? new Date().toISOString() : null,
    }).eq("id", str(fd, "customerId")!).eq("tenant_id", ctx.tenantId));
  });
}
