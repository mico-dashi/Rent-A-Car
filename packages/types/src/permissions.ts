// Permission catalogue. Mirrors public.permissions (migration 0003).
export const PERMISSIONS = [
  "tenant.read", "tenant.manage", "branding.manage", "domains.manage", "billing.manage",
  "branches.read", "branches.write",
  "vehicles.read", "vehicles.write", "vehicles.status",
  "pricing.read", "pricing.manage", "extras.manage",
  "bookings.read", "bookings.write", "bookings.cancel", "bookings.override",
  "payments.read", "payments.charge", "payments.refund", "deposits.manage",
  "customers.read", "customers.write", "customers.restrict", "customers.documents",
  "inspections.perform", "damages.read", "damages.manage",
  "maintenance.read", "maintenance.manage", "expenses.read", "expenses.manage",
  "transfers.manage", "staff.read", "staff.manage", "reports.read",
  "messages.read", "messages.write", "reviews.reply", "notifications.manage",
  "agreements.manage", "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
