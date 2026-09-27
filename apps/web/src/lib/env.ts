import "server-only";
import { readServerEnv, type ServerEnv } from "@rental/config";

let cached: ServerEnv | null = null;
/** Validated server environment (throws with variable NAMES only if misconfigured). */
export function serverEnv(): ServerEnv {
  cached ??= readServerEnv();
  return cached;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
