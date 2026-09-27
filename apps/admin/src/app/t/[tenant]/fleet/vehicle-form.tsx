import { Check, Field, Select, TextArea } from "@/components/forms";
import { toMajor } from "@/lib/format";
import { VEHICLE_CATEGORIES, type LanguageCode } from "@rental/types";
import { createTranslator } from "@rental/localization";
import type { Tables } from "@rental/database";

export function VehicleFields({ v, branches, lang }: { v?: Tables<"vehicles">; branches: { id: string; name: string }[]; lang: LanguageCode }) {
  const t = createTranslator(lang);
  const f = (k: string) => t(`admin.fleet.fields.${k}`);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={f("make")} name="make" required defaultValue={v?.make} />
        <Field label={f("model")} name="model" required defaultValue={v?.model} />
        <Field label={f("trim")} name="trim" defaultValue={v?.trim} />
        <Field label={f("year")} name="year" type="number" min={1950} max={2100} required defaultValue={v?.year ?? new Date().getFullYear()} />
        <Select label={f("category")} name="category" required defaultValue={v?.category} options={VEHICLE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))} />
        <Select label={f("branch")} name="branch_id" required defaultValue={v?.branch_id} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        <Field label={f("fleetNumber")} name="fleet_number" required defaultValue={v?.fleet_number} />
        <Field label={f("plate")} name="registration_plate" required defaultValue={v?.registration_plate} />
        <Field label="VIN" name="vin" defaultValue={v?.vin} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{11,17}" />
        <Field label={f("exteriorColor")} name="exterior_color" defaultValue={v?.exterior_color} />
        <Field label={f("interiorColor")} name="interior_color" defaultValue={v?.interior_color} />
        <Field label={f("odometer")} name="odometer_km" type="number" min={0} defaultValue={v?.odometer_km ?? 0} />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Select label={f("transmission")} name="transmission" required defaultValue={v?.transmission ?? "AUTOMATIC"} options={["AUTOMATIC", "MANUAL"].map((x) => ({ value: x, label: t(`vehicle.transmission.${x}`) }))} />
        <Select label={f("fuel")} name="fuel_type" required defaultValue={v?.fuel_type ?? "PETROL"} options={["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"].map((x) => ({ value: x, label: t(`vehicle.fuel.${x}`) }))} />
        <Select label={f("drivetrain")} name="drivetrain" defaultValue={v?.drivetrain} options={["FWD", "RWD", "AWD", "FOUR_WD"].map((x) => ({ value: x, label: x.replace("_", "") }))} />
        <Field label={f("engine")} name="engine" defaultValue={v?.engine} />
        <Field label={f("seats")} name="seats" type="number" min={1} max={60} required defaultValue={v?.seats ?? 5} />
        <Field label={f("doors")} name="doors" type="number" min={0} max={8} required defaultValue={v?.doors ?? 4} />
        <Field label={f("luggage")} name="luggage" type="number" min={0} max={30} defaultValue={v?.luggage} />
        <Field label={f("horsepower")} name="horsepower" type="number" min={0} defaultValue={v?.horsepower} />
        <Field label={f("range")} name="electric_range_km" type="number" min={0} defaultValue={v?.electric_range_km} />
      </div>
      <fieldset className="grid gap-4 md:grid-cols-4"><legend className="label md:col-span-4">{f("rates")}</legend>
        <Field label={f("dailyRate")} name="daily_rate" required defaultValue={toMajor(v?.daily_rate_minor)} />
        <Field label={f("hourlyRate")} name="hourly_rate" defaultValue={toMajor(v?.hourly_rate_minor)} />
        <Field label={f("weeklyRate")} name="weekly_rate" defaultValue={toMajor(v?.weekly_rate_minor)} />
        <Field label={f("monthlyRate")} name="monthly_rate" defaultValue={toMajor(v?.monthly_rate_minor)} />
        <Field label={f("deposit")} name="deposit" required defaultValue={toMajor(v?.deposit_minor ?? 0)} />
        <Field label={f("minAge")} name="minimum_driver_age" type="number" min={16} max={99} required defaultValue={v?.minimum_driver_age ?? 21} />
        <Field label={f("includedKm")} name="included_km_per_day" type="number" min={0} defaultValue={v?.included_km_per_day} hint={f("includedKmHint")} />
        <Field label={f("extraKm")} name="extra_km_rate" defaultValue={toMajor(v?.extra_km_rate_minor ?? 0)} />
        <Field label={f("purchasePrice")} name="purchase_price" defaultValue={toMajor(v?.purchase_price_minor)} />
        <Field label={f("estimatedValue")} name="estimated_value" defaultValue={toMajor(v?.estimated_value_minor)} />
      </fieldset>
      <TextArea label={f("description")} name="description" defaultValue={v?.description} rows={3} maxLength={2000} />
      <Check label={f("published")} name="is_published" defaultChecked={v?.is_published ?? false} />
    </div>
  );
}
