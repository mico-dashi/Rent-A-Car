import { describe, expect, it } from "vitest";
import { MemoryRateLimiter, UpstashRateLimiter, rateLimiterFromEnv } from "./rate-limit";

describe("MemoryRateLimiter", () => {
  it("allows up to the limit per sliding window, then recovers", async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rl.hit("k", 3, 1000));
    expect(results).toEqual([true, true, true, false]);
    expect(await rl.hit("other", 3, 1000)).toBe(true);
    now = 1001;
    expect(await rl.hit("k", 3, 1000)).toBe(true);
  });
});

describe("UpstashRateLimiter", () => {
  function fakeRedis() {
    const counts = new Map<string, number>();
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const cmds = JSON.parse(init.body) as string[][];
      calls.push({ url, headers: init.headers, body: cmds });
      const key = cmds[0]![1]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { ok: true, status: 200, json: async () => [{ result: counts.get(key) }, { result: 1 }] };
    };
    return { counts, calls, fetchImpl };
  }

  it("counts in Redis with one INCR+PEXPIRE pipeline per hit, shared across instances", async () => {
    const redis = fakeRedis();
    const now = () => 5_000;
    const a = new UpstashRateLimiter("https://r.example/", "tok", undefined, redis.fetchImpl, now);
    const b = new UpstashRateLimiter("https://r.example", "tok", undefined, redis.fetchImpl, now);
    expect([await a.hit("ip:1", 2, 60_000), await b.hit("ip:1", 2, 60_000), await a.hit("ip:1", 2, 60_000)]).toEqual([true, true, false]);
    expect(redis.calls[0]).toMatchObject({ url: "https://r.example/pipeline", headers: { authorization: "Bearer tok" }, body: [["INCR", "rl:ip:1:0"], ["PEXPIRE", "rl:ip:1:0", "60000"]] });
  });

  it("falls back to the in-memory limiter when Redis fails, never blocking because of the outage", async () => {
    const down = async () => { throw new Error("ECONNREFUSED"); };
    const rl = new UpstashRateLimiter("https://r.example", "tok", new MemoryRateLimiter(() => 0), down, () => 0);
    expect([await rl.hit("k", 2, 1000), await rl.hit("k", 2, 1000), await rl.hit("k", 2, 1000)]).toEqual([true, true, false]);
    const bad = async () => ({ ok: false, status: 500, json: async () => ({}) });
    expect(await new UpstashRateLimiter("https://r.example", "tok", new MemoryRateLimiter(), bad).hit("k", 1, 1000)).toBe(true);
  });

  it("is selected only when both URL and token are configured", () => {
    expect(rateLimiterFromEnv({})).toBeInstanceOf(MemoryRateLimiter);
    expect(rateLimiterFromEnv({ RATE_LIMIT_REDIS_URL: "https://r.example" })).toBeInstanceOf(MemoryRateLimiter);
    expect(rateLimiterFromEnv({ RATE_LIMIT_REDIS_URL: "https://r.example", RATE_LIMIT_REDIS_TOKEN: "t" })).toBeInstanceOf(UpstashRateLimiter);
  });
});
