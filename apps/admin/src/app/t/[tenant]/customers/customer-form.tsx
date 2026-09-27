import { Check, Field, Select } from "@/components/forms";
import type { Tables } from "@rental/database";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";

export function CustomerFields({ c, lang }: { c?: Tables<"customers">; lang: LanguageCode }) {
  const t = createTranslator(lang);
  const f = (k: string) => t(`admin.customers.fields.${k}`);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field label={t("auth.firstName")} name="first_name" required defaultValue={c?.first_name} autoComplete="off" />
      <Field label={t("auth.lastName")} name="last_name" required defaultValue={c?.last_name} autoComplete="off" />
      <Field label={t("auth.email")} name="email" type="email" required defaultValue={c?.email} autoComplete="off" />
      <Field label={f("phone")} name="phone" defaultValue={c?.phone} />
      <Field label={t("checkout.dateOfBirth")} name="date_of_birth" type="date" defaultValue={c?.date_of_birth} />
      <Select label={f("language")} name="preferred_language" defaultValue={c?.preferred_language} options={[{ value: "en", label: "English" }, { value: "sq", label: "Shqip" }]} />
      <Field label={f("address")} name="address_line1" defaultValue={c?.address_line1} />
      <Field label={f("city")} name="city" defaultValue={c?.city} />
      <Field label={f("postalCode")} name="postal_code" defaultValue={c?.postal_code} />
      <Field label={f("country")} name="country_code" defaultValue={c?.country_code} pattern="[A-Za-z]{2}" placeholder="AL" />
      <Field label={f("nationality")} name="nationality" defaultValue={c?.nationality} pattern="[A-Za-z]{2}" placeholder="GB" />
      <div />
      <Field label={f("emergencyName")} name="emergency_contact_name" defaultValue={c?.emergency_contact_name} />
      <Field label={f("emergencyPhone")} name="emergency_contact_phone" defaultValue={c?.emergency_contact_phone} />
      <div className="flex items-end"><Check label={f("marketing")} name="marketing_opt_in" defaultChecked={c?.marketing_opt_in} /></div>
    </div>
  );
}
