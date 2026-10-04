import "server-only";
import { NextResponse } from "next/server";
import { BusinessError, httpStatusFor, isBusinessErrorCode, type BusinessErrorCode } from "@rental/types";
import { toBusinessError } from "@rental/database";
import { AuthorizationError } from "@rental/auth";
import { z } from "@rental/validation";
import { rateLimiterFromEnv, type RateLimiter } from "@rental/server";
import { serverEnv } from "./env";

export function jsonError(code: BusinessErrorCode, status = httpStatusFor(code), details?: unknown) {
  return NextResponse.json({ error: { code, ...(details ? { details } : {}) } }, { status, headers: { "cache-control": "no-store" } });
}

/** Map any thrown error to a safe response. Internal details are logged, never returned. */
export function handleRouteError(e: unknown, requestId: string) {
  if (e instanceof z.ZodError) return jsonError("VALIDATION_FAILED", 422, e.issues.map((i: z.ZodIssue) => ({ path: i.path, message: i.message })));
  if (e instanceof AuthorizationError) return jsonError(e.status === 401 ? "AUTH_REQUIRED" : "FORBIDDEN", e.status);
  if (e instanceof BusinessError) return jsonError(e.code, e.httpStatus);
  if (e instanceof Error && isBusinessErrorCode(e.message)) return jsonError(e.message);
  const mapped = toBusinessError(e);
  if (mapped.code === "INTERNAL_ERROR") {
    console.error(JSON.stringify({ level: "error", requestId, message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }));
  }
  return jsonError(mapped.code, mapped.httpStatus);
}

// ---- Rate limiting --------------------------------------------------------
// Shared across instances when RATE_LIMIT_REDIS_URL/TOKEN are set (see @rental/server/rate-limit).
let limiter: RateLimiter | null = null;
export function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  limiter ??= rateLimiterFromEnv(serverEnv());
  return limiter.hit(key, limit, windowMs);
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
