import type { ClientConfig } from "../types.ts";

// The default universal app: one listing on each store, tenant chosen at runtime
// (invite link, QR code, custom-domain link, tenant code or optional location discovery).
const config: ClientConfig = {
  tenantId: null,
  tenantSlug: null,
  appName: "Drive — Car Rental",
  slug: "rental-universal",
  scheme: "rentalplatform",
  bundleIdentifier: "com.example.rentalplatform",
  androidPackage: "com.example.rentalplatform",
  icon: "./assets/icon.png",
  adaptiveIconForeground: "./assets/adaptive-icon.png",
  splash: "./assets/splash.png",
  primaryColor: "#EC0618",
  secondaryColor: "#212325",
  backgroundColor: "#010101",
  supportEmail: "support@myplatform.com",
  websiteDomain: "myplatform.com",
  associatedDomains: ["app.myplatform.com"],
};
export default config;
