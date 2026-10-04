import type { Metadata } from "next";
import { getTenant } from "@/lib/tenant";
import { getLanguage } from "@/lib/i18n";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const tenant = await getTenant();
  const lang = await getLanguage(tenant.language);
  const { next } = await searchParams;
  // Only allow same-site relative redirects.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account/bookings";
  return (
    <div className="container-page flex justify-center pt-16">
      <SignInForm lang={lang} next={safeNext} />
    </div>
  );
}
