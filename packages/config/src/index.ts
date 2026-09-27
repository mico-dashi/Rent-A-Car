import { z } from "zod";

/**
 * Environment validation. Import `publicEnv` in browser code and `serverEnv`
 * only in server-only modules. Server secrets are never NEXT_PUBLIC_/EXPO_PUBLIC_.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN: z.string().min(3).default("localhost"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  PAYMENTS_MODE: z.enum(["test", "live"]).default("test"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_DOMAIN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(24).optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export class EnvError extends Error {}

function parse<T extends z.ZodTypeAny>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    // Never echo values — only names of invalid variables.
    throw new EnvError(`Invalid or missing environment variables: ${fields}`);
  }
  return result.data;
}

export function readPublicEnv(source: Record<string, string | undefined> = process.env): PublicEnv {
  return parse(publicSchema, source);
}

export function readServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  if (typeof window !== "undefined") throw new EnvError("readServerEnv() must never run in the browser");
  return parse(serverSchema, source);
}
