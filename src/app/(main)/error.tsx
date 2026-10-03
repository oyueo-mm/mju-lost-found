"use client";

import { ErrorScreen } from "@/components/layout/ErrorScreen";

// Same screen as app/error.tsx, but inside the (main) layout so the header
// and navigation stay usable when only the page itself failed.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
