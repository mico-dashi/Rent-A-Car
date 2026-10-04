import type { Pool } from "@rental/testing";

export const RIVAL = {
  owner: "00000000-0000-4000-8000-0000000000b1",
  customerUser: "00000000-0000-4000-8000-0000000000b2",
  tenant: "10000000-0000-4000-8000-0000000000b1",
  branch: "20000000-0000-4000-8000-0000000000b1",
  vehicle: "30000000-0000-4000-8000-0000000000b1",
  customer: "50000000-0000-4000-8000-0000000000b1",
} as const;

/** Second tenant used to prove isolation. Idempotent; runs as the DB owner. */
export async function ensureRivalTenant(pool: Pool): Promise<void> {
  await pool.query(`
    insert into auth.users (id, email) values ('${RIVAL.owner}', 'owner@rival.demo'), ('${RIVAL.customerUser}', 'c@rival.demo')
      on conflict do nothing;
    insert into public.tenants (id, slug, legal_name, display_name, status, country_code, base_currency, default_language, owner_user_id)
      values ('${RIVAL.tenant}', 'rival-cars', 'Rival Cars Ltd', 'Rival Cars', 'ACTIVE', 'GB', 'GBP', 'en', '${RIVAL.owner}')
      on conflict do nothing;
    insert into public.tenant_settings (tenant_id, timezone) values ('${RIVAL.tenant}', 'Europe/London') on conflict do nothing;
    insert into public.tenant_branding (tenant_id) values ('${RIVAL.tenant}') on conflict do nothing;
    insert into public.memberships (tenant_id, user_id, role, status)
      values ('${RIVAL.tenant}', '${RIVAL.owner}', 'TENANT_OWNER', 'ACTIVE') on conflict do nothing;
    insert into public.branches (id, tenant_id, name, address_line1, city, country_code, timezone)
      values ('${RIVAL.branch}', '${RIVAL.tenant}', 'London', '1 High St', 'London', 'GB', 'Europe/London') on conflict do nothing;
    insert into public.vehicles (id, tenant_id, branch_id, fleet_number, registration_plate, make, model, year, category,
      transmission, fuel_type, seats, doors, currency, daily_rate_minor, purchase_price_minor, vin, is_published)
      values ('${RIVAL.vehicle}', '${RIVAL.tenant}', '${RIVAL.branch}', 'R-1', 'RV24 AAA', 'Jaguar', 'F-Type', 2023, 'SPORTS',
              'AUTOMATIC', 'PETROL', 2, 2, 'GBP', 30000, 8000000, 'SAJDA1234567890AB', true) on conflict do nothing;
    insert into public.customers (id, tenant_id, user_id, first_name, last_name, email)
      values ('${RIVAL.customer}', '${RIVAL.tenant}', '${RIVAL.customerUser}', 'Riv', 'Al', 'c@rival.demo') on conflict do nothing;
    insert into public.driver_licenses (tenant_id, customer_id, license_number, issuing_country, expires_on)
      select '${RIVAL.tenant}', '${RIVAL.customer}', 'RIVAL123', 'GB', '2031-01-01'
      where not exists (select 1 from public.driver_licenses where customer_id = '${RIVAL.customer}');
    insert into public.customer_notes (tenant_id, customer_id, body, author_id)
      select '${RIVAL.tenant}', '${RIVAL.customer}', 'VIP', '${RIVAL.owner}'
      where not exists (select 1 from public.customer_notes where customer_id = '${RIVAL.customer}');
    insert into public.pricing_rules (tenant_id, name, kind, amount_minor)
      select '${RIVAL.tenant}', 'Airport', 'AIRPORT_SURCHARGE', 1000
      where not exists (select 1 from public.pricing_rules where tenant_id = '${RIVAL.tenant}');
    insert into public.discount_codes (tenant_id, code, percent_off_bps) values ('${RIVAL.tenant}', 'RIVAL5', 500) on conflict do nothing;
    insert into public.vehicle_documents (tenant_id, vehicle_id, kind, expires_on)
      select '${RIVAL.tenant}', '${RIVAL.vehicle}', 'INSURANCE', '2027-01-01'
      where not exists (select 1 from public.vehicle_documents where tenant_id = '${RIVAL.tenant}');
    insert into public.expenses (tenant_id, vehicle_id, category, description, amount_minor, currency, incurred_on)
      select '${RIVAL.tenant}', '${RIVAL.vehicle}', 'FUEL', 'Fuel', 5000, 'GBP', current_date
      where not exists (select 1 from public.expenses where tenant_id = '${RIVAL.tenant}');
    insert into public.vehicle_damages (tenant_id, vehicle_id, damage_type, description)
      select '${RIVAL.tenant}', '${RIVAL.vehicle}', 'SCRATCH', 'Rear bumper'
      where not exists (select 1 from public.vehicle_damages where tenant_id = '${RIVAL.tenant}');
    insert into public.maintenance_records (tenant_id, vehicle_id, type, scheduled_start, scheduled_end)
      select '${RIVAL.tenant}', '${RIVAL.vehicle}', 'OIL', now() + interval '400 days', now() + interval '400 days 4 hours'
      where not exists (select 1 from public.maintenance_records where tenant_id = '${RIVAL.tenant}');
  `);
  const existing = await pool.query("select 1 from public.bookings where tenant_id = $1", [RIVAL.tenant]);
  if (existing.rowCount === 0) {
    const start = new Date(Date.now() + 300 * 86_400_000);
    const end = new Date(start.getTime() + 2 * 86_400_000);
    const { rows } = await pool.query("select public.create_booking($1::jsonb) r", [JSON.stringify({
      tenant_id: RIVAL.tenant, actor_user_id: RIVAL.customerUser, customer_id: RIVAL.customer, vehicle_id: RIVAL.vehicle,
      pickup_branch_id: RIVAL.branch, return_branch_id: RIVAL.branch, starts_at: start.toISOString(), ends_at: end.toISOString(),
      currency: "GBP", rental_minor: 60000, total_minor: 60000, due_now_minor: 60000,
      lines: [{ kind: "BASE", label: "pricing.line.baseDaily", quantity: 2, unit_amount_minor: 30000, amount_minor: 60000 }],
      idempotency_key: "rival-seed",
    })]);
    await pool.query(
      `insert into public.payments (tenant_id, booking_id, customer_id, purpose, provider, amount_minor, currency, idempotency_key)
       values ($1, $2, $3, 'RENTAL', 'stripe', 60000, 'GBP', 'rival-pay')`, [RIVAL.tenant, rows[0].r.id, RIVAL.customer]);
  }
}
