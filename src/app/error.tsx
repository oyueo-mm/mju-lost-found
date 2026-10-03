"use client";

import { ErrorScreen } from "@/components/layout/ErrorScreen";

// Catches errors in every page and nested layout below the root layout
// (including a failing (main) layout, e.g. while the DB is unreachable),
// instead of Next's default "Application error" screen.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
