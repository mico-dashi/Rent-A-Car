import { describe, expect, it } from "vitest";
import { allocateEvenly, applyBps, includedTax, mulDiv, MoneyError, sum } from "../src/money";

describe("money", () => {
  it("applies basis points with half-away-from-zero rounding", () => {
    expect(applyBps(10_000, 2000)).toBe(2000);
    expect(applyBps(333, 5000)).toBe(167); // 166.5 -> 167
    expect(applyBps(-333, 5000)).toBe(-167);
    expect(applyBps(1, 4999)).toBe(0);
  });

  it("never produces floating point results", () => {
    for (let a = 1; a < 2000; a += 37) {
      for (const bps of [1, 333, 1250, 2000, 9999]) {
        expect(Number.isInteger(applyBps(a, bps))).toBe(true);
      }
    }
  });

  it("allocates evenly and exactly", () => {
    expect(allocateEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(sum(allocateEvenly(100_001, 7))).toBe(100_001);
    expect(allocateEvenly(-10, 3)).toEqual([-4, -3, -3]);
  });

  it("rejects non-integer amounts", () => {
    expect(() => sum([1.5])).toThrow(MoneyError);
    expect(() => applyBps(10.1, 100)).toThrow(MoneyError);
  });

  it("computes included tax", () => {
    expect(includedTax(12_000, 2000)).toBe(2000);
    expect(mulDiv(1000, 1, 3)).toBe(333);
  });
});
