"use server";

import { z } from "@rental/validation";
import { check, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

/** Tenants may reply to reviews; they can never change customer review text (RLS + trigger). */
export async function replyReviewAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "reviews.reply", async (ctx) => {
    check(await (await userClient()).from("review_replies").upsert({
      review_id: str(fd, "reviewId")!, tenant_id: ctx.tenantId, body: z.string().min(1).max(2000).parse(str(fd, "body")), author_id: ctx.userId,
    }, { onConflict: "review_id" }));
  });
}
