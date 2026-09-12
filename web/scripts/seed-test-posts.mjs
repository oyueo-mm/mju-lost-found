// 실행: node --env-file=.env.local scripts/seed-test-posts.mjs
// 매칭 테스트용 샘플 게시글을 넣는다. (기존 로그인 유저 소유로)
import { createClient } from "@supabase/supabase-js";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: profile } = await s
  .from("profiles")
  .select("id")
  .limit(1)
  .single();
const uid = profile.id;
const now = Date.now();
const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();

const lost = [
  {
    title: "검은색 에어팟 프로 2세대",
    description: "왼쪽 이어버드에 잔기스, 케이스는 흰색이고 하단에 파란 스티커 붙어있어요.",
    category: "전자기기",
    location: "공학관",
    lost_at: iso(2),
  },
  {
    title: "빨간색 스타벅스 텀블러",
    description: "500ml 스테인리스, 뚜껑에 이빨자국 있음. 스터디카페에서 잃어버림.",
    category: "기타",
    location: "방목학술정보관(도서관)",
    lost_at: iso(1),
  },
  {
    title: "명지대 학생증",
    description: "인공지능소프트웨어융합대학, 이름 윤OO. 카드지갑째로 잃어버렸어요.",
    category: "신분증",
    location: "학생회관",
    lost_at: iso(3),
  },
];

const found = [
  {
    title: "무선 이어폰 주웠습니다",
    description: "검정색 애플 이어폰 같아요. 공대 건물 1층 벤치에 있었습니다. 케이스 흰색.",
    category: "전자기기",
    location: "공학관",
    found_at: iso(1),
  },
  {
    title: "텀블러 습득 (빨강)",
    description: "빨간색 보온병, 브랜드 로고 있음. 도서관 열람실 앞에서 주웠어요.",
    category: "기타",
    location: "방목학술정보관(도서관)",
    found_at: iso(1),
  },
  {
    title: "검정 우산 놓고 가신 분",
    description: "3단 자동우산, 손잡이 나무. 셔틀버스 정류장에 있었습니다.",
    category: "우산",
    location: "셔틀버스 정류장",
    found_at: iso(0),
  },
];

const { error: e1 } = await s
  .from("lost_posts")
  .insert(lost.map((p) => ({ ...p, user_id: uid })));
const { error: e2 } = await s
  .from("found_posts")
  .insert(found.map((p) => ({ ...p, user_id: uid })));

console.log("lost:", e1?.message || `${lost.length}건`);
console.log("found:", e2?.message || `${found.length}건`);
