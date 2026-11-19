import type { MetadataRoute } from "next";
import { PRODUCTION_HOST } from "@/lib/devstats/vercelDeployment.mjs";

export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/chat", "/feedback", "/found/new", "/login", "/lost/new", "/me", "/notifications", "/onboarding", "/posts/mine"],
    },
    sitemap: `https://${PRODUCTION_HOST}/sitemap.xml`,
  };
}
