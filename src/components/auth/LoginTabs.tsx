"use client";

import { useState, type ComponentType, type ReactNode } from "react";

import { BoxIcon, ChatIcon, EyeIcon, SearchIcon, ShieldIcon } from "@/components/icons";

// Phase 29: a same-page tab toggle for the logged-out /login page -- pure
// client-side state (no route change, no query param), so switching tabs
// never re-runs the server component above it or touches callbackUrl/
// reason. The login tab's content is passed in as `children` (built by the
// server component, since it owns the "use server" signIn() action) rather
// than duplicated here; both panels stay mounted (toggled via `hidden`,
// not conditionally rendered) so the login form's state/action binding
// never remounts when a visitor flips back and forth.
const TABS = [
  { key: "intro", label: "서비스 소개" },
  { key: "login", label: "로그인" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const FEATURES: { Icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
  {
    Icon: BoxIcon,
    title: "분실물 · 습득물 게시",
    description: "캠퍼스에서 잃어버리거나 주운 물건을 사진과 함께 올려요.",
  },
  {
    Icon: SearchIcon,
    title: "검색",
    description: "제목, 카테고리, 위치로 원하는 게시물을 빠르게 찾아요.",
  },
  {
    Icon: ShieldIcon,
    title: "AI 검색 · 매칭",
    description: "AI가 비슷한 분실물과 습득물을 자동으로 찾아 연결해줘요.",
  },
  {
    Icon: EyeIcon,
    title: "이미지 기반 유사 게시물 검색",
    description: "사진 한 장으로 비슷하게 생긴 게시물을 찾아볼 수 있어요.",
  },
  {
    Icon: ChatIcon,
    title: "채팅",
    description: "게시물 작성자와 바로 채팅으로 연락해 물건을 주고받아요.",
  },
];

function ServiceIntro() {
  return (
    <div className="flex w-full flex-col gap-5 text-left">
      <p className="text-sm text-muted-foreground">
        명지 스마트 분실물 센터는 명지대학교 캠퍼스에서 잃어버린 물건과 주운 물건을 빠르게 연결해주는 서비스예요.
      </p>
      <ul className="flex flex-col gap-3.5">
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

export function LoginTabs({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<TabKey>("intro");

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div role="tablist" aria-label="로그인 페이지 탭" className="flex w-full gap-1 rounded-full bg-muted p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`login-tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`login-tabpanel-${tab.key}`}
            onClick={() => setActive(tab.key)}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active === tab.key
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id="login-tabpanel-intro" role="tabpanel" aria-labelledby="login-tab-intro" hidden={active !== "intro"}>
        <ServiceIntro />
      </div>
      <div
        id="login-tabpanel-login"
        role="tabpanel"
        aria-labelledby="login-tab-login"
        hidden={active !== "login"}
        className="flex w-full flex-col items-center"
      >
        {children}
      </div>
    </div>
  );
}
