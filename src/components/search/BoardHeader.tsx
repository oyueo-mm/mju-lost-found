import { LinkButton } from "@/components/ui/Button";
import { PlusIcon } from "@/components/icons";
import { BoardFab } from "./BoardFab";

// 게시판 리디자인 Phase: the /lost and /found page header -- the title
// carries the page, one line says what the board is for, and the register
// button sits on the right at every width (compact on a phone). Further
// down a long list a phone gets the same action as a floating button that
// only shows up while scrolling back up (BoardFab).
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
  const buttonId = `board-new-${newHref.replace(/\W+/g, "")}`;
  return (
    <>
      <header className="flex flex-col gap-1 sm:gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          <div id={buttonId} className="shrink-0">
            <LinkButton href={newHref} size="sm" className="sm:h-10 sm:px-4">
              <PlusIcon aria-hidden="true" className="size-4" />
              {newLabel}
            </LinkButton>
          </div>
        </div>
        <p className="max-w-2xl text-[13px] leading-snug text-muted-foreground sm:text-sm">{description}</p>
      </header>
      <BoardFab href={newHref} label={newLabel} watchId={buttonId} />
    </>
  );
}
