import LogoMark from "@/components/LogoMark";

export const metadata = { title: "크레딧 · 명지 분실물 센터" };

const TEAM = [
  {
    name: "박지환",
    role: "Product · Planning",
    items: [
      "서비스 정책·화면 흐름 설계 (분실·습득 게시, 온보딩)",
      "신고·제재 기준과 이의신청 프로세스 정의",
      "인문·자연 캠퍼스 도메인 분리 정책",
      "이용약관·개인정보 처리방침 초안, 동의 게이트 기획",
      "베타 운영 범위(@mju.ac.kr · @gmail.com) 설계",
    ],
  },
  {
    name: "윤성민",
    role: "Architecture · Backend",
    items: [
      "PostgreSQL 스키마 설계 (게시글·채팅·신고·문의·알림)",
      "Supabase Auth + Row Level Security 정책",
      "Realtime 채팅 — postgres_changes 구독, 읽음 처리",
      "명지도 신뢰 점수 로직 (거래 완료·신고 반영)",
      "관리자 도구, 계정 삭제 시 외래키 정리",
    ],
  },
  {
    name: "조현석",
    role: "AI · Infrastructure",
    items: [
      "bge-m3 임베딩 파이프라인 (1024차원, 비동기 생성)",
      "코사인 유사도 기반 의미 검색·자동 매칭 랭킹",
      "Llama 3.2 Vision 이미지 인식 → 텍스트 검색",
      "Cloudflare Workers AI 연동, Vercel 서울 리전 배포",
      "전체 알림·공지 브로드캐스트 처리",
    ],
  },
  {
    name: "김준형",
    role: "Frontend · QA",
    items: [
      "Next.js App Router 화면 구현 (서버 컴포넌트·액션)",
      "반응형·다크모드 UI, 이미지 라이트박스, 스와이프 제스처",
      "KST 시간대 처리, iOS 입력 확대 방지 등 모바일 대응",
      "기능별 체크리스트 + DB 정합성 통합 QA",
      "빈 상태·에러 화면, 접근성 정리",
    ],
  },
];

const STACK = [
  ["프론트엔드", "Next.js 16 · App Router · React Server Components"],
  ["백엔드 · 데이터", "Supabase — PostgreSQL, Auth, Storage, Realtime"],
  ["AI", "Cloudflare Workers AI — bge-m3 임베딩, Llama 3.2 Vision"],
  ["검색 · 매칭", "코사인 유사도 + 카테고리·장소·시간 가중치"],
  ["배포", "Vercel (icn1 · 서울 리전)"],
];

export default function CreditsPage() {
  return (
    <div className="space-y-6">
      <section className="brand-wash card p-7 text-center">
        <LogoMark size={48} rounded="rounded-xl" className="mx-auto" />
        <h1 className="mt-3 text-xl font-extrabold">명지 스마트 분실물 센터</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          바이브코딩 경진대회 출품작
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">소개</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          명지대학교 학생들이 교내에서 잃어버리거나 주운 물건을 등록하고, AI가
          의미를 분석해 자동으로 매칭한 뒤 채팅으로 되찾을 수 있도록 만든
          서비스예요. 인문·자연 캠퍼스를 분리해 관리하고, 사진이나 문장으로도
          검색할 수 있어요.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">공동 개발자</h2>
        <p className="mt-1 text-sm text-ink-faint">
          재학생 네 명이 바이브코딩 경진대회를 위해 만들었어요.
        </p>
        <ul className="mt-3 divide-y divide-line-soft">
          {TEAM.map(({ name, role, items }) => (
            <li key={name} className="flex gap-3 py-4 first:pt-0 last:pb-0">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-bold text-brand-deep">
                {name[0]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-semibold">{name}</span>
                  <span className="text-xs font-semibold tracking-tight text-ink-faint">
                    {role}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {items.map((it) => (
                    <li
                      key={it}
                      className="relative pl-3 text-[13px] leading-relaxed text-ink-soft before:absolute before:left-0 before:top-[0.5em] before:h-1 before:w-1 before:rounded-full before:bg-ink-faint"
                    >
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">기술</h2>
        <ul className="mt-2 divide-y divide-line-soft">
          {STACK.map(([k, v]) => (
            <li
              key={k}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm"
            >
              <span className="text-ink-faint">{k}</span>
              <span className="font-semibold">{v}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-center text-xs text-ink-faint">
        © {new Date().getFullYear()} 명지 스마트 분실물 센터
      </p>
    </div>
  );
}
