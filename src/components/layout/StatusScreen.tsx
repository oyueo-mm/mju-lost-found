import type { ReactNode } from "react";

import { LogoMark } from "@/components/layout/Logo";

// Shared layout for the app's own error / not-found screens (app/error.tsx,
// app/not-found.tsx, post/[id]/not-found.tsx, ...). Plain markup only --
// usable from both server and client components. Shows a short, friendly
// explanation and ways out; never any internal detail (stack, DB, message).
export function StatusScreen({
  title,
  description,
  actions,
  footnote,
}: {
  title: string;
  description: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <div className="flex min-h-[60dvh] flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <LogoMark size={44} />
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
        {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  );
}
