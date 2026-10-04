"use server";

import { z } from "@rental/validation";
import { bool, check, money, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveBranchAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "branches.write", async (ctx) => {
    const hours = Object.fromEntries(DAYS.map((d) => {
      const open = str(fd, `${d}_open`), close = str(fd, `${d}_close`);
      return [d, open && close && fd.get(`${d}_closed`) !== "on" ? [{ open, close }] : []];
    }));
    const tz = z.string().min(3).parse(str(fd, "timezone"));
    if (!Intl.supportedValuesOf("timeZone").includes(tz) && tz !== "UTC") throw new Error("INVALID_TIMEZONE");
    const row = {
      tenant_id: ctx.tenantId, name: z.string().min(2).max(80).parse(str(fd, "name")), address_line1: z.string().min(3).parse(str(fd, "address_line1")),
      address_line2: str(fd, "address_line2"), city: z.string().min(2).parse(str(fd, "city")), region: str(fd, "region"), postal_code: str(fd, "postal_code"),
      country_code: z.string().regex(/^[A-Z]{2}$/).parse(str(fd, "country_code")?.toUpperCase()), latitude: num(fd, "latitude"), longitude: num(fd, "longitude"),
      phone: str(fd, "phone"), email: str(fd, "email"), timezone: tz, opening_hours: hours, pickup_instructions: str(fd, "pickup_instructions"),
      airport_code: str(fd, "airport_code")?.toUpperCase() ?? null, is_active: bool(fd, "is_active"),
    };
    const id = str(fd, "branchId");
    const db = await userClient();
    check(id ? await db.from("branches").update(row).eq("id", id).eq("tenant_id", ctx.tenantId) : await db.from("branches").insert(row));
  });
}

export async function saveOneWayAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "pricing.manage", async (ctx) => {
    const from = str(fd, "from")!, to = str(fd, "to")!;
    if (from === to) throw new Error("VALIDATION_FAILED");
    check(await (await userClient()).from("one_way_fees").upsert({
      tenant_id: ctx.tenantId, from_branch_id: from, to_branch_id: to, fee_minor: money(fd, "fee") ?? 0, allowed: fd.get("allowed") !== "off",
    }, { onConflict: "tenant_id,from_branch_id,to_branch_id" }));
  });
}
