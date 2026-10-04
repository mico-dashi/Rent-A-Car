import { useEffect, useState } from "react";
import { Alert, Linking } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { translateError } from "@rental/localization";
import * as WebBrowser from "expo-web-browser";
import { BusinessError } from "@rental/types";
import { httpApi, tenantOrigin } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { lockedTenantSlug } from "@/lib/config";
import { useT } from "@/lib/i18n";
import { registerForPush, unregisterPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { Body, Button, Card, ErrorText, H1, H2, Label, Screen } from "@/lib/ui";

export default function AccountTab() {
  const { tenant, lang, clear } = useTenant();
  const { session, signOut, staffRole } = useAuth();
  const t = useT(lang);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushGranted, setPushGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [identity, setIdentity] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!session || !tenant) return;
    supabase().from("customers").select("identity_status").eq("tenant_id", tenant.id).eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => setIdentity((data as { identity_status: string } | null)?.identity_status ?? "UNVERIFIED"));
  }, [session, tenant, verifying]);

  async function verifyIdentity() {
    const api = tenant ? httpApi(tenant) : null;
    if (!api) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await api.startIdentityVerification();
      if (res.url) await WebBrowser.openBrowserAsync(res.url);
    } catch (e) {
      setError(e instanceof BusinessError ? e.code : "INTERNAL_ERROR");
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => {
    Notifications.getPermissionsAsync().then((p) => setPushGranted(p.granted)).catch(() => setPushGranted(false));
  }, []);
  // Refresh the stored token silently when permission already exists (tokens can rotate).
  useEffect(() => {
    if (session && pushGranted) registerForPush(session.user.id, lockedTenantSlug ?? "universal").then(setPushToken).catch(() => undefined);
  }, [session, pushGranted]);

  const origin = tenant ? tenantOrigin(tenant) : null;

  if (!session) {
    return (
      <Screen>
        <H1>{t("mobile.tabs.account")}</H1>
        <Button title={t("auth.signIn")} onPress={() => router.push("/sign-in")} />
        {!lockedTenantSlug ? <Button title={t("mobile.switchCompany")} variant="ghost" onPress={clear} /> : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>{t("mobile.tabs.account")}</H1>
      <Card>
        <Label>{t("auth.email")}</Label>
        <Body>{session.user.email}</Body>
        {staffRole ? <Body muted>{t(`admin.roles.${staffRole}`)} · {tenant?.displayName}</Body> : null}
      </Card>

      <Card>
        <H2>{t("account.identityTitle")}</H2>
        <Body muted>{t("account.identityHint")}</Body>
        {identity ? <Body>{t("admin.common.status")}: {t(`admin.verification.${identity}`)}</Body> : null}
        {identity && identity !== "VERIFIED" ? <Button title={t("account.verifyIdentity")} variant="ghost" busy={verifying} onPress={verifyIdentity} /> : null}
      </Card>

      <Card>
        <H2>{t("mobile.notifications")}</H2>
        <Body muted>{pushGranted ? t("mobile.notificationsOn") : t("mobile.notificationsHint")}</Body>
        {!pushGranted ? (
          <Button title={t("mobile.enableNotifications")} variant="ghost" onPress={async () => {
            const token = await registerForPush(session.user.id, lockedTenantSlug ?? "universal").catch(() => null);
            setPushToken(token);
            setPushGranted(Boolean(token));
          }} />
        ) : null}
      </Card>

      <Card>
        <H2>{t("account.privacyTitle")}</H2>
        <Body muted>{t("account.exportHint")}</Body>
        {origin ? <Button title={t("account.exportData")} variant="ghost" onPress={() => Linking.openURL(`${origin}/account/privacy`)} /> : null}
        <Body muted>{t("account.deleteHint")}</Body>
        {deletionRequested ? <Body>{t("account.deleteRequested")}</Body> : (
          <Button title={t("account.deleteAccount")} variant="danger" onPress={() => Alert.alert(t("account.deleteAccount"), t("account.deleteConfirm"), [
            { text: t("common.back"), style: "cancel" },
            {
              text: t("account.deleteAccount"), style: "destructive", onPress: async () => {
                const { error: e } = await supabase().rpc("request_account_deletion");
                if (e) setError(e.message.trim());
                else setDeletionRequested(true);
              },
            },
          ])} />
        )}
        {error ? <ErrorText>{translateError(lang, error)}</ErrorText> : null}
      </Card>

      <Button title={t("auth.signOut")} variant="ghost" onPress={async () => { await unregisterPush(pushToken).catch(() => undefined); await signOut(); }} />
      {!lockedTenantSlug ? <Button title={t("mobile.switchCompany")} variant="ghost" onPress={clear} /> : null}
    </Screen>
  );
}
