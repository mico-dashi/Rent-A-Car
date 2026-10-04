import { ActionForm, Field, Select } from "@/components/forms";
import { Card } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { createBusinessAction } from "./actions";

export default async function Onboarding() {
  await requireUser();
  const { t, lang } = await getT();
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <p className="eyebrow">{t("admin.onboarding.step", { n: 1, total: 11 })}</p>
      <h1 className="mt-2 font-display text-3xl font-black">{t("admin.onboarding.title")}</h1>
      <div className="mt-2 h-1.5 rounded-full bg-raised"><div className="h-1.5 w-[9%] rounded-full bg-brand" /></div>
      <Card className="mt-8">
        <ActionForm action={createBusinessAction} lang={lang} submitLabel={t("admin.onboarding.create")}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("admin.onboarding.displayName")} name="displayName" required />
            <Field label={t("admin.onboarding.legalName")} name="legalName" required />
            <Field label={t("admin.onboarding.slug")} name="slug" required pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]" hint={t("admin.onboarding.slugHint", { root: process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN ?? "" })} />
            <Field label={t("admin.customers.fields.country")} name="countryCode" required pattern="[A-Za-z]{2}" placeholder="AL" />
            <Select label={t("admin.onboarding.currency")} name="currency" required options={["EUR", "USD", "GBP", "ALL", "CHF"].map((c) => ({ value: c, label: c }))} />
            <Select label={t("admin.customers.fields.language")} name="language" required options={[{ value: "en", label: "English" }, { value: "sq", label: "Shqip" }]} />
            <Field label={t("admin.branches.timezone")} name="timezone" required defaultValue="Europe/Tirane" />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
