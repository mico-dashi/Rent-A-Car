"use server";

import { randomUUID } from "node:crypto";
import { z } from "@rental/validation";
import { check, money, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

export async function addExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "expenses.manage", async (ctx) => {
    const db = await userClient();
    let receipt: string | null = null;
    const f = fd.get("receipt");
    if (f instanceof File && f.size > 0) {
      if (!["application/pdf", "image/jpeg", "image/png"].includes(f.type) || f.size > 10 * 1024 * 1024) throw new Error("VALIDATION_FAILED");
      receipt = `${ctx.tenantId}/expenses/${randomUUID()}.${f.type === "application/pdf" ? "pdf" : f.type.split("/")[1]!.replace("jpeg", "jpg")}`;
      const up = await db.storage.from("vehicle-documents").upload(receipt, new Uint8Array(await f.arrayBuffer()), { contentType: f.type });
      if (up.error) throw new Error(up.error.message);
    }
    check(await db.from("expenses").insert({
      tenant_id: ctx.tenantId, vehicle_id: str(fd, "vehicleId"), branch_id: str(fd, "branchId"),
      category: z.enum(["MAINTENANCE", "REPAIR", "INSURANCE", "REGISTRATION", "CLEANING", "FUEL", "PARKING", "TOLL", "OTHER"]).parse(str(fd, "category")),
      description: z.string().min(2).max(300).parse(str(fd, "description")), amount_minor: z.number().int().min(0).parse(money(fd, "amount")),
      tax_minor: money(fd, "tax") ?? 0, currency: ctx.currency, incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "incurred_on")),
      vendor: str(fd, "vendor"), external_ref: str(fd, "external_ref"), receipt_path: receipt, created_by: ctx.userId,
    }));
  });
}
