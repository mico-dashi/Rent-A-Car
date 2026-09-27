-- =====================================================================
-- 0013 REFERENCE DATA required in every environment
-- (demo tenants live in seed.sql, never in migrations)
-- =====================================================================
insert into public.currencies (code, name, minor_units) values
  ('EUR', 'Euro', 2), ('USD', 'US Dollar', 2), ('GBP', 'Pound Sterling', 2),
  ('ALL', 'Albanian Lek', 2), ('CHF', 'Swiss Franc', 2)
on conflict (code) do nothing;

insert into public.languages (code, name) values ('en', 'English'), ('sq', 'Shqip')
on conflict (code) do nothing;

insert into public.subscription_plans (key, name, monthly_price_minor, annual_price_minor, currency,
  max_vehicles, max_branches, max_staff, features, trial_days, sort_order) values
  ('starter', 'Starter', 4900, 49000, 'EUR', 15, 1, 3,
   '{"custom_domain":false,"advanced_analytics":false,"api_access":false,"sms":false,"dedicated_app":false,"dynamic_pricing":false,"white_label_removal":false}', 14, 1),
  ('professional', 'Professional', 14900, 149000, 'EUR', 60, 3, 15,
   '{"custom_domain":true,"advanced_analytics":true,"api_access":false,"sms":true,"dedicated_app":false,"dynamic_pricing":false,"white_label_removal":false}', 14, 2),
  ('business', 'Business', 39900, 399000, 'EUR', 250, 10, 60,
   '{"custom_domain":true,"advanced_analytics":true,"api_access":true,"sms":true,"dedicated_app":false,"dynamic_pricing":true,"white_label_removal":true}', 14, 3),
  ('enterprise', 'Enterprise', 0, 0, 'EUR', null, null, null,
   '{"custom_domain":true,"advanced_analytics":true,"api_access":true,"sms":true,"dedicated_app":true,"dynamic_pricing":true,"white_label_removal":true}', 30, 4)
on conflict (key) do nothing;
update public.subscription_plans set is_public = false where key = 'enterprise';

insert into public.feature_flags (key, tenant_id, enabled) values
  ('ai_damage_assist', null, false),
  ('location_discovery', null, false),
  ('phone_auth', null, false),
  ('vehicle_delivery', null, true)
on conflict do nothing;

insert into public.notification_templates (tenant_id, event, channel, language, subject, body) values
  (null, 'booking.confirmed', 'EMAIL', 'en', 'Your booking {{reference}} is confirmed',
   'Hi {{firstName}}, your {{vehicle}} is reserved from {{pickupAt}} to {{returnAt}} at {{branch}}.'),
  (null, 'booking.confirmed', 'EMAIL', 'sq', 'Rezervimi juaj {{reference}} është konfirmuar',
   'Përshëndetje {{firstName}}, {{vehicle}} është rezervuar nga {{pickupAt}} deri më {{returnAt}} në {{branch}}.'),
  (null, 'booking.cancelled', 'EMAIL', 'en', 'Booking {{reference}} cancelled', 'Your booking {{reference}} has been cancelled.'),
  (null, 'booking.cancelled', 'EMAIL', 'sq', 'Rezervimi {{reference}} u anulua', 'Rezervimi juaj {{reference}} është anuluar.'),
  (null, 'pickup.reminder', 'PUSH', 'en', 'Pickup tomorrow', 'Your {{vehicle}} is ready at {{branch}} on {{pickupAt}}.'),
  (null, 'pickup.reminder', 'PUSH', 'sq', 'Marrja nesër', '{{vehicle}} ju pret në {{branch}} më {{pickupAt}}.'),
  (null, 'return.reminder', 'PUSH', 'en', 'Return reminder', 'Please return {{vehicle}} to {{branch}} by {{returnAt}}.'),
  (null, 'return.reminder', 'PUSH', 'sq', 'Kujtesë kthimi', 'Ju lutem ktheni {{vehicle}} në {{branch}} deri më {{returnAt}}.'),
  (null, 'payment.failed', 'EMAIL', 'en', 'Payment failed for {{reference}}', 'We could not process your payment. Please update your payment method.'),
  (null, 'payment.failed', 'EMAIL', 'sq', 'Pagesa dështoi për {{reference}}', 'Nuk mundëm ta procesojmë pagesën. Ju lutem përditësoni mënyrën e pagesës.'),
  (null, 'staff.invited', 'EMAIL', 'en', 'You have been invited to {{tenant}}', 'Accept your invitation: {{inviteUrl}}'),
  (null, 'staff.invited', 'EMAIL', 'sq', 'Jeni ftuar në {{tenant}}', 'Pranoni ftesën: {{inviteUrl}}')
on conflict do nothing;
