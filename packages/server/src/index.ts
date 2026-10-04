/**
 * Trusted server-side services shared by the storefront (apps/web) and the
 * dashboard (apps/admin). Every function here expects a SERVICE-ROLE client
 * and must only be called after the caller's authorization was checked.
 * Never import this package from client components or the mobile app.
 */
export * from "./pricing-context";
export * from "./booking-service";
export * from "./payments";
export * from "./payments-ops";
export * from "./staff-bookings";
export * from "./documents";
export * from "./dispatch";
export * from "./domains";
export * from "./jobs";
export * from "./rate-limit";
