import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { admitPublicRead } from "./readGuard";

// Security audit A-5: the page form of guardPublicReadApi(). Called first
// thing in a public page, before any query; an over-limit request is sent
// to /busy, a page with no database work at all.
export async function guardPublicPage(): Promise<void> {
  if (!(await admitPublicRead(await headers())).ok) redirect("/busy");
}
