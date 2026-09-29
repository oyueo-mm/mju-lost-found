// Additional (append-only) demo scenarios -- shared by render-extra-images.ts
// (sharp only) and add-extra.ts (DB/embedding only; see render-query-images.ts
// for why those two must run in separate processes).
export const EXTRA_SCENARIOS = [
  { name: "학생증", pairId: "P05", negIds: ["N05", "N06"] },
  { name: "갤럭시 버즈", pairId: "P09", negIds: ["N13"] },
  { name: "아이패드/태블릿", pairId: "P14", negIds: ["N18", "N19"] },
  { name: "노트북 충전기", pairId: "P15", negIds: ["N21"] },
  { name: "에코백", pairId: "P20", negIds: ["N26", "N27"] },
  { name: "텀블러", pairId: "P28", negIds: ["N34"] },
];

// Natural-language queries for re-checking each scenario (typed on the
// 습득물 board).
export const EXTRA_QUERIES: Record<string, string> = {
  P05: "공대 건물에서 긁힌 학생증 잃어버렸어요",
  P09: "갤럭시 버즈 오른쪽 한쪽만 잃어버렸어요",
  P14: "도서관에서 아이패드랑 펜슬 같이 잃어버렸어요",
  P15: "실습실에 맥북 충전기 두고 왔어요",
  P20: "전공책이랑 필통 들어있는 흰색 에코백",
  P28: "열람실에 파란 스탠리 텀블러 두고 나왔어요",
};
