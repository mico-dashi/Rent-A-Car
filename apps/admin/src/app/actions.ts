"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setLanguage(form: FormData) {
  const lang = form.get("lang");
  if (lang !== "en" && lang !== "sq") return;
  (await cookies()).set("lang", lang, { path: "/", maxAge: 31536000, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
