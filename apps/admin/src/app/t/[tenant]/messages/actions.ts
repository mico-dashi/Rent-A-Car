"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "@rental/validation";
import { check, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

async function attachments(fd: FormData, tenantId: string, threadId: string): Promise<string[]> {
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 4);
  const db = await userClient();
  const paths: string[] = [];
  for (const f of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type) || f.size > 10 * 1024 * 1024) throw new Error("VALIDATION_FAILED");
    const p = `${tenantId}/${threadId}/${randomUUID()}.${f.type.split("/")[1]!.replace("jpeg", "jpg")}`;
    const up = await db.storage.from("message-attachments").upload(p, new Uint8Array(await f.arrayBuffer()), { contentType: f.type });
    if (up.error) throw new Error(up.error.message);
    paths.push(p);
  }
  return paths;
}

export async function replyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "messages.write", async (ctx) => {
    const threadId = str(fd, "threadId")!;
    const body = str(fd, "body");
    const paths = await attachments(fd, ctx.tenantId, threadId);
    if (!body && !paths.length) throw new Error("VALIDATION_FAILED");
    check(await (await userClient()).from("messages").insert({ tenant_id: ctx.tenantId, thread_id: threadId, sender_user_id: ctx.userId, sender_kind: "STAFF", body: body ? z.string().max(5000).parse(body) : null, attachment_paths: paths }));
    return { ok: true };
  });
}

export async function newThreadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const res = await tenantAction(fd, "messages.write", async (ctx) => {
    const db = await userClient();
    const t = check(await db.from("message_threads").insert({
      tenant_id: ctx.tenantId, customer_id: str(fd, "customerId")!, booking_id: str(fd, "bookingId"), subject: z.string().min(2).max(160).parse(str(fd, "subject")),
      kind: str(fd, "bookingId") ? "BOOKING" : z.enum(["GENERAL", "SUPPORT"]).parse(str(fd, "kind") ?? "GENERAL"),
    }).select("id").single());
    check(await db.from("messages").insert({ tenant_id: ctx.tenantId, thread_id: t!.id, sender_user_id: ctx.userId, sender_kind: "STAFF", body: z.string().min(1).max(5000).parse(str(fd, "body")) }));
    id = t!.id;
  });
  if (res?.ok && id) redirect(`/t/${fd.get("_tenant")}/messages/${id}`);
  return res;
}

export async function closeThreadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "messages.write", async (ctx) => {
    check(await (await userClient()).from("message_threads").update({ status: str(fd, "status") === "OPEN" ? "OPEN" : "CLOSED" }).eq("id", str(fd, "threadId")!).eq("tenant_id", ctx.tenantId));
  });
}
