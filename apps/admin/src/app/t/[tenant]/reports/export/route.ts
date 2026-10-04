import { NextResponse } from "next/server";
import { loadDashboard, periodFromSearch } from "@/lib/dashboard";
import { getTenantContext } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

/** CSV exports (RFC 4180, formula-injection safe). Data is read through RLS as the caller. */
function csv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
const major = (m: number | null) => (m === null ? null : (Number(m) / 100).toFixed(2));

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const needed = kind === "expenses" ? "expenses.read" : kind === "payments" ? "payments.read" : "reports.read";
  if (!ctx.permissions.has(needed)) return new NextResponse("Forbidden", { status: 403 });
  const period = periodFromSearch({ from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }, ctx.timezone);
  const db = await userClient();
  let rows: (string | number | null)[][] = [];
  if (kind === "bookings") {
    const { data } = await db.from("bookings").select("reference,status,starts_at,ends_at,currency,rental_minor,extras_minor,fees_minor,discount_minor,tax_minor,total_minor,amount_paid_minor,amount_refunded_minor,payment_status,created_at")
      .eq("tenant_id", ctx.tenantId).gte("starts_at", `${period.from}T00:00:00Z`).lte("starts_at", `${period.to}T23:59:59Z`).order("starts_at").limit(10000);
    rows = [["reference", "status", "starts_at_utc", "ends_at_utc", "currency", "rental", "extras", "fees", "discount", "tax", "total", "paid", "refunded", "payment_status", "created_at_utc"],
      ...(data ?? []).map((b) => [b.reference, b.status, b.starts_at, b.ends_at, b.currency, major(b.rental_minor), major(b.extras_minor), major(b.fees_minor), major(b.discount_minor), major(b.tax_minor), major(b.total_minor), major(b.amount_paid_minor), major(b.amount_refunded_minor), b.payment_status, b.created_at])];
  } else if (kind === "vehicles") {
    const d = await loadDashboard(db, ctx.tenantId, period.from, period.to);
    rows = [["vehicle", "plate", "bookings", "revenue", "utilization"], ...d.byVehicle.map((v) => [v.name, v.plate, v.bookings, major(v.revenueMinor), v.utilization])];
  } else if (kind === "payments") {
    const { data } = await db.from("payments").select("created_at,purpose,provider,provider_payment_id,status,currency,amount_minor,amount_captured_minor,amount_refunded_minor,application_fee_minor")
      .eq("tenant_id", ctx.tenantId).gte("created_at", `${period.from}T00:00:00Z`).lte("created_at", `${period.to}T23:59:59Z`).order("created_at").limit(10000);
    rows = [["created_at_utc", "purpose", "provider", "provider_id", "status", "currency", "amount", "captured", "refunded", "platform_fee"],
      ...(data ?? []).map((p) => [p.created_at, p.purpose, p.provider, p.provider_payment_id, p.status, p.currency, major(p.amount_minor), major(p.amount_captured_minor), major(p.amount_refunded_minor), major(p.application_fee_minor)])];
  } else if (kind === "expenses") {
    const { data } = await db.from("expenses").select("incurred_on,category,description,vendor,currency,amount_minor,tax_minor,external_ref")
      .eq("tenant_id", ctx.tenantId).gte("incurred_on", period.from).lte("incurred_on", period.to).order("incurred_on").limit(10000);
    rows = [["date", "category", "description", "vendor", "currency", "amount", "tax", "external_ref"],
      ...(data ?? []).map((e) => [e.incurred_on, e.category, e.description, e.vendor, e.currency, major(e.amount_minor), major(e.tax_minor), e.external_ref])];
  } else return new NextResponse("Unknown export", { status: 400 });
  return new NextResponse(csv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ctx.slug}-${kind}-${period.from}_${period.to}.csv"`, "cache-control": "no-store" },
  });
}
