export const CATEGORIES = [
  "전자기기",
  "지갑/카드",
  "신분증",
  "현금",
  "의류",
  "가방",
  "열쇠",
  "도서/필기구",
  "액세서리",
  "화장품",
  "우산",
  "운동용품",
  "기타",
];

export const LOCATIONS = [
  "방목학술정보관(도서관)",
  "학생회관",
  "본관",
  "경상관",
  "공학관",
  "자연과학대",
  "사회과학대",
  "인문과학대",
  "MCC",
  "채플",
  "기숙사",
  "체육관/운동장",
  "학생식당",
  "정문/후문",
  "셔틀버스 정류장",
  "기타",
];

// 게시판 종류별 설정. lost = 분실, found = 습득.
export const KIND_CONFIG = {
  lost: {
    kind: "lost",
    table: "lost_posts",
    label: "분실",
    icon: "search",
    intro:
      "잃어버린 물건을 신고하면 AI가 등록된 습득물과 매칭해 보여주고, 없으면 새 습득물이 올라올 때 알림을 드려요.",
    dateField: "lost_at",
    dateLabel: "잃어버린 시각",
    statuses: ["찾는 중", "찾음"],
    defaultStatus: "찾는 중",
    opposite: "found",
    // 시각 구분용 (분실 = 파랑, 습득 = 앰버)
    tint: "bg-brand-tint",
    tintText: "text-brand-deep",
    dot: "bg-brand",
  },
  found: {
    kind: "found",
    table: "found_posts",
    label: "습득",
    icon: "package",
    intro: "물건을 주웠어요. 등록하면 주인을 찾는 사람과 매칭해 드려요.",
    dateField: "found_at",
    dateLabel: "주운 시각",
    statuses: ["보관 중", "완료"],
    defaultStatus: "보관 중",
    opposite: "lost",
    tint: "bg-amber-tint",
    tintText: "text-amber-deep",
    dot: "bg-amber",
  },
};

export const EMBEDDING_DIM = 384; // multilingual MiniLM

export const REPORT_REASONS = [
  "허위/장난 게시글",
  "부적절한 내용",
  "욕설/비방",
  "사기 의심",
  "스팸/광고",
  "기타",
];

// 관리자가 계정 정지 시 고르는 사유 (미리 정의된 목록)
export const SUSPENSION_REASONS = [
  "욕설·비방·혐오 표현",
  "스팸·도배·광고",
  "사기·허위 거래",
  "부적절하거나 불쾌한 게시물",
  "타인 사칭·개인정보 침해",
  "반복적인 신고 누적",
  "기타 커뮤니티 규정 위반",
];
