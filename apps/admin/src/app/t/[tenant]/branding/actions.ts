"use server";

import { randomUUID } from "node:crypto";
import { brandingSchema, z } from "@rental/validation";
import { bool, check, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@rental/database";

const FONTS = ["Inter", "Manrope", "Poppins", "Montserrat", "Playfair Display", "Space Grotesk", "DM Sans", "Sora"];

export async function saveBrandAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "branding.manage", async (ctx) => {
    const b = brandingSchema.pick({ primaryColor: true, secondaryColor: true, backgroundColor: true }).parse({
      primaryColor: str(fd, "primary"), secondaryColor: str(fd, "secondary"), backgroundColor: str(fd, "background"),
    });
    check(await (await userClient()).from("tenant_branding").update({
      primary_color: b.primaryColor.toUpperCase(), secondary_color: b.secondaryColor.toUpperCase(), background_color: b.backgroundColor.toUpperCase(),
      font_heading: z.enum(FONTS as [string, ...string[]]).parse(str(fd, "font_heading")), font_body: z.enum(FONTS as [string, ...string[]]).parse(str(fd, "font_body")),
      default_theme: z.enum(["dark", "light", "system"]).parse(str(fd, "theme")), email_from_name: str(fd, "email_from_name"), email_footer: str(fd, "email_footer"),
      hide_platform_branding: bool(fd, "hide_platform_branding"),
    }).eq("tenant_id", ctx.tenantId));
  });
}

export async function uploadBrandAssetAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "branding.manage", async (ctx) => {
    const slot = z.enum(["logo_path", "logo_dark_path", "hero_image_path", "app_icon_path", "splash_path"]).parse(str(fd, "slot"));
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("VALIDATION_FAILED");
    const allowed = slot === "hero_image_path" ? ["image/jpeg", "image/webp", "image/png"] : ["image/png", "image/svg+xml", "image/webp", "image/jpeg"];
    if (!allowed.includes(f.type) || f.size > 5 * 1024 * 1024) throw new Error("VALIDATION_FAILED");
    const path = `${ctx.tenantId}/${slot.replace("_path", "")}-${randomUUID()}.${f.type === "image/svg+xml" ? "svg" : f.type.split("/")[1]!.replace("jpeg", "jpg")}`;
    const db = await userClient();
    const up = await db.storage.from("tenant-branding").upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: f.type });
    if (up.error) throw new Error(up.error.message);
    const patch: TablesUpdate<"tenant_branding"> = {};
    patch[slot] = path;
    check(await db.from("tenant_branding").update(patch).eq("tenant_id", ctx.tenantId));
  });
}
