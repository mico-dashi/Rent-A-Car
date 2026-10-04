"use server";

import { EXTRA_BILLINGS } from "@rental/types";
import { z } from "@rental/validation";
import { bool, check, money, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

export async function saveExtraAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "extras.manage", async (ctx) => {
    const billing = z.enum(EXTRA_BILLINGS).parse(str(fd, "billing"));
    const row = {
      tenant_id: ctx.tenantId, code: z.string().regex(/^[a-z0-9_]+$/).parse(str(fd, "code")?.toLowerCase()), name: z.string().min(1).max(80).parse(str(fd, "name")),
      description: str(fd, "description"), kind: z.enum(["EXTRA", "INSURANCE"]).parse(str(fd, "kind")), billing,
      price_minor: billing === "FREE" ? 0 : (money(fd, "price") ?? 0), max_price_minor: money(fd, "max_price"), max_quantity: num(fd, "max_quantity") ?? 1,
      deposit_reduction_bps: Math.round((num(fd, "deposit_reduction") ?? 0) * 100), is_active: bool(fd, "is_active"), sort_order: num(fd, "sort_order") ?? 0,
    };
    const id = str(fd, "extraId");
    const db = await userClient();
    check(id ? await db.from("extras").update(row).eq("id", id).eq("tenant_id", ctx.tenantId) : await db.from("extras").insert(row));
  });
}
