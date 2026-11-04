import type { ReactNode } from "react";

// The chat screens' frame (Phase 3-B). From lg: one bordered panel, the room
// list on the left (scrolling on its own) and the open room -- or a "pick a
// room" line -- on the right. Below lg the list and the room are separate
// pages: /chat shows the list (listOnPhone), /chat/[id] the room alone, so a
// phone never squeezes two columns. data-wide-board widens the page shell
// from 1280px, as on the boards.
export function ChatShell({ title, list, main, listOnPhone = false }: { title: string; list: ReactNode; main: ReactNode; listOnPhone?: boolean }) {
  return (
    <div data-wide-board className="flex flex-col lg:grid lg:h-[min(80dvh,54rem)] lg:grid-cols-[20rem_minmax(0,1fr)] lg:overflow-hidden lg:rounded-card lg:border lg:border-border">
      <aside className={`${listOnPhone ? "flex" : "hidden lg:flex"} min-h-0 flex-col lg:border-r lg:border-border`}>
        <h1 className="pb-3 text-xl font-bold text-foreground lg:border-b lg:border-border lg:px-4 lg:py-3 lg:text-base">{title}</h1>
        <div className="-mx-4 border-t border-border md:-mx-6 lg:mx-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:border-t-0">{list}</div>
      </aside>
      <section className={`${listOnPhone ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col lg:p-4`}>{main}</section>
    </div>
  );
}
