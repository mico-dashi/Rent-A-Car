import { createHash } from "node:crypto";
import type { SupabaseClient } from "@rental/auth";
import { formatDateTime, formatMoney, priceLineLabel, translate } from "@rental/localization";
import { BusinessError, type CurrencyCode, type LanguageCode } from "@rental/types";
import { PdfWriter } from "./pdf";

type Row = Record<string, unknown>;

/** Stable JSON (sorted keys) so the same agreement content always hashes identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Row).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Row)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

async function one(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  if (!data) throw new BusinessError("NOT_FOUND", 404);
  return data as Row;
}

export interface AgreementSnapshot {
  version: number;
  language: LanguageCode;
  company: { legalName: string; displayName: string; country: string; email: string | null; phone: string | null; address: string | null };
  customer: { name: string; email: string; phone: string | null; dateOfBirth: string | null; address: string | null };
  driver: { licenseNumber: string | null; issuingCountry: string | null; expiresOn: string | null };
  vehicle: { make: string; model: string; year: number; plate: string; vin: string | null; category: string };
  rental: { reference: string; startsAt: string; endsAt: string; pickupBranch: string; returnBranch: string; timezone: string };
  pricing: { currency: CurrencyCode; lines: { label: string; amountMinor: number }[]; totalMinor: number; depositMinor: number };
  rules: { includedKm: number | null; extraKmRateMinor: number; fuelPolicy: string; freeCancellationHours: number; lateCancellationFeeBps: number; minDriverAge: number };
  terms: string;
}

async function uploadPdf(db: SupabaseClient, path: string, bytes: Uint8Array) {
  const { error } = await db.storage.from("documents").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`storage: ${error.message}`);
}

/** Build the immutable content snapshot for a booking's rental agreement. */
export async function buildAgreementSnapshot(db: SupabaseClient, bookingId: string): Promise<AgreementSnapshot> {
  const b = await one(db.from("bookings").select("*").eq("id", bookingId).single());
  if (!b.vehicle_id) throw new BusinessError("VEHICLE_NOT_ASSIGNED");
  const [t, s, br, c, v, pickup, ret, lic, lines, tpl] = await Promise.all([
    one(db.from("tenants").select("legal_name,display_name,country_code,default_language").eq("id", b.tenant_id).single()),
    one(db.from("tenant_settings").select("fuel_policy,free_cancellation_hours,late_cancellation_fee_bps,legal_terms_md,timezone").eq("tenant_id", b.tenant_id).single()),
    one(db.from("tenant_branding").select("contact_email,contact_phone,contact_address").eq("tenant_id", b.tenant_id).single()),
    one(db.from("customers").select("*").eq("id", b.customer_id).single()),
    one(db.from("vehicles").select("make,model,year,registration_plate,vin,category,extra_km_rate_minor,minimum_driver_age").eq("id", b.vehicle_id).single()),
    one(db.from("branches").select("name,timezone").eq("id", b.pickup_branch_id).single()),
    one(db.from("branches").select("name").eq("id", b.return_branch_id).single()),
    db.from("driver_licenses").select("license_number,issuing_country,expires_on").eq("customer_id", b.customer_id).order("expires_on", { ascending: false }).limit(1).maybeSingle(),
    db.from("booking_price_lines").select("label,label_params,amount_minor,kind,quantity").eq("booking_id", bookingId).order("sort_order"),
    db.from("agreement_templates").select("version,body_md,language").eq("tenant_id", b.tenant_id).eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const lang = ((c.preferred_language ?? t.default_language) === "sq" ? "sq" : "en") as LanguageCode;
  const license = lic.data as Row | null;
  return {
    version: Number((tpl.data as Row | null)?.version ?? 1),
    language: lang,
    company: { legalName: t.legal_name as string, displayName: t.display_name as string, country: t.country_code as string,
      email: (br.contact_email as string | null) ?? null, phone: (br.contact_phone as string | null) ?? null, address: (br.contact_address as string | null) ?? null },
    customer: { name: `${c.first_name} ${c.last_name}`, email: c.email as string, phone: (c.phone as string | null) ?? null,
      dateOfBirth: (c.date_of_birth as string | null) ?? null, address: [c.address_line1, c.city, c.country_code].filter(Boolean).join(", ") || null },
    driver: { licenseNumber: (license?.license_number as string) ?? null, issuingCountry: (license?.issuing_country as string) ?? null, expiresOn: (license?.expires_on as string) ?? null },
    vehicle: { make: v.make as string, model: v.model as string, year: Number(v.year), plate: v.registration_plate as string, vin: (v.vin as string | null) ?? null, category: v.category as string },
    rental: { reference: b.reference as string, startsAt: b.starts_at as string, endsAt: b.ends_at as string, pickupBranch: pickup.name as string, returnBranch: ret.name as string, timezone: pickup.timezone as string },
    pricing: {
      currency: b.currency as CurrencyCode,
      lines: ((lines.data ?? []) as Row[]).map((l) => ({ label: labelFor(l, lang), amountMinor: Number(l.amount_minor) })),
      totalMinor: Number(b.total_minor), depositMinor: Number(b.deposit_minor),
    },
    rules: { includedKm: b.included_km === null ? null : Number(b.included_km), extraKmRateMinor: Number(v.extra_km_rate_minor), fuelPolicy: s.fuel_policy as string,
      freeCancellationHours: Number(s.free_cancellation_hours), lateCancellationFeeBps: Number(s.late_cancellation_fee_bps), minDriverAge: Number(v.minimum_driver_age) },
    terms: ((tpl.data as Row | null)?.body_md as string | undefined) ?? (s.legal_terms_md as string | null) ?? "",
  };
}

function labelFor(l: Row, lang: LanguageCode): string {
  return priceLineLabel(lang, l.label as string, (l.label_params ?? {}) as Record<string, string | number>, Number(l.quantity));
}

export async function renderAgreementPdf(snap: AgreementSnapshot, hash: string, signatures: { role: string; name: string; signedAt: string; png: Uint8Array }[] = []) {
  const L = snap.language;
  const tr = (k: string) => translate(L, `documents.${k}`);
  const m = (v: number) => formatMoney(v, snap.pricing.currency, L);
  const when = (iso: string) => formatDateTime(iso, snap.rental.timezone, L, "medium");
  const w = await PdfWriter.create();
  w.text(snap.company.displayName, { size: 18, bold: true });
  w.text(`${snap.company.legalName} · ${snap.company.country}${snap.company.address ? ` · ${snap.company.address}` : ""}`, { size: 9, color: [0.4, 0.4, 0.4] });
  w.text(`${tr("agreementTitle")} — ${snap.rental.reference}`, { size: 14, bold: true, gap: 8 });
  w.heading(tr("customer"));
  w.text(`${snap.customer.name} · ${snap.customer.email}${snap.customer.phone ? ` · ${snap.customer.phone}` : ""}`);
  if (snap.customer.dateOfBirth) w.text(`${tr("dateOfBirth")}: ${snap.customer.dateOfBirth}`);
  if (snap.customer.address) w.text(snap.customer.address);
  w.text(`${tr("license")}: ${snap.driver.licenseNumber ?? "—"} (${snap.driver.issuingCountry ?? "—"}), ${tr("expires")} ${snap.driver.expiresOn ?? "—"}`);
  w.heading(tr("vehicle"));
  w.text(`${snap.vehicle.make} ${snap.vehicle.model} (${snap.vehicle.year}) · ${tr("plate")} ${snap.vehicle.plate}${snap.vehicle.vin ? ` · VIN ${snap.vehicle.vin}` : ""}`);
  w.heading(tr("rentalPeriod"));
  w.row(`${tr("pickup")}: ${snap.rental.pickupBranch}`, when(snap.rental.startsAt));
  w.row(`${tr("return")}: ${snap.rental.returnBranch}`, when(snap.rental.endsAt));
  w.heading(tr("charges"));
  for (const l of snap.pricing.lines) w.row(l.label, m(l.amountMinor));
  w.rule();
  w.row(tr("total"), m(snap.pricing.totalMinor), { bold: true });
  w.row(tr("deposit"), m(snap.pricing.depositMinor));
  w.heading(tr("rules"));
  w.text(`${tr("mileage")}: ${snap.rules.includedKm === null ? tr("unlimited") : `${snap.rules.includedKm} km; ${tr("extraKm")} ${m(snap.rules.extraKmRateMinor)}/km`}`);
  w.text(`${tr("fuel")}: ${tr(`fuelPolicy.${snap.rules.fuelPolicy}`)}`);
  w.text(`${tr("cancellation")}: ${snap.rules.freeCancellationHours}h / ${snap.rules.lateCancellationFeeBps / 100}%`);
  w.text(`${tr("minAge")}: ${snap.rules.minDriverAge}`);
  if (snap.terms) { w.heading(tr("terms")); w.text(snap.terms, { size: 9 }); }
  w.heading(tr("signatures"));
  if (signatures.length === 0) w.text(tr("unsigned"), { color: [0.5, 0.5, 0.5] });
  for (const s of signatures) await w.image(s.png, `${s.role === "CUSTOMER" ? tr("customer") : tr("staff")}: ${s.name} — ${when(s.signedAt)} UTC ${s.signedAt}`);
  w.text(`${tr("integrity")}: SHA-256 ${hash}`, { size: 7, color: [0.5, 0.5, 0.5] });
  return w.bytes();
}

/** Generate (or regenerate) the agreement for a booking. Voids any previous unsigned version. */
export async function generateAgreement(db: SupabaseClient, bookingId: string) {
  const snap = await buildAgreementSnapshot(db, bookingId);
  const hash = sha256(canonicalJson(snap));
  const b = await one(db.from("bookings").select("tenant_id").eq("id", bookingId).single());
  const { data: current } = await db.from("rental_agreements").select("*").eq("booking_id", bookingId).neq("status", "VOID").maybeSingle();
  if (current && current.content_sha256 === hash) return current as Row;
  if (current && current.status === "FULLY_SIGNED") throw new BusinessError("BOOKING_NOT_MODIFIABLE");
  if (current) await db.from("rental_agreements").update({ status: "VOID" }).eq("id", current.id);
  const path = `${b.tenant_id}/agreements/${bookingId}/${hash.slice(0, 16)}.pdf`;
  await uploadPdf(db, path, await renderAgreementPdf(snap, hash));
  return one(db.from("rental_agreements").insert({
    tenant_id: b.tenant_id, booking_id: bookingId, template_version: snap.version, content_snapshot: snap, content_sha256: hash, pdf_path: path,
  }).select("*").single());
}

function pngFromDataUrl(dataUrl: string): Uint8Array {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new BusinessError("VALIDATION_FAILED", 422);
  const bytes = Buffer.from(m[1]!, "base64");
  if (bytes.length < 100 || bytes.length > 500_000) throw new BusinessError("VALIDATION_FAILED", 422);
  return new Uint8Array(bytes);
}

/**
 * Record a signature bound to the agreement's content hash, with timestamp,
 * IP and user agent. Customer signatures also create a consent record. When
 * both parties have signed, the final PDF with embedded signatures is written.
 */
export async function signAgreement(db: SupabaseClient, input: {
  agreementId: string; role: "CUSTOMER" | "EMPLOYEE"; signerName: string; signerUserId: string | null; pngDataUrl: string; ip: string | null; userAgent: string | null;
}) {
  const a = await one(db.from("rental_agreements").select("*").eq("id", input.agreementId).single());
  if (a.status === "VOID" || a.status === "FULLY_SIGNED") throw new BusinessError("BOOKING_NOT_MODIFIABLE");
  const png = pngFromDataUrl(input.pngDataUrl);
  const path = `${a.tenant_id}/signatures/${a.id}/${input.role.toLowerCase()}-${Date.now()}.png`;
  const { error: upErr } = await db.storage.from("documents").upload(path, png, { contentType: "image/png" });
  if (upErr) throw new Error(`storage: ${upErr.message}`);
  const { error } = await db.from("signatures").insert({
    tenant_id: a.tenant_id, agreement_id: a.id, signer_role: input.role, signer_name: input.signerName.slice(0, 120), signer_user_id: input.signerUserId,
    image_path: path, signed_content_sha256: a.content_sha256, ip_address: input.ip, user_agent: input.userAgent?.slice(0, 300) ?? null,
  });
  if (error) throw new Error(error.message);
  if (input.role === "CUSTOMER") {
    const b = await one(db.from("bookings").select("customer_id").eq("id", a.booking_id).single());
    const c = await one(db.from("customers").select("user_id").eq("id", b.customer_id).single());
    await db.from("consent_records").insert({
      tenant_id: a.tenant_id, user_id: c.user_id, customer_id: b.customer_id, consent_type: "RENTAL_AGREEMENT",
      policy_version: `${a.template_version}:${(a.content_sha256 as string).slice(0, 12)}`, granted: true, context: { agreementId: a.id },
      ip_address: input.ip, user_agent: input.userAgent?.slice(0, 300) ?? null,
    });
  }
  const updated = await one(db.from("rental_agreements").select("*").eq("id", a.id).single());
  if (updated.status === "FULLY_SIGNED") {
    const { data: sigs } = await db.from("signatures").select("signer_role,signer_name,signed_at,image_path").eq("agreement_id", a.id).order("signed_at");
    const images = await Promise.all(((sigs ?? []) as Row[]).map(async (s) => {
      const { data } = await db.storage.from("documents").download(s.image_path as string);
      return { role: s.signer_role as string, name: s.signer_name as string, signedAt: s.signed_at as string, png: new Uint8Array(await data!.arrayBuffer()) };
    }));
    const finalPath = (a.pdf_path as string).replace(/\.pdf$/, "-signed.pdf");
    await uploadPdf(db, finalPath, await renderAgreementPdf(a.content_snapshot as AgreementSnapshot, a.content_sha256 as string, images));
    await db.from("rental_agreements").update({ pdf_path: finalPath }).eq("id", a.id);
  }
  return updated;
}

/** Issue an invoice/receipt with an immutable line snapshot and a gap-free number. */
export async function issueInvoice(db: SupabaseClient, bookingId: string, kind: "INVOICE" | "RECEIPT" = "INVOICE") {
  const b = await one(db.from("bookings").select("*").eq("id", bookingId).single());
  const { data: existing } = await db.from("invoices").select("*").eq("booking_id", bookingId).eq("kind", kind).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (existing && Number(existing.total_minor) === Number(b.total_minor)) return existing as Row;
  const [t, c, lines, num] = await Promise.all([
    one(db.from("tenants").select("legal_name,display_name,country_code,default_language").eq("id", b.tenant_id).single()),
    one(db.from("customers").select("first_name,last_name,email,address_line1,city,country_code,preferred_language").eq("id", b.customer_id).single()),
    db.from("booking_price_lines").select("kind,label,label_params,quantity,amount_minor").eq("booking_id", bookingId).order("sort_order"),
    db.rpc("next_document_number", { p_tenant: b.tenant_id, p_kind: kind }),
  ]);
  if (num.error) throw new Error(num.error.message);
  const lang = ((c.preferred_language ?? t.default_language) === "sq" ? "sq" : "en") as LanguageCode;
  const snapshot = ((lines.data ?? []) as Row[]).map((l) => ({ kind: l.kind, label: labelFor(l, lang), quantity: Number(l.quantity), amountMinor: Number(l.amount_minor) }));
  const tax = Number(b.tax_minor);
  const total = Number(b.total_minor);
  const cur = b.currency as CurrencyCode;
  const tr = (k: string) => translate(lang, `documents.${k}`);
  const w = await PdfWriter.create();
  w.text(t.display_name as string, { size: 18, bold: true });
  w.text(`${t.legal_name} · ${t.country_code}`, { size: 9, color: [0.4, 0.4, 0.4] });
  w.text(`${tr(kind === "INVOICE" ? "invoice" : "receipt")} ${num.data as string}`, { size: 14, bold: true });
  w.text(`${tr("issued")}: ${new Date().toISOString().slice(0, 10)} · ${tr("booking")} ${b.reference}`, { gap: 8 });
  w.text(`${c.first_name} ${c.last_name} · ${c.email}`);
  if (c.address_line1) w.text([c.address_line1, c.city, c.country_code].filter(Boolean).join(", "));
  w.heading(tr("charges"));
  for (const l of snapshot) w.row(l.label, formatMoney(l.amountMinor, cur, lang));
  w.rule();
  w.row(tr("subtotal"), formatMoney(total - tax, cur, lang));
  w.row(tr("tax"), formatMoney(tax, cur, lang));
  w.row(tr("total"), formatMoney(total, cur, lang), { bold: true });
  w.row(tr("paid"), formatMoney(Number(b.amount_paid_minor) - Number(b.amount_refunded_minor), cur, lang));
  const bytes = await w.bytes();
  const path = `${b.tenant_id}/invoices/${num.data as string}.pdf`;
  await uploadPdf(db, path, bytes);
  return one(db.from("invoices").insert({
    tenant_id: b.tenant_id, booking_id: b.id, customer_id: b.customer_id, number: num.data as string, kind, currency: cur,
    subtotal_minor: total - tax, tax_minor: tax, total_minor: total, lines: snapshot, pdf_path: path,
  }).select("*").single());
}

/** Short-lived signed URL for a private document, after the caller's authorization check. */
export async function signedDocumentUrl(db: SupabaseClient, path: string, seconds = 120): Promise<string> {
  const { data, error } = await db.storage.from("documents").createSignedUrl(path, seconds);
  if (error || !data) throw new Error(error?.message ?? "signed url");
  return data.signedUrl;
}
