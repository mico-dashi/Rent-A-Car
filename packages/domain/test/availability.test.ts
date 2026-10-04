import { describe, expect, it } from "vitest";
import { conflictsFor, isVehicleFree, occupancyRange, overlaps, utilization, type OccupancyBlock } from "../src/availability";

const d = (s: string) => new Date(s);
const block = (o: Partial<OccupancyBlock>): OccupancyBlock => ({
  id: "b", vehicleId: "v1", kind: "BOOKING", period: { start: d("2026-10-10T10:00:00Z"), end: d("2026-10-12T11:00:00Z") },
  holdExpiresAt: null, releasedAt: null, ...o,
});
const now = d("2026-10-01T00:00:00Z");

describe("availability", () => {
  it("adds the buffer after the rental", () => {
    const r = occupancyRange(d("2026-10-10T10:00:00Z"), d("2026-10-12T10:00:00Z"), 60);
    expect(r.end.toISOString()).toBe("2026-10-12T11:00:00.000Z");
  });
  it("treats ranges as half-open", () => {
    expect(overlaps({ start: d("2026-01-01T00:00:00Z"), end: d("2026-01-02T00:00:00Z") },
                    { start: d("2026-01-02T00:00:00Z"), end: d("2026-01-03T00:00:00Z") })).toBe(false);
  });
  it("blocks overlaps including the buffer", () => {
    const blocks = [block({})];
    expect(isVehicleFree("v1", { start: d("2026-10-12T10:30:00Z"), end: d("2026-10-13T10:00:00Z") }, blocks, now)).toBe(false);
    expect(isVehicleFree("v1", { start: d("2026-10-12T11:00:00Z"), end: d("2026-10-13T10:00:00Z") }, blocks, now)).toBe(true);
    expect(isVehicleFree("v2", { start: d("2026-10-11T00:00:00Z"), end: d("2026-10-11T10:00:00Z") }, blocks, now)).toBe(true);
  });
  it("ignores released blocks and expired holds", () => {
    const range = { start: d("2026-10-11T00:00:00Z"), end: d("2026-10-11T10:00:00Z") };
    expect(isVehicleFree("v1", range, [block({ releasedAt: now })], now)).toBe(true);
    expect(isVehicleFree("v1", range, [block({ holdExpiresAt: d("2026-09-30T00:00:00Z") })], now)).toBe(true);
    expect(conflictsFor("v1", range, [block({ kind: "MAINTENANCE" })], now)).toHaveLength(1);
  });
  it("computes utilization with overlapping blocks merged", () => {
    const window = { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-11T00:00:00Z") };
    const blocks = [
      block({ period: { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-06T00:00:00Z") } }),
      block({ id: "b2", kind: "MAINTENANCE", period: { start: d("2026-10-05T00:00:00Z"), end: d("2026-10-06T00:00:00Z") } }),
    ];
    expect(utilization(["v1", "v2"], window, blocks, now)).toBeCloseTo(0.25);
  });
});
