import { applyBps } from "../money";

export type CommissionKind = "NONE" | "PERCENTAGE" | "FIXED" | "CUSTOM";

export interface CommissionTerms {
  kind: CommissionKind;
  bps: number;
  fixedMinor: number;
}

/**
 * Platform application fee for a booking payment. Terms come from the tenant's
 * subscription (override) or plan — never hard-coded. CUSTOM = percentage + fixed.
 */
export function platformFee(amountMinor: number, terms: CommissionTerms): number {
  let fee: number;
  switch (terms.kind) {
    case "NONE":
      fee = 0;
      break;
    case "PERCENTAGE":
      fee = applyBps(amountMinor, terms.bps);
      break;
    case "FIXED":
      fee = terms.fixedMinor;
      break;
    case "CUSTOM":
      fee = applyBps(amountMinor, terms.bps) + terms.fixedMinor;
      break;
  }
  return Math.min(Math.max(fee, 0), amountMinor);
}
