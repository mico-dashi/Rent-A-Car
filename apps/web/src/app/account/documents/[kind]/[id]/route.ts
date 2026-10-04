import { NextResponse } from "next/server";
import { signedDocumentUrl } from "@rental/server";
import { getTenant } from "@/lib/tenant";
import { serviceClient, userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Customer download of their agreement or invoice. The row is read with the
 * customer's own session (RLS decides ownership); only then is a short-lived
 * signed URL minted server-side.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || (kind !== "agreement" && kind !== "invoice")) return new NextResponse(null, { status: 404 });
  const tenant = await getTenant();
  const db = await userClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });
  const { data } = kind === "agreement"
    ? await db.from("rental_agreements").select("tenant_id,pdf_path").eq("id", id).maybeSingle()
    : await db.from("invoices").select("tenant_id,pdf_path").eq("id", id).maybeSingle();
  const row = data as { tenant_id: string; pdf_path: string | null } | null;
  const path = row?.pdf_path;
  if (!row || row.tenant_id !== tenant.id || !path) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(await signedDocumentUrl(serviceClient(), path, 60), 303);
}
