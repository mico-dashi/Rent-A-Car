import { describe, expect, it } from "vitest";
import { depositCaptureAmount, needsReauthorization, planDeposit } from "../src/deposits";
import { platformFee } from "../src";

const h = 3_600_000;
const now = new Date("2026-10-01T00:00:00Z");

describe("deposits", () => {
  it("does nothing when no deposit is required", () => {
    expect(planDeposit(0, now, now, now, 24).strategy).toBe("NOT_REQUIRED");
  });
  it("authorises immediately for imminent short rentals", () => {
    const p = planDeposit(100_000, new Date(now.getTime() + 12 * h), new Date(now.getTime() + 60 * h), now, 24);
    expect(p.strategy).toBe("AUTHORIZE_NOW");
  });
  it("saves the method and schedules authorisation for later pickups", () => {
    const pickup = new Date(now.getTime() + 20 * 24 * h);
    const p = planDeposit(100_000, pickup, new Date(pickup.getTime() + 48 * h), now, 24);
    expect(p).toEqual({ strategy: "SAVE_METHOD_AND_AUTHORIZE_LATER", authorizeAfter: new Date(pickup.getTime() - 24 * h) });
  });
  it("flags long rentals for re-authorisation", () => {
    expect(needsReauthorization(now, new Date(now.getTime() + 10 * 24 * h))).toBe(true);
    expect(needsReauthorization(now, new Date(now.getTime() + 3 * 24 * h))).toBe(false);
  });
  it("never captures more than authorised", () => {
    expect(depositCaptureAmount(100_000, [30_000, 90_000])).toBe(100_000);
    expect(() => depositCaptureAmount(100_000, [-1])).toThrow();
  });
});

describe("platform commission", () => {
  it("supports none, percentage, fixed and custom terms", () => {
    expect(platformFee(100_000, { kind: "NONE", bps: 500, fixedMinor: 100 })).toBe(0);
    expect(platformFee(100_000, { kind: "PERCENTAGE", bps: 250, fixedMinor: 0 })).toBe(2500);
    expect(platformFee(100_000, { kind: "FIXED", bps: 0, fixedMinor: 199 })).toBe(199);
    expect(platformFee(100_000, { kind: "CUSTOM", bps: 100, fixedMinor: 50 })).toBe(1050);
    expect(platformFee(100, { kind: "FIXED", bps: 0, fixedMinor: 500 })).toBe(100);
  });
});
