// Validates every white-label client resolves to a complete Expo config (run in CI).
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const clientsDir = join(import.meta.dirname, "../../../clients");
const variants = readdirSync(clientsDir).filter((d) => statSync(join(clientsDir, d)).isDirectory());
const ids = new Set();
for (const variant of variants) {
  for (const env of ["development", "production"]) {
    const out = execFileSync("npx", ["expo", "config", "--json", "--type", "public"], {
      cwd: join(import.meta.dirname, ".."), env: { ...process.env, APP_VARIANT: variant, APP_ENV: env }, encoding: "utf8",
    });
    const cfg = JSON.parse(out);
    const id = `${cfg.ios.bundleIdentifier}|${cfg.android.package}`;
    if (ids.has(id)) throw new Error(`Duplicate bundle identifiers for ${variant}/${env}`);
    ids.add(id);
    console.log(`${variant}/${env}: ${cfg.name} ${cfg.ios.bundleIdentifier} ${cfg.android.package}`);
  }
}
