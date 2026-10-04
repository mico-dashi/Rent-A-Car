import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

/**
 * Ask for notification permission (only after sign-in, never on first launch)
 * and store this device's Expo push token for the signed-in user. RLS limits
 * the row to its owner. Returns the token, or null when unavailable/denied.
 */
export async function registerForPush(userId: string, appVariant: string): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators cannot receive pushes
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "default", importance: Notifications.AndroidImportance.DEFAULT });
  }
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted ? "granted" : (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await supabase().from("push_tokens").upsert(
    { user_id: userId, token, platform: Platform.OS === "ios" ? "ios" : "android", app_variant: appVariant, last_seen_at: new Date().toISOString() },
    { onConflict: "token" },
  );
  return token;
}

/** Remove this device's token on sign-out so a shared device stops receiving the previous user's messages. */
export async function unregisterPush(token: string | null) {
  if (token) await supabase().from("push_tokens").delete().eq("token", token);
}
