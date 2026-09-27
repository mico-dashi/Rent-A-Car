import { NextResponse } from "next/server";
import { signedDocumentUrl } from "@rental/server";
import { getTenantContext } from "@/lib/session";
import { serviceClient } from "@/lib/supabase/server";

/**
 * Private-document download: authorizes the staff member for the tenant and
 * document type, then redirects to a 2-minute signed URL. Paths are always
 * `<tenant_id>/...`, so a tenant can never reach another tenant's files.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const bucket = new URL(req.url).searchParams.get("bucket") ?? "documents";
  const needed = bucket === "customer-documents" ? "customers.documents" : bucket === "inspection-photos" ? "inspections.perform" : bucket === "vehicle-documents" ? "vehicles.read" : "bookings.read";
  const allowed = ctx.permissions.has(needed) || (bucket === "inspection-photos" && ctx.permissions.has("damages.read"));
  if (!allowed || !path.startsWith(`${ctx.tenantId}/`) || path.includes("..")) return new NextResponse("Forbidden", { status: 403 });
  const db = serviceClient();
  if (bucket === "documents") return NextResponse.redirect(await signedDocumentUrl(db, path));
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 120);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
