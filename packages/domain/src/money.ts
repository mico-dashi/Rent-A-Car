/**
 * Integer money arithmetic. All amounts are integer minor units (e.g. cents).
 * Multiplications by rates go through BigInt so no floating point is ever
 * involved in a monetary result.
 */

export class MoneyError extends Error {}

export function assertMinor(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer of minor units, got ${value}`);
  }
  return value;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total = assertMinor(total + assertMinor(v));
  return total;
}

/** Divide with half-away-from-zero rounding, entirely in BigInt. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** amount * bps / 10_000 (basis points; 2500 = 25%). */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  assertMinor(bps, "bps");
  return Number(divRound(BigInt(amountMinor) * BigInt(bps), 10_000n));
}

/** amount * numerator / denominator with rounding. */
export function mulDiv(amountMinor: number, numerator: number, denominator: number): number {
  assertMinor(amountMinor);
  if (denominator === 0) throw new MoneyError("division by zero");
  return Number(divRound(BigInt(amountMinor) * BigInt(numerator), BigInt(denominator)));
}

/** Multiply by an integer quantity. */
export function times(amountMinor: number, quantity: number): number {
  assertMinor(quantity, "quantity");
  return assertMinor(amountMinor * quantity);
}

/**
 * Split `amount` into `parts` integer shares that sum exactly to `amount`
 * (largest-remainder; earlier parts receive the extra units).
 */
export function allocateEvenly(amountMinor: number, parts: number): number[] {
  assertMinor(amountMinor);
  if (!Number.isInteger(parts) || parts <= 0) throw new MoneyError("parts must be a positive integer");
  const base = Math.trunc(amountMinor / parts);
  let remainder = amountMinor - base * parts;
  const step = remainder >= 0 ? 1 : -1;
  return Array.from({ length: parts }, () => {
    if (remainder !== 0) {
      remainder -= step;
      return base + step;
    }
    return base;
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Portion of a tax-inclusive amount that is tax: gross - gross / (1 + rate). */
export function includedTax(grossMinor: number, rateBps: number): number {
  assertMinor(grossMinor);
  const net = divRound(BigInt(grossMinor) * 10_000n, BigInt(10_000 + rateBps));
  return grossMinor - Number(net);
}
