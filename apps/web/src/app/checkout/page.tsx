import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCatalogVehicle, listBranches, listExtras } from "@rental/api-client";
import { getTenant } from "@/lib/tenant";
import { getLanguage } from "@/lib/i18n";
import { publicClient, userClient } from "@/lib/supabase/server";
import { CheckoutForm, type ExtraItem } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

type SP = { vehicle?: string; pickup?: string; return?: string; start?: string; end?: string };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<SP> }) {
  const tenant = await getTenant();
  const lang = await getLanguage(tenant.language);
  const sp = await searchParams;
  if (!sp.vehicle || !sp.pickup || !sp.start || !sp.end) notFound();

  const { data: auth } = await (await userClient()).auth.getUser();
  if (!auth.user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/checkout?${new URLSearchParams(sp as Record<string, string>)}`)}`);
  }

  const db = publicClient();
  const [vehicle, branches, extras] = await Promise.all([getCatalogVehicle(db, tenant.id, sp.vehicle), listBranches(db, tenant.id), listExtras(db, tenant.id)]);
  if (!vehicle) notFound();
  const pickup = branches.find((b) => b.id === sp.pickup);
  const ret = branches.find((b) => b.id === (sp.return ?? sp.pickup));
  if (!pickup || !ret) notFound();

  return (
    <div className="container-page pt-10">
      <CheckoutForm
        lang={lang}
        tenantId={tenant.id}
        vehicle={{ id: vehicle.id, name: `${vehicle.make} ${vehicle.model}`, minAge: vehicle.minimum_driver_age }}
        pickup={{ id: pickup.id, name: pickup.name, timezone: pickup.timezone }}
        ret={{ id: ret.id, name: ret.name }}
        startsAt={sp.start}
        endsAt={sp.end}
        extras={(extras as Record<string, unknown>[]).map((e): ExtraItem => ({
          id: e.id as string, name: e.name as string, description: (e.description as string | null) ?? null, kind: e.kind as "EXTRA" | "INSURANCE",
          billing: e.billing as string, priceMinor: Number(e.price_minor), maxQuantity: Number(e.max_quantity),
        }))}
        currency={tenant.currency}
        stripePublishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
      />
    </div>
  );
}
