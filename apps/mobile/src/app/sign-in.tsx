import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useTenant } from "@/lib/tenant";
import { Body, Button, ErrorText, Field, H1, Row, Screen } from "@/lib/ui";

export default function SignIn() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { lang } = useTenant();
  const { signIn, signUp } = useAuth();
  const t = useT(lang);
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const err = mode === "signIn" ? await signIn(email, password) : await signUp({ email, password, firstName, lastName });
    setBusy(false);
    if (err) return setMessage({ ok: false, text: err });
    if (mode === "signUp") return setMessage({ ok: true, text: t("auth.confirmEmail") });
    if (next && next.startsWith("/")) router.replace(next as never);
    else router.back();
  }

  return (
    <Screen>
      <Row><Button title={`‹ ${t("common.back")}`} variant="ghost" onPress={() => router.back()} /></Row>
      <H1>{mode === "signIn" ? t("auth.signInTitle") : t("auth.signUpTitle")}</H1>
      {mode === "signUp" ? (
        <>
          <Field label={t("auth.firstName")} value={firstName} onChangeText={setFirstName} autoComplete="given-name" textContentType="givenName" />
          <Field label={t("auth.lastName")} value={lastName} onChangeText={setLastName} autoComplete="family-name" textContentType="familyName" />
        </>
      ) : null}
      <Field label={t("auth.email")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t("auth.password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "signIn" ? "current-password" : "new-password"}
        textContentType={mode === "signIn" ? "password" : "newPassword"} onSubmitEditing={submit} />
      {message ? (message.ok ? <Body>{message.text}</Body> : <ErrorText>{message.text}</ErrorText>) : null}
      <Button title={mode === "signIn" ? t("auth.signIn") : t("auth.signUp")} onPress={submit} busy={busy}
        disabled={!email || password.length < (mode === "signUp" ? 10 : 1) || (mode === "signUp" && (!firstName || !lastName))} />
      <Button variant="ghost" title={mode === "signIn" ? `${t("auth.noAccount")} ${t("auth.signUp")}` : `${t("auth.haveAccount")} ${t("auth.signIn")}`}
        onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")} />
    </Screen>
  );
}
