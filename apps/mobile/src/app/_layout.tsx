import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/auth";
import { TenantProvider, useTenant } from "@/lib/tenant";

function ThemedStack() {
  const { theme } = useTenant();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background }, animation: "fade" }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <TenantProvider>
        <AuthProvider>
          <ThemedStack />
        </AuthProvider>
      </TenantProvider>
    </SafeAreaProvider>
  );
}
