import { getT } from "@/lib/i18n";

export default async function Forbidden() {
  const { t } = await getT();
  return <div className="py-20 text-center"><h1 className="font-display text-2xl font-black">403</h1><p className="mt-2 text-muted">{t("errors.FORBIDDEN")}</p></div>;
}
