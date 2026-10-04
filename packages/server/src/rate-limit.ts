/**
 * Request rate limiting shared by every server instance.
 *
 * With RATE_LIMIT_REDIS_URL (+ RATE_LIMIT_REDIS_TOKEN) set, counters live in
 * Redis via the Upstash REST API (fixed window: INCR + PEXPIRE in one
 * pipeline), so limits hold across instances and restarts. Without it, or
 * when Redis is unreachable, an in-process sliding window is used: requests are
 * never blocked by a limiter outage, but limits are then per instance.
 */
export interface RateLimiter {
  /** Count one hit for `key`; returns false when the limit for the window is exceeded. */
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = 50_000) {}
  async hit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const t = this.now();
    const hits = (this.buckets.get(key) ?? []).filter((x) => t - x < windowMs);
    const allowed = hits.length < limit;
    if (allowed) hits.push(t);
    this.buckets.set(key, hits);
    if (this.buckets.size > this.maxKeys) this.buckets.clear();
    return allowed;
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fallback: RateLimiter = new MemoryRateLimiter(),
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 300,
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const window = Math.floor(this.now() / windowMs);
    const redisKey = `rl:${key}:${window}`;
    try {
      const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify([["INCR", redisKey], ["PEXPIRE", redisKey, String(windowMs)]]),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { result?: unknown; error?: string }[];
      const count = Number(body[0]?.result);
      if (!Number.isFinite(count)) throw new Error(body[0]?.error ?? "bad response");
      return count <= limit;
    } catch (e) {
      console.error(JSON.stringify({ level: "warn", where: "rate-limit", message: `redis unavailable, using memory: ${e instanceof Error ? e.message : String(e)}` }));
      return this.fallback.hit(key, limit, windowMs);
    }
  }
}

export function rateLimiterFromEnv(env: { RATE_LIMIT_REDIS_URL?: string | undefined; RATE_LIMIT_REDIS_TOKEN?: string | undefined }): RateLimiter {
  return env.RATE_LIMIT_REDIS_URL && env.RATE_LIMIT_REDIS_TOKEN
    ? new UpstashRateLimiter(env.RATE_LIMIT_REDIS_URL, env.RATE_LIMIT_REDIS_TOKEN)
    : new MemoryRateLimiter();
}
