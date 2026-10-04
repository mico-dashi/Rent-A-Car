"use server";

import { ROLE_KEYS, PERMISSIONS } from "@rental/types";
import { z } from "@rental/validation";
import { check, str, tenantAction, type ActionResult } from "@/lib/actions";
import { serviceClient, userClient } from "@/lib/supabase/server";

export async function inviteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "staff.manage", async (ctx) => {
    const email = z.string().email().parse(str(fd, "email")?.toLowerCase());
    const role = z.enum(ROLE_KEYS).parse(str(fd, "role"));
    const branches = fd.getAll("branches").map(String);
    const res = check(await (await userClient()).rpc("invite_staff", { p_tenant: ctx.tenantId, p_email: email, p_role: role, p_branch_ids: branches })) as unknown as { membership_id: string; token: string };
    const base = process.env.NEXT_PUBLIC_ADMIN_URL ?? "";
    const inviteUrl = `${base}/invite/${res.token}`;
    // Queue the invitation email (dispatcher renders the tenant/platform template).
    await serviceClient().from("notifications").insert({
      tenant_id: ctx.tenantId, recipient_address: email, event: "staff.invited", channel: "EMAIL", data: { inviteUrl, tenant: ctx.name }, dedupe_key: `invite:${res.membership_id}:${res.token.slice(0, 8)}`,
    });
    return { ok: true, message: inviteUrl };
  });
}

export async function updateMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "staff.manage", async (ctx) => {
    const id = str(fd, "membershipId")!;
    const db = await userClient();
    // Role & branch changes go through RLS + the rank guard trigger.
    check(await db.from("memberships").update({ role: z.enum(ROLE_KEYS).parse(str(fd, "role")), branch_ids: fd.getAll("branches").map(String) }).eq("id", id).eq("tenant_id", ctx.tenantId));
    const overrides = PERMISSIONS.map((p) => ({ p, v: str(fd, `perm_${p}`) })).filter((x) => x.v === "grant" || x.v === "revoke");
    check(await db.from("membership_permission_overrides").delete().eq("membership_id", id));
    if (overrides.length) check(await db.from("membership_permission_overrides").insert(overrides.map((o) => ({ membership_id: id, tenant_id: ctx.tenantId, permission: o.p, granted: o.v === "grant" }))));
  });
}

export async function setMemberStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "staff.manage", async () => {
    check(await (await userClient()).rpc("set_membership_status", { p_membership: str(fd, "membershipId"), p_status: z.enum(["ACTIVE", "SUSPENDED"]).parse(str(fd, "status")) }));
  });
}

export async function revokeInviteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "staff.manage", async (ctx) => {
    check(await (await userClient()).from("memberships").delete().eq("id", str(fd, "membershipId")!).eq("tenant_id", ctx.tenantId).is("user_id", null));
  });
}
