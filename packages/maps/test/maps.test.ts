import { describe, expect, it } from "vitest";
import { deliveryFee, haversineKm, nearest } from "../src";

describe("maps", () => {
  it("computes great-circle distance", () => {
    // Tirana centre -> TIA airport ≈ 13.9 km
    expect(haversineKm({ lat: 41.3275, lng: 19.8189 }, { lat: 41.4147, lng: 19.7206 })).toBeCloseTo(12.6, 0);
  });
  it("orders nearest branches and skips ones without coordinates", () => {
    const r = nearest({ lat: 41.33, lng: 19.82 }, [
      { id: "air", latitude: 41.4147, longitude: 19.7206 }, { id: "city", latitude: 41.3275, longitude: 19.8189 }, { id: "x", latitude: null, longitude: null },
    ]);
    expect(r.map((b) => b.id)).toEqual(["city", "air"]);
  });
  it("prices delivery by zone or distance", () => {
    const zones = { mode: "FLAT_ZONES" as const, zones: [{ maxKm: 10, feeMinor: 2000 }, { maxKm: 25, feeMinor: 3500 }] };
    expect(deliveryFee(9.2, zones)).toBe(2000);
    expect(deliveryFee(10.1, zones)).toBe(3500);
    expect(deliveryFee(40, zones)).toBeNull();
    expect(deliveryFee(12.3, { mode: "PER_KM", baseFeeMinor: 1000, perKmMinor: 150, maxKm: 50 })).toBe(2950);
  });
});
