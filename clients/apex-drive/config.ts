import type { ClientConfig } from "../types.ts";

// Example enterprise branded build (demo tenant). Only produce dedicated store
// listings when app-store policy allows and the app offers distinct value — see WHITE_LABEL.md.
const config: ClientConfig = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  tenantSlug: "apex-drive",
  appName: "Apex Drive",
  slug: "apex-drive",
  scheme: "apexdrive",
  bundleIdentifier: "com.example.apexdrive",
  androidPackage: "com.example.apexdrive",
  icon: "./assets/icon.png",
  adaptiveIconForeground: "./assets/adaptive-icon.png",
  splash: "./assets/splash.png",
  primaryColor: "#EC0618",
  secondaryColor: "#212325",
  backgroundColor: "#010101",
  supportEmail: "hello@apexdrive.demo",
  websiteDomain: "apexdrive.demo",
  associatedDomains: ["apexdrive.demo"],
};
export default config;
