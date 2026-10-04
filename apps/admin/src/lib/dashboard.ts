import "server-only";
import type { Db } from "./supabase/server";

export interface Dashboard {
  currency: string;
  today: { bookingsCreated: number; pickups: number; returns: number; activeRentals: number; overdue: number; availableFleet: number; fleetSize: number };
  period: { revenueMinor: number; bookings: number; averageBookingValueMinor: number; averageRentalDays: number; cancellationRate: number; noShowRate: number; utilization: number; maintenanceCostMinor: number; customerReturnRate: number };
  yearToDateRevenueMinor: number;
  series: { day: string; revenueMinor: number; bookings: number }[];
  byVehicle: { vehicleId: string; name: string; plate: string; revenueMinor: number; bookings: number; utilization: number }[];
  byBranch: { branchId: string; name: string; revenueMinor: number; bookings: number }[];
  byCategory: { category: string; revenueMinor: number; bookings: number }[];
}

export function periodFromSearch(sp: { from?: string; to?: string }, tz: string): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = sp.to && iso.test(sp.to) ? sp.to : today;
  const from = sp.from && iso.test(sp.from) ? sp.from : new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
  return from <= to ? { from, to } : { from: to, to: from };
}

export async function loadDashboard(db: Db, tenantId: string, from: string, to: string): Promise<Dashboard> {
  const { data, error } = await db.rpc("tenant_dashboard", { p_tenant: tenantId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data as unknown as Dashboard;
}
