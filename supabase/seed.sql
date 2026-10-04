-- =====================================================================
-- DEMO SEED — local development / preview environments ONLY.
-- Never run against production. Demo passwords are public knowledge.
-- Tenant: Apex Drive Rentals (Tirana, Albania; EUR)
-- =====================================================================

-- Demo users. On real Supabase auth.users has password columns; the shim does not.
do $$
declare
  u record;
  has_pw boolean := exists (select 1 from information_schema.columns
                            where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password');
begin
  for u in select * from (values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'admin@platform.demo', 'Platform', 'Admin'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'owner@apexdrive.demo', 'Arben', 'Hoxha'),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'staff@apexdrive.demo', 'Elira', 'Krasniqi'),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'customer@example.demo', 'Sam', 'Taylor')
  ) as t(id, email, first_name, last_name) loop
    if has_pw then
      execute $q$
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                                confirmation_token, recovery_token, email_change, email_change_token_new)
        values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
                extensions.crypt('DemoPassw0rd!', extensions.gen_salt('bf')), now(),
                '{"provider":"email","providers":["email"]}', jsonb_build_object('first_name', $3, 'last_name', $4),
                now(), now(), '', '', '', '')
        on conflict (id) do nothing $q$ using u.id, u.email, u.first_name, u.last_name;
    else
      insert into auth.users (id, email, raw_user_meta_data)
      values (u.id, u.email, jsonb_build_object('first_name', u.first_name, 'last_name', u.last_name))
      on conflict (id) do nothing;
    end if;
  end loop;
end $$;

insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-000000000001') on conflict do nothing;
update public.platform_settings set value = '"localhost"' where key = 'root_domain';

-- Tenant
insert into public.tenants (id, slug, legal_name, display_name, status, country_code, base_currency, default_language, owner_user_id, tenant_code)
values ('10000000-0000-4000-8000-000000000001', 'apex-drive', 'Apex Drive Rentals SH.P.K.', 'Apex Drive Rentals', 'ACTIVE',
        'AL', 'EUR', 'en', '00000000-0000-4000-8000-000000000002', 'APEX01');

insert into public.tenant_settings (tenant_id, timezone, reservation_buffer_minutes, min_rental_minutes, min_lead_time_minutes,
  free_cancellation_hours, late_cancellation_fee_bps, payment_timing, onboarding_step, onboarding_completed_at,
  fuel_charge_per_eighth_minor)
values ('10000000-0000-4000-8000-000000000001', 'Europe/Tirane', 60, 1440, 120, 48, 5000, 'FULL_AT_BOOKING', 12, now(), 1500);

insert into public.tenant_branding (tenant_id, headline, subheadline, about_md, contact_email, contact_phone, contact_address,
  email_from_name, faq, social_links)
values ('10000000-0000-4000-8000-000000000001',
  'Drive something extraordinary.',
  'Premium performance and luxury cars in Tirana — city centre or straight from the airport.',
  'Apex Drive Rentals is a demo tenant showcasing the platform.',
  'hello@apexdrive.demo', '+355 69 000 0000', 'Rruga e Kavajës 1, Tirana',
  'Apex Drive Rentals',
  '[{"q":"What do I need to rent?","a":"A valid driving licence held for at least 2 years, a passport or ID, and a credit card for the deposit."},{"q":"Can I return to a different branch?","a":"Yes — a one-way fee applies between City Center and Airport."}]',
  '{"instagram":"https://instagram.com/","facebook":"https://facebook.com/"}');

insert into public.tenant_domains (tenant_id, hostname, is_platform_subdomain, is_primary, status, verified_at) values
  ('10000000-0000-4000-8000-000000000001', 'apex-drive.localhost', true, true, 'VERIFIED', now());

insert into public.tenant_subscriptions (tenant_id, plan_id, status, interval, current_period_start, current_period_end)
select '10000000-0000-4000-8000-000000000001', id, 'ACTIVE', 'MONTHLY', now(), now() + interval '1 month'
from public.subscription_plans where key = 'business';

insert into public.memberships (tenant_id, user_id, role, status) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'TENANT_OWNER', 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'EMPLOYEE', 'ACTIVE');

insert into public.tenant_payment_accounts (tenant_id, provider, test_mode) values ('10000000-0000-4000-8000-000000000001', 'stripe', true);

-- Branches
insert into public.branches (id, tenant_id, name, address_line1, city, country_code, latitude, longitude, phone, email, timezone,
  opening_hours, pickup_instructions, airport_code) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'City Center', 'Rruga e Kavajës 1', 'Tirana', 'AL',
   41.327500, 19.818900, '+355 69 000 0001', 'city@apexdrive.demo', 'Europe/Tirane',
   '{"mon":[{"open":"08:00","close":"20:00"}],"tue":[{"open":"08:00","close":"20:00"}],"wed":[{"open":"08:00","close":"20:00"}],"thu":[{"open":"08:00","close":"20:00"}],"fri":[{"open":"08:00","close":"20:00"}],"sat":[{"open":"09:00","close":"18:00"}],"sun":[]}',
   'Enter the underground garage, level -1, bay A.', null),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Airport', 'Tirana International Airport Nënë Tereza', 'Rinas', 'AL',
   41.414700, 19.720600, '+355 69 000 0002', 'airport@apexdrive.demo', 'Europe/Tirane',
   '{"mon":[{"open":"00:00","close":"24:00"}],"tue":[{"open":"00:00","close":"24:00"}],"wed":[{"open":"00:00","close":"24:00"}],"thu":[{"open":"00:00","close":"24:00"}],"fri":[{"open":"00:00","close":"24:00"}],"sat":[{"open":"00:00","close":"24:00"}],"sun":[{"open":"00:00","close":"24:00"}]}',
   'Meet our host at the arrivals hall, desk 4.', 'TIA');

insert into public.one_way_fees (tenant_id, from_branch_id, to_branch_id, fee_minor) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 3500),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 3500);

-- Vehicles (rates in EUR cents)
insert into public.vehicles (id, tenant_id, branch_id, fleet_number, registration_plate, make, model, trim, year, category,
  exterior_color, interior_color, transmission, fuel_type, drivetrain, seats, doors, luggage, engine, horsepower,
  electric_range_km, odometer_km, fuel_level_eighths, battery_level_pct, currency, daily_rate_minor, weekly_rate_minor,
  deposit_minor, minimum_driver_age, included_km_per_day, extra_km_rate_minor, status, is_published, description) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'APX-001', 'AA 101 AP', 'Porsche', '911', 'Carrera S', 2024, 'SPORTS', 'Guards Red', 'Black', 'AUTOMATIC', 'PETROL', 'RWD',
   4, 2, 2, '3.0L twin-turbo flat-six', 450, null, 8200, 8, null, 'EUR', 69000, 420000, 300000, 25, 250, 250, 'AVAILABLE', true,
   'The benchmark sports car. Precise, fast and surprisingly usable every day.'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'APX-002', 'AA 102 AP', 'Porsche', 'Taycan', '4S', 2024, 'ELECTRIC', 'Frozen Blue', 'Black', 'AUTOMATIC', 'ELECTRIC', 'AWD',
   4, 4, 3, 'Dual motor', 530, 460, 5400, null, 90, 'EUR', 55000, 330000, 250000, 25, 300, 200, 'AVAILABLE', true,
   'All-electric performance with a real-world range for day trips to the coast.'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
   'APX-003', 'AA 103 AP', 'Mercedes-AMG', 'GT', '63 4MATIC+', 2023, 'SPORTS', 'Obsidian Black', 'Red', 'AUTOMATIC', 'PETROL', 'AWD',
   4, 2, 2, '4.0L V8 biturbo', 585, null, 15100, 7, null, 'EUR', 75000, 450000, 350000, 27, 250, 300, 'AVAILABLE', true,
   'Grand touring with V8 thunder.'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'APX-004', 'AA 104 AP', 'BMW', 'M4', 'Competition', 2024, 'SPORTS', 'Isle of Man Green', 'Black', 'AUTOMATIC', 'PETROL', 'RWD',
   4, 2, 2, '3.0L inline-six', 510, null, 9800, 8, null, 'EUR', 42000, 252000, 200000, 23, 250, 200, 'AVAILABLE', true,
   'Motorsport-bred coupé with everyday comfort.'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
   'APX-005', 'AA 105 AP', 'Land Rover', 'Range Rover Sport', 'P530 First Edition', 2024, 'SUV', 'Santorini Black', 'Ivory', 'AUTOMATIC', 'PETROL', 'AWD',
   5, 5, 5, '4.4L V8', 530, null, 12000, 8, null, 'EUR', 38000, 228000, 200000, 23, 300, 150, 'AVAILABLE', true,
   'Refined luxury SUV for families and mountain roads.'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'APX-006', 'AA 106 AP', 'Audi', 'RS6', 'Avant performance', 2024, 'LUXURY', 'Nardo Grey', 'Black', 'AUTOMATIC', 'PETROL', 'AWD',
   5, 5, 5, '4.0L V8 TFSI', 630, null, 7700, 8, null, 'EUR', 48000, 288000, 250000, 25, 300, 200, 'AVAILABLE', true,
   'The super-estate: 630 hp and room for everyone''s luggage.'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
   'APX-007', 'AA 107 AP', 'Tesla', 'Model S', 'Plaid', 2023, 'ELECTRIC', 'Pearl White', 'White', 'AUTOMATIC', 'ELECTRIC', 'AWD',
   5, 4, 4, 'Tri motor', 1020, 600, 21000, null, 85, 'EUR', 32000, 192000, 150000, 23, null, 0, 'AVAILABLE', true,
   'Silent, effortless and absurdly quick. Unlimited kilometres.'),
  ('30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'APX-008', 'AA 108 AP', 'Mercedes-Benz', 'G-Class', 'G 63', 2024, 'FOUR_BY_FOUR', 'Magno Night Black', 'Black', 'AUTOMATIC', 'PETROL', 'FOUR_WD',
   5, 5, 4, '4.0L V8 biturbo', 585, null, 6400, 8, null, 'EUR', 65000, 390000, 400000, 27, 250, 300, 'AVAILABLE', true,
   'An icon that goes anywhere — Albanian Alps included.');

insert into public.vehicle_images (tenant_id, vehicle_id, storage_path, thumbnail_path, width, height, alt_text, sort_order)
select tenant_id, id, 'demo/' || lower(regexp_replace(make || '-' || model, '[^a-zA-Z0-9]+', '-', 'g')) || '.svg',
       'demo/' || lower(regexp_replace(make || '-' || model, '[^a-zA-Z0-9]+', '-', 'g')) || '.svg', 1600, 900,
       make || ' ' || model || ' illustration', 0
from public.vehicles where tenant_id = '10000000-0000-4000-8000-000000000001';

insert into public.vehicle_features (tenant_id, vehicle_id, feature)
select v.tenant_id, v.id, f from public.vehicles v,
  unnest(array['navigation', 'bluetooth', 'apple_carplay', 'android_auto', 'climate_control']) f
where v.tenant_id = '10000000-0000-4000-8000-000000000001';

-- Vehicle class (for class-mode bookings demo)
insert into public.vehicle_classes (id, tenant_id, code, name, category, rank, equivalence_group, daily_rate_minor, deposit_minor)
values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'EV-PREMIUM', 'Premium Electric', 'ELECTRIC', 200, 'performance', 45000, 200000);
insert into public.vehicle_class_members (tenant_id, class_id, vehicle_id) values
  ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000007');

-- Tax & pricing
insert into public.tax_rules (tenant_id, name, rate_bps, is_inclusive, jurisdiction_label, effective_from)
values ('10000000-0000-4000-8000-000000000001', 'VAT', 2000, false, 'Albania', '2020-01-01');

insert into public.pricing_rules (tenant_id, name, kind, condition, adjustment_bps, amount_minor, per, priority, is_dynamic) values
  ('10000000-0000-4000-8000-000000000001', 'Weekend surcharge', 'WEEKEND_SURCHARGE', '{"days":[5,6]}', 1000, null, 'DAY', 10, false),
  ('10000000-0000-4000-8000-000000000001', 'Airport pickup', 'AIRPORT_SURCHARGE', '{}', null, 2500, 'BOOKING', 20, false),
  ('10000000-0000-4000-8000-000000000001', 'Week+ discount', 'DURATION_DISCOUNT', '{"minDays":7}', -1000, null, 'BOOKING', 30, false),
  ('10000000-0000-4000-8000-000000000001', 'Young driver', 'YOUNG_DRIVER_FEE', '{"belowAge":25}', null, 2000, 'DAY', 40, false),
  ('10000000-0000-4000-8000-000000000001', 'Additional driver', 'ADDITIONAL_DRIVER_FEE', '{}', null, 1000, 'DAY', 50, false),
  ('10000000-0000-4000-8000-000000000001', 'Last-minute', 'LEAD_TIME', '{"withinHours":24}', 1000, null, 'BOOKING', 60, true),
  ('10000000-0000-4000-8000-000000000001', 'High demand', 'UTILIZATION', '{"above":0.8}', 1500, null, 'BOOKING', 70, true);

insert into public.seasonal_rates (tenant_id, name, starts_on, ends_on, adjustment_bps, priority) values
  ('10000000-0000-4000-8000-000000000001', 'Summer peak', '2026-07-01', '2026-08-31', 2500, 10),
  ('10000000-0000-4000-8000-000000000001', 'Summer peak', '2027-07-01', '2027-08-31', 2500, 10);

insert into public.discount_codes (tenant_id, code, percent_off_bps, min_rental_days, max_redemptions)
values ('10000000-0000-4000-8000-000000000001', 'WELCOME10', 1000, 2, 500);

insert into public.extras (tenant_id, code, name, description, kind, billing, price_minor, max_price_minor, max_quantity, deposit_reduction_bps, sort_order) values
  ('10000000-0000-4000-8000-000000000001', 'full_cover', 'Full cover insurance', 'Reduces damage excess to zero.', 'INSURANCE', 'PER_DAY', 4500, 31500, 1, 5000, 1),
  ('10000000-0000-4000-8000-000000000001', 'child_seat', 'Child seat', 'ISOFIX, 9–36 kg.', 'EXTRA', 'PER_DAY', 800, 5600, 2, 0, 2),
  ('10000000-0000-4000-8000-000000000001', 'wifi', 'Mobile Wi-Fi', 'Unlimited 4G hotspot.', 'EXTRA', 'PER_DAY', 600, 4200, 1, 0, 3),
  ('10000000-0000-4000-8000-000000000001', 'snow_chains', 'Snow chains', null, 'EXTRA', 'PER_BOOKING', 2500, null, 1, 0, 4),
  ('10000000-0000-4000-8000-000000000001', 'hotel_delivery', 'Hotel delivery', 'Delivery within Tirana.', 'EXTRA', 'PER_BOOKING', 3000, null, 1, 0, 5),
  ('10000000-0000-4000-8000-000000000001', 'gps', 'GPS navigation', 'Built-in on most vehicles.', 'EXTRA', 'FREE', 0, null, 1, 0, 6);

-- Demo customer
insert into public.customers (id, tenant_id, user_id, first_name, last_name, email, phone, date_of_birth, country_code, nationality, preferred_language)
values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004',
        'Sam', 'Taylor', 'customer@example.demo', '+44 7700 900000', '1990-05-14', 'GB', 'GB', 'en');
insert into public.driver_licenses (tenant_id, customer_id, license_number, issuing_country, issued_on, expires_on, verification_status)
values ('10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'TAYLO905140S99AB', 'GB', '2012-06-01', '2032-06-01', 'VERIFIED');

-- Upcoming maintenance on the M4 (blocks availability automatically)
insert into public.maintenance_records (tenant_id, vehicle_id, type, provider, scheduled_start, scheduled_end, notes)
values ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'TIRES', 'Pirelli Center Tirana',
        date_trunc('day', now()) + interval '10 days 08:00', date_trunc('day', now()) + interval '10 days 17:00', 'Seasonal tyre change');
