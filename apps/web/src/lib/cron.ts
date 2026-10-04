import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>`; closed when the secret is unset. */
export function cronAuthorized(req: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}
