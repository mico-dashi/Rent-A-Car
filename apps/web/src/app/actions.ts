"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { transitionBooking } from "@rental/api-client";
import { userClient } from "@/lib/supabase/server";

export async function setLanguage(form: FormData) {
  const lang = form.get("lang");
  if (lang !== "en" && lang !== "sq") return;
  (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}

/** Customer cancellation. Authorization, cutoff and fees are enforced in `transition_booking`. */
export async function cancelBooking(form: FormData): Promise<{ ok: boolean; code?: string; feeMinor?: number }> {
  const bookingId = String(form.get("bookingId") ?? "");
  const version = Number(form.get("version"));
  try {
    const res = await transitionBooking(await userClient(), bookingId, "CANCELLED", "CUSTOMER_REQUEST", Number.isFinite(version) ? version : undefined);
    revalidatePath("/account/bookings");
    return { ok: true, feeMinor: res.cancellation_fee_minor };
  } catch (e) {
    return { ok: false, code: e instanceof Error ? e.message : "INTERNAL_ERROR" };
  }
}
