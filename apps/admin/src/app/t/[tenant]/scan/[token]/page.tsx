import { notFound, redirect } from "next/navigation";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

/** QR landing: resolves the vehicle's token (only for staff of its tenant) and opens the vehicle. */
export default async function Scan({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const ctx = await getTenantContext(tenant);
  requirePermission(ctx, "vehicles.read");
  const { data } = await (await userClient()).rpc("vehicle_by_qr", { p_token: token });
  const hit = data as { id: string; tenantId: string } | null;
  if (!hit || hit.tenantId !== ctx.tenantId) notFound();
  redirect(`/t/${ctx.slug}/fleet/${hit.id}`);
}
