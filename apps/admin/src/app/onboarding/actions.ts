"use server";

import { redirect } from "next/navigation";
import { tenantOnboardingStep1 } from "@rental/validation";
import { failure, str, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

export async function createBusinessAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let slug: string | null = null;
  try {
    await requireUser();
    const input = tenantOnboardingStep1.parse({
      displayName: str(fd, "displayName"), legalName: str(fd, "legalName"), slug: str(fd, "slug")?.toLowerCase(), countryCode: str(fd, "countryCode")?.toUpperCase(),
      currency: str(fd, "currency"), language: str(fd, "language"), timezone: str(fd, "timezone"),
    });
    const { error } = await (await userClient()).rpc("create_tenant", {
      p_slug: input.slug, p_display_name: input.displayName, p_legal_name: input.legalName, p_country: input.countryCode, p_currency: input.currency, p_language: input.language, p_timezone: input.timezone,
    });
    if (error) throw error;
    slug = input.slug;
  } catch (e) {
    return failure(e);
  }
  redirect(`/t/${slug}/onboarding?step=2`);
}
