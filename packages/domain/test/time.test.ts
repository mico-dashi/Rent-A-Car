import { describe, expect, it } from "vitest";
import { ageOn, billableDays, utcToZonedLocal, zonedLocalToUtc } from "../src/time";

describe("timezones", () => {
  it("converts branch wall-clock time to UTC", () => {
    expect(zonedLocalToUtc("2026-10-06T10:00", "Europe/Tirane").toISOString()).toBe("2026-10-06T08:00:00.000Z"); // CEST
    expect(zonedLocalToUtc("2026-12-06T10:00", "Europe/Tirane").toISOString()).toBe("2026-12-06T09:00:00.000Z"); // CET
    expect(zonedLocalToUtc("2026-07-01T09:30", "America/New_York").toISOString()).toBe("2026-07-01T13:30:00.000Z");
  });
  it("handles the spring-forward gap and fall-back overlap", () => {
    // 2027-03-28 02:30 does not exist in Europe/Tirane -> 03:30 CEST (01:30Z)
    expect(zonedLocalToUtc("2027-03-28T02:30", "Europe/Tirane").toISOString()).toBe("2027-03-28T01:30:00.000Z");
    // 2026-10-25 02:30 happens twice -> earlier (CEST, 00:30Z)
    expect(zonedLocalToUtc("2026-10-25T02:30", "Europe/Tirane").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("round-trips", () => {
    const t = zonedLocalToUtc("2026-11-15T18:45", "Asia/Tokyo");
    expect(utcToZonedLocal(t, "Asia/Tokyo")).toBe("2026-11-15T18:45");
  });
  it("counts an overnight rental across DST as the right number of days", () => {
    const start = zonedLocalToUtc("2026-10-24T10:00", "Europe/Tirane");
    const end = zonedLocalToUtc("2026-10-26T10:00", "Europe/Tirane"); // 49 real hours
    expect(billableDays({ start, end }, 59, "Europe/Tirane")).toBe(2);
    // Spring forward: 47 real hours is still 2 days
    const s2 = zonedLocalToUtc("2027-03-27T10:00", "Europe/Tirane");
    const e2 = zonedLocalToUtc("2027-03-29T10:00", "Europe/Tirane");
    expect(billableDays({ start: s2, end: e2 }, 0, "Europe/Tirane")).toBe(2);
  });
  it("computes age", () => {
    expect(ageOn("2001-10-10", new Date("2026-10-09T00:00:00Z"))).toBe(24);
    expect(ageOn("2001-10-10", new Date("2026-10-10T00:00:00Z"))).toBe(25);
  });
});
