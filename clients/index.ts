import type { ClientConfig } from "./types.ts";
import universal from "./universal/config.ts";
import apexDrive from "./apex-drive/config.ts";

export type { ClientConfig };
/** Register new white-label clients here (see WHITE_LABEL.md → "Adding a white-label client"). */
export const CLIENTS: Record<string, ClientConfig> = { universal, "apex-drive": apexDrive };

export function loadClient(variant: string | undefined): ClientConfig {
  const key = variant ?? "universal";
  const cfg = CLIENTS[key];
  if (!cfg) throw new Error(`Unknown APP_VARIANT "${key}". Known: ${Object.keys(CLIENTS).join(", ")}`);
  return cfg;
}
