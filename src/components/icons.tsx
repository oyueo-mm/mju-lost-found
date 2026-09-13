// Phase 17: a small local icon set as inline SVGs -- no icon library was
// installed before this phase (checked package.json), and the design
// system rule against unnecessary dependencies means these stay hand-
// rolled rather than pulling in lucide-react/heroicons for ~15 glyphs.
// Every icon shares the same visual language: 24x24 viewBox, 1.75px
// stroke, round joins, `currentColor` (so a parent's text color controls
// it, same convention Tailwind-based icon sets use).
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

export function BoxIcon(props: IconProps) {
  // 분실물 tab -- a question-marked box reads as "missing item" without
  // needing a literal magnifying glass (already used for search).
  return (
    <svg {...base(props)}>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.8 7.7 12 12l8.2-4.3" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function HandboxIcon(props: IconProps) {
  // 습득물 tab -- same box silhouette with a checkmark, signaling "found /
  // in safekeeping" as the visual opposite of BoxIcon.
  return (
    <svg {...base(props)}>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.8 7.7 12 12l8.2-4.3" />
      <path d="M12 12v9" />
      <path d="M9.3 12.4 11 14l3.2-3.2" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5h16v10.5H9.5L5 20v-4H4Z" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 5 6v5.5c0 4.6 3 8 7 9 4-1 7-4.4 7-9V6Z" />
      <path d="m9.3 12.2 1.9 1.9 3.5-3.7" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s6.5-5.9 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.1 6.5 11 6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

export function ChatBubbleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5h16v10.5H9.5L5 20v-4H4Z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function ImageOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4.5h13a2 2 0 0 1 2 2V17" />
      <path d="M19 19.5H6a2 2 0 0 1-2-2V6" />
      <path d="m4 16.5 4.2-4.2a1.5 1.5 0 0 1 2.1 0l1.7 1.7" />
      <circle cx="9" cy="9" r="1.4" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

// AI 검색 UI 시안 개선 Phase: the compact photo-attach trigger next to the
// AI search input -- a camera reads unambiguously as "add a photo" at
// small sizes, unlike reusing PlusIcon (already meant "add a post" on
// Home's shortcuts) or ImageOffIcon (already means "no image"/failure
// elsewhere in this app). Same 24x24/1.75px-stroke language as every icon
// above.
export function CameraIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 20H5.5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M16 16.5 20.5 12 16 7.5" />
      <path d="M20.5 12H9.5" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Phase 11-4D: PostImageManager's own reorder-up/reorder-down/delete
// controls -- same 24x24/1.75px-stroke language as every icon above.
export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 15 7-7 7 7" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 9 7 7 7-7" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

// Phase H-6: the "⋯" trigger for PostManageMenu -- three filled dots, no
// stroke (unlike every icon above), since a thin 1.75px outline circle
// this small reads as barely visible at typical button sizes.
export function MoreIcon(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

// Phase 12-10 §7: "단체 ⓘ" 도움말 아이콘 -- 원 + i, 이 파일의 기존 24x24/
// 1.75px-stroke 언어를 그대로 따른다. 점(dot)만 채워진 원(fill)으로, 세로
// 막대는 얇은 stroke line으로 표현해 AlertIcon의 "점" 표현 방식과 일관되게
// 맞춘다.
export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.75" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 카테고리 아이콘 UI 개선 Phase: 홈의 카테고리 탐색이 쓰던 이모지
// (🎧✏️📚👛💳👕🎒💍📦)를 대체하는 9개 글리프. 새 아이콘 라이브러리를
// 넣지 않고(이 파일 맨 위 주석의 "의존성 없이 직접 그린다" 원칙 그대로)
// 이 파일의 기존 시각 언어 -- 24x24 viewBox, 1.75px stroke, round join,
// currentColor -- 를 하나도 벗어나지 않게 그렸다. 그래서 카테고리
// 아이콘 9개끼리도, 그리고 앱의 나머지 아이콘과도 굵기/크기감이 같다.
//
// 기타(GridIcon)에 기존 MoreIcon(⋯)을 재사용하지 않은 이유: MoreIcon은
// 이 파일에서 유일하게 fill 기반(stroke="none")이라, 외곽선으로 그린
// 나머지 8개 옆에 두면 혼자 굵고 진하게 보여 "아이콘 스타일을 서로
// 통일한다"는 요구와 어긋난다.
//
// BoxIcon/HandboxIcon(분실물/습득물 탭)의 3D 상자 실루엣도 의도적으로
// 피했다 -- 그 둘은 게시판 정체성을 가리키는 아이콘이라, 카테고리
// 하나("기타")가 같은 모양을 쓰면 의미가 겹친다.

// 전자기기 -- 헤드폰
export function HeadphonesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" />
      <path d="M4.5 14.5h2a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-1a2 2 0 0 1-2-2z" />
      <path d="M19.5 14.5h-2a1 1 0 0 0-1 1v3.5a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2z" />
    </svg>
  );
}

// 필기구 -- 연필
export function PenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7.5 18.5l-4 1 1-4z" />
      <path d="m14.5 5.5 3 3" />
    </svg>
  );
}

// 책
export function BookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M19.5 16.5V4.5A1.5 1.5 0 0 0 18 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21H18a1.5 1.5 0 0 0 1.5-1.5v-3" />
      <path d="M5 18.5A2.5 2.5 0 0 1 7.5 16h12" />
    </svg>
  );
}

// 지갑 -- 오른쪽 걸쇠로 카드와 구분된다
export function WalletIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h10.5a1 1 0 0 1 1 1v1.5" />
      <rect x="3.5" y="8.5" width="17" height="11" rx="2.5" />
      <path d="M20.5 12.5h-3.25a2.25 2.25 0 0 0 0 4.5h3.25" />
    </svg>
  );
}

// 카드 -- 자기띠 한 줄로 지갑과 구분된다
export function CardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h3.5" />
    </svg>
  );
}

// 의류 -- 티셔츠
export function ShirtIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 3.5 12 6.2l3-2.7 4.4 2.1a1 1 0 0 1 .54 1.13l-.83 3.32a1 1 0 0 1-1.3.71L16.5 10.2v9.3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.3l-1.31.46a1 1 0 0 1-1.3-.71L4.06 6.63A1 1 0 0 1 4.6 5.5z" />
    </svg>
  );
}

// 가방
export function BagIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.6 8.5h12.8a1.5 1.5 0 0 1 1.49 1.66l-.82 7.5A2.5 2.5 0 0 1 16.59 20H7.41a2.5 2.5 0 0 1-2.48-2.24l-.82-7.5A1.5 1.5 0 0 1 5.6 8.5z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  );
}

// 액세서리 -- 반지
export function RingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="15" r="5" />
      <path d="M9.6 6.8 12 3.5l2.4 3.3-2.4 3.2z" />
    </svg>
  );
}

// 기타 -- 2x2 격자("그 외 분류")
export function GridIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}
