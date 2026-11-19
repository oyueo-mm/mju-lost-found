"use client";

import "./globals.css";

import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { KOREAN_SITE_NAME } from "@/lib/brand";

// Last resort when the root layout itself fails: replaces the whole
// document, so it brings its own <html>/<body> and the global styles.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ko">
      <body className="flex min-h-dvh flex-col bg-background text-foreground antialiased">
        <title>{`오류 | ${KOREAN_SITE_NAME}`}</title>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
