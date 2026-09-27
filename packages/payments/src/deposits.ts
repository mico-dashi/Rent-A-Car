/**
 * Security-deposit scheduling. Card authorisations expire (Stripe: ~7 days for
 * most cards), so deposits for pickups further out are secured by saving the
 * payment method now and authorising close to pickup via a scheduled job.
 */
export const MAX_AUTHORIZATION_HOLD_HOURS = 6 * 24; // conservative margin under 7 days

export interface DepositPlan {
  strategy: "NOT_REQUIRED" | "AUTHORIZE_NOW" | "SAVE_METHOD_AND_AUTHORIZE_LATER";
  authorizeAfter: Date | null;
}

export function planDeposit(amountMinor: number, pickupAt: Date, rentalEndsAt: Date, now: Date, authorizeHoursBefore: number): DepositPlan {
  if (amountMinor <= 0) return { strategy: "NOT_REQUIRED", authorizeAfter: null };
  const authorizeAt = new Date(pickupAt.getTime() - authorizeHoursBefore * 3_600_000);
  const holdUntil = rentalEndsAt.getTime() + 24 * 3_600_000; // keep through return inspection
  const holdHoursIfNow = (holdUntil - now.getTime()) / 3_600_000;
  if (authorizeAt <= now && holdHoursIfNow <= MAX_AUTHORIZATION_HOLD_HOURS) {
    return { strategy: "AUTHORIZE_NOW", authorizeAfter: now };
  }
  return { strategy: "SAVE_METHOD_AND_AUTHORIZE_LATER", authorizeAfter: authorizeAt > now ? authorizeAt : now };
}

/** Rentals whose hold would outlive a card authorisation need re-authorisation mid-rental. */
export function needsReauthorization(authorizedAt: Date, rentalEndsAt: Date): boolean {
  return (rentalEndsAt.getTime() + 24 * 3_600_000 - authorizedAt.getTime()) / 3_600_000 > MAX_AUTHORIZATION_HOLD_HOURS;
}

/** Deposit captures must be justified by human-approved charges and never exceed the hold. */
export function depositCaptureAmount(authorizedMinor: number, approvedChargesMinor: readonly number[]): number {
  const total = approvedChargesMinor.reduce((a, b) => a + b, 0);
  if (approvedChargesMinor.some((c) => !Number.isSafeInteger(c) || c < 0)) throw new Error("Invalid approved charge");
  return Math.min(total, authorizedMinor);
}
