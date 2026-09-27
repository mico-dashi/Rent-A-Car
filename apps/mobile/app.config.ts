import type { ConfigContext, ExpoConfig } from "expo/config";
import { loadClient } from "../../clients/index.ts";

/**
 * One codebase, many builds. APP_VARIANT selects clients/<variant>/config.ts
 * (default: the universal multi-tenant app). EAS profiles set APP_VARIANT.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const client = loadClient(process.env.APP_VARIANT);
  const env = process.env.APP_ENV ?? "development"; // development | preview | production
  const suffix = env === "production" ? "" : `.${env}`;
  return {
    ...config,
    name: env === "production" ? client.appName : `${client.appName} (${env})`,
    slug: client.slug,
    scheme: client.scheme,
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: client.icon,
    ios: {
      bundleIdentifier: client.bundleIdentifier + suffix,
      supportsTablet: true,
      associatedDomains: client.associatedDomains.map((d) => `applinks:${d}`),
      infoPlist: {
        NSCameraUsageDescription: "Used to photograph vehicles during pickup and return inspections and to scan vehicle QR codes.",
        NSLocationWhenInUseUsageDescription: "Used to find rental locations near you.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: client.androidPackage + suffix,
      adaptiveIcon: { foregroundImage: client.adaptiveIconForeground, backgroundColor: client.backgroundColor },
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: client.associatedDomains.map((host) => ({ scheme: "https", host, pathPrefix: "/t" })),
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
      permissions: ["CAMERA", "ACCESS_COARSE_LOCATION"],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-localization",
      ["expo-camera", { cameraPermission: "Used to photograph vehicles during pickup and return inspections and to scan vehicle QR codes.", recordAudioAndroid: false }],
      ["expo-image-picker", { cameraPermission: "Used to photograph vehicles during pickup and return inspections.", photosPermission: false, microphonePermission: false }],
      ["expo-notifications", { color: client.primaryColor }],
      "expo-web-browser",
      ["expo-splash-screen", { image: client.splash, backgroundColor: client.backgroundColor, imageWidth: 160, resizeMode: "contain" }],
    ],
    experiments: { typedRoutes: true },
    extra: {
      client: {
        tenantId: client.tenantId,
        tenantSlug: client.tenantSlug,
        primaryColor: client.primaryColor,
        secondaryColor: client.secondaryColor,
        backgroundColor: client.backgroundColor,
        supportEmail: client.supportEmail,
        websiteDomain: client.websiteDomain,
      },
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
      ...(client.easProjectId ? { eas: { projectId: client.easProjectId } } : {}),
    },
  };
};
