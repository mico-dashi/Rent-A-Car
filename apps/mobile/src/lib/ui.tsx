import type { ReactNode } from "react";
import { createTranslator } from "@rental/localization";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTenant } from "./tenant";

/** Small themed primitives so every screen follows the tenant brand and accessibility rules (44pt targets, roles, labels). */

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const pad: ViewStyle = padded ? { padding: 20, gap: 16 } : {};
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      {scroll ? <ScrollView contentContainerStyle={{ ...pad, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1, ...pad }}>{children}</View>}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const { theme } = useTenant();
  return <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>{children}</Text>;
}

export function H2({ children }: { children: ReactNode }) {
  const { theme } = useTenant();
  return <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const { theme } = useTenant();
  return <Text style={[{ color: muted ? theme.textMuted : theme.text, fontSize: 15, lineHeight: 21 }, style]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const { theme } = useTenant();
  return <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" }}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { theme } = useTenant();
  return <View style={[{ backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 8 }, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = "primary", disabled, busy, accessibilityHint }: {
  title: string; onPress: () => void; variant?: "primary" | "ghost" | "danger"; disabled?: boolean; busy?: boolean; accessibilityHint?: string;
}) {
  const { theme } = useTenant();
  const bg = variant === "primary" ? theme.primaryButton : "transparent";
  const fg = variant === "primary" ? theme.onPrimary : variant === "danger" ? theme.danger : theme.text;
  const border = variant === "primary" ? theme.primaryButton : variant === "danger" ? theme.danger : theme.border;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} accessibilityHint={accessibilityHint}
      disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: border, backgroundColor: bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: "700", fontSize: 16 }}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { theme } = useTenant();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} hitSlop={6}
      style={{ minHeight: 40, justifyContent: "center", borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.surfaceRaised : "transparent", borderWidth: 1, borderRadius: 999, paddingHorizontal: 14 }}>
      <Text style={{ color: theme.text, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { theme } = useTenant();
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput accessibilityLabel={label} placeholderTextColor={theme.textMuted} {...props}
        style={[{ color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16 }, props.style]} />
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const { theme } = useTenant();
  return <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 14 }}>{children}</Text>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }, style]}>{children}</View>;
}

export function Loading() {
  const { theme, lang } = useTenant();
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}><ActivityIndicator color={theme.primary} accessibilityLabel={createTranslator(lang)("common.loading")} /></View>;
}
