import type { ComponentType } from "react";

import { ChatIcon, EyeIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";

// Phase 30: a flat icon+text grid, deliberately without card borders/
// shadows -- five items would read as "template landing page" if each
// were boxed identically (this phase's own "avoid repeated cards"
// instruction). AI 검색·매칭 and 사진 검색 get their own deep-dive
// sections right after this one; this grid is only the at-a-glance list.
const FEATURES: { Icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
  {
    Icon: PlusIcon,
    title: "분실물 · 습득물 등록",
    description: "잃어버리거나 주운 물건을 사진과 함께 올릴 수 있습니다.",
  },
  {
    Icon: SearchIcon,
    title: "검색",
    description: "제목, 카테고리, 위치로 원하는 게시글을 빠르게 찾을 수 있습니다.",
  },
  {
    Icon: ShieldIcon,
    title: "AI 검색 · 매칭",
    description: "AI가 비슷한 분실물과 습득물을 자동으로 찾아 연결해드립니다.",
  },
  {
    Icon: EyeIcon,
    title: "사진으로 비슷한 게시글 찾기",
    description: "사진 한 장이면 비슷하게 생긴 게시글을 바로 찾아볼 수 있습니다.",
  },
  {
    Icon: ChatIcon,
    title: "채팅으로 바로 연락",
    description: "게시글 작성자와 채팅으로 연락해 물건을 주고받을 수 있습니다.",
  },
];

export function FeatureGrid() {
  return (
    <section className="flex flex-col gap-8 py-14 md:py-20">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-bold text-foreground md:text-2xl">핵심 기능</h2>
        <p className="text-sm text-muted-foreground md:text-base">분실물 찾기부터 채팅까지, 필요한 기능은 다 있습니다.</p>
      </div>

      <ul className="grid grid-cols-1 gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="flex flex-col items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
              <feature.Icon className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">{feature.title}</p>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
