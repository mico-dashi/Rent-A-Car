import { getLang } from "@/lib/i18n";
import { SignIn } from "./sign-in";

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const lang = await getLang();
  const { next } = await searchParams;
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <div className="flex min-h-dvh items-center justify-center px-5"><SignIn lang={lang} next={safe} /></div>;
}
