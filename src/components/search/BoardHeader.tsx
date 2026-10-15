import { LinkButton } from "@/components/ui/Button";
import { PlusIcon } from "@/components/icons";
import Link from "next/link";

// 게시판 리디자인 Phase: the /lost and /found page header. The title carries
// the page (larger, bold), one line says what the board is for, and the
// register button sits on the right from `sm` up. On a phone the same
// button is a round floating button above the bottom navigation instead,
// so it stays one tap away however far down the list the visitor is.
export function BoardHeader({
  title,
  description,
  newHref,
  newLabel,
}: {
  title: string;
  description: string;
  newHref: string;
  newLabel: string;
}) {
  return (
    <>
      <header className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="hidden shrink-0 sm:block">
          <LinkButton href={newHref}>
            <PlusIcon aria-hidden="true" className="size-4" />
            {newLabel}
          </LinkButton>
        </div>
      </header>
      <Link
        href={newHref}
        aria-label={newLabel}
        className="fixed right-4 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+1rem)] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition motion-safe:active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:hidden"
      >
        <PlusIcon aria-hidden="true" className="size-6" />
      </Link>
    </>
  );
}
