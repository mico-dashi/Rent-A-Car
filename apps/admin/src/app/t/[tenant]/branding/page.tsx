import { accessibleButton, buildTheme, contrastRatio } from "@rental/design-tokens";
import { ActionForm, Check, Field, Hidden, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { saveBrandAction, uploadBrandAssetAction } from "./actions";

const FONTS = ["Inter", "Manrope", "Poppins", "Montserrat", "Playfair Display", "Space Grotesk", "DM Sans", "Sora"];
const SLOTS = ["logo_path", "logo_dark_path", "hero_image_path", "app_icon_path", "splash_path"] as const;

export default async function BrandingPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "tenant.read");
  const { t, lang } = await getT();
  const { data: b } = await (await userClient()).from("tenant_branding").select("*").eq("tenant_id", ctx.tenantId).single();
  if (!b) return null;
  const theme = buildTheme({ primaryColor: b.primary_color, secondaryColor: b.secondary_color, backgroundColor: b.background_color }, "dark");
  const btn = accessibleButton(b.primary_color);
  const edit = can(ctx, "branding.manage");
  return (
    <>
      <PageHeader title={t("admin.nav.branding")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title={t("admin.branding.colors")}>
            {edit ? (
              <ActionForm action={saveBrandAction} lang={lang} submitLabel={t("admin.common.save")}>
                <TenantFields slug={ctx.slug} />
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label={t("admin.branding.primary")} name="primary" type="color" defaultValue={b.primary_color} />
                  <Field label={t("admin.branding.secondary")} name="secondary" type="color" defaultValue={b.secondary_color} />
                  <Field label={t("admin.branding.background")} name="background" type="color" defaultValue={b.background_color} />
                  <Select label={t("admin.branding.headingFont")} name="font_heading" required defaultValue={b.font_heading} options={FONTS.map((f) => ({ value: f, label: f }))} />
                  <Select label={t("admin.branding.bodyFont")} name="font_body" required defaultValue={b.font_body} options={FONTS.map((f) => ({ value: f, label: f }))} />
                  <Select label={t("admin.branding.theme")} name="theme" required defaultValue={b.default_theme} options={["dark", "light", "system"].map((x) => ({ value: x, label: t(`admin.branding.themes.${x}`) }))} />
                  <Field label={t("admin.branding.emailFrom")} name="email_from_name" defaultValue={b.email_from_name} />
                  <Field label={t("admin.branding.emailFooter")} name="email_footer" defaultValue={b.email_footer} />
                </div>
                <Check label={t("admin.branding.hidePlatform")} name="hide_platform_branding" defaultChecked={b.hide_platform_branding} />
              </ActionForm>
            ) : null}
          </Card>
          <Card title={t("admin.branding.assets")}>
            <div className="grid gap-6 md:grid-cols-2">
              {SLOTS.map((slot) => {
                const url = mediaUrl(b[slot], "tenant-branding");
                return (
                  <div key={slot} className="space-y-2">
                    <p className="label">{t(`admin.branding.slots.${slot}`)}</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url ? <img src={url} alt="" className="h-20 w-auto rounded-md border border-line bg-raised object-contain p-2" /> : <div className="h-20 rounded-md border border-dashed border-line" />}
                    {edit ? (
                      <ActionForm action={uploadBrandAssetAction} lang={lang} submitLabel={t("admin.inspections.upload")} variant="ghost" className="space-y-2" resetOnSuccess>
                        <TenantFields slug={ctx.slug} /><Hidden name="slot" value={slot} />
                        <input type="file" name="file" accept={slot === "hero_image_path" ? "image/jpeg,image/webp,image/png" : "image/png,image/svg+xml,image/webp,image/jpeg"} required aria-label={t(`admin.branding.slots.${slot}`)} className="text-sm" />
                      </ActionForm>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
        <Card title={t("admin.branding.preview")}>
          <div className="rounded-lg p-5" style={{ background: theme.background, color: theme.text }}>
            <p style={{ fontFamily: b.font_heading }} className="text-2xl font-black">{b.headline ?? ctx.name}</p>
            <p className="mt-1 text-sm" style={{ color: theme.textMuted }}>{b.subheadline}</p>
            <div className="mt-4 rounded-md p-4" style={{ background: theme.surface }}>
              <span className="inline-block rounded-md px-4 py-2 text-sm font-semibold" style={{ background: btn.background, color: btn.text }}>{t("common.bookNow")}</span>
            </div>
          </div>
          <ul className="mt-4 space-y-1 text-xs text-muted">
            <li>{t("admin.branding.contrastText")}: {contrastRatio(theme.text, theme.background).toFixed(1)}:1</li>
            <li>{t("admin.branding.contrastButton")}: {contrastRatio(btn.background, btn.text).toFixed(1)}:1 {btn.background.toUpperCase() !== b.primary_color.toUpperCase() ? `(${t("admin.branding.adjusted")} ${btn.background})` : ""}</li>
            {theme.background !== b.background_color.toUpperCase() && theme.background !== b.background_color ? <li className="text-warn">{t("admin.branding.backgroundReplaced")}</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}
