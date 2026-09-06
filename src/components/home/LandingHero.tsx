import type { ComponentType } from "react";

import { BoxIcon, ChatIcon, EyeIcon, ShieldIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui/Button";

// Phase 29: the logged-out visitor's very first screen -- replaces the
// full dashboard (search bar + recent posts rails) Home() normally shows,
// since a stranger who has never seen this service needs "what is this"
// answered before "here are today's posts" means anything. Kept to a
// single viewport-friendly stack (no nested cards/borders) per this
// phase's own "avoid excessive card/text listing" instruction -- four
// features, one line each, no more.
const FEATURES: { Icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
  {
    Icon: BoxIcon,
    title: "분실물 · 습득물 등록",
    description: "잃어버리거나 주운 물건을 사진과 함께 올려요.",
  },
  {
    Icon: ShieldIcon,
    title: "AI 검색 · 매칭",
    description: "AI가 비슷한 분실물과 습득물을 자동으로 찾아 연결해줘요.",
  },
  {
    Icon: EyeIcon,
    title: "사진으로 비슷한 게시물 찾기",
    description: "사진 한 장이면 비슷하게 생긴 게시물을 바로 찾아봐요.",
  },
  {
    Icon: ChatIcon,
    title: "채팅으로 바로 연락",
    description: "게시물 작성자와 채팅으로 연락해 물건을 주고받아요.",
  },
];

export function LandingHero() {
  return (
    <div className="flex flex-col items-center gap-10 py-6 text-center md:py-12">
      <div className="flex flex-col items-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
          M
        </span>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl leading-snug font-bold text-balance text-foreground md:text-3xl">
            명지대학교 분실물 센터
          </h1>
          <p className="max-w-md text-sm text-muted-foreground md:text-base">
            캠퍼스에서 잃어버리거나 주운 물건을 빠르게 연결해드려요. AI가 비슷한 물건을 자동으로 찾아주고, 채팅으로
            바로 연락할 수 있어요.
          </p>
        </div>
        <LinkButton href="/login" size="md" className="mt-2">
          로그인하고 시작하기
        </LinkButton>
      </div>

      <ul className="grid w-full max-w-2xl grid-cols-1 gap-x-8 gap-y-6 text-left sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
              <feature.Icon className="size-4.5" />
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{feature.title}</p>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
