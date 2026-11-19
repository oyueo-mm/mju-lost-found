import type { MetadataRoute } from "next";
import { PRODUCTION_HOST } from "@/lib/devstats/vercelDeployment.mjs";

export default function sitemap(): MetadataRoute.Sitemap {
  if (process.env.VERCEL_ENV !== "production") return [];

  return ["/", "/lost", "/found"].map((path) => ({ url: `https://${PRODUCTION_HOST}${path}` }));
}
