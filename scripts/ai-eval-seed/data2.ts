// 3차 추가분 (append-only): 기존 Preview 게시글 37개는 건드리지 않고
// 정답쌍 16개(신규 8 + data.ts에 정의만 돼 있던 8개 재사용), hard negative
// 20개(신규 14 + 재사용 6), 대응 정답이 없는 no-match 게시글 10개를 추가한다.
import { NEGATIVES, PAIRS, type Board, type ImageSpec, type Negative, type Pair, type PostSpec } from "./data";

const D = 24;

export const NEW_PAIRS: Pair[] = [
  {
    pairId: "Q01",
    itemType: "안경",
    difficulty: "medium",
    locationRelation: "same_building_other_spot",
    timeRelation: "hours",
    keyClues: ["검정 뿔테 ≈ 검은 테", "왼쪽 다리 휨 ≈ 안경다리 틀어짐", "함박관 3층"],
    lost: {
      title: "안경 분실 (검정 뿔테)",
      description:
        "도수 높은 검정 뿔테 안경이에요. 함박관 3층 강의실에서 시험 끝나고 벗어두고 나온 것 같아요. 왼쪽 다리 끝이 살짝 휘어 있어요.",
      category: "액세서리",
      campus: "자연캠퍼스",
      location: "함박관(Y9)",
      createdAgoH: 6 * D,
      eventGapH: 3,
      image: { kind: "glasses", color: "#1b1b1b", background: "desk", rotate: -6, scale: 0.95, skew: 0, dx: 0, dy: 0, light: 0.3 },
    },
    found: {
      title: "강의실 책상에 안경이 있었어요",
      description:
        "함박관 3층 강의실 맨 앞줄 책상에 검은 테 안경이 놓여 있었어요. 한쪽 안경다리가 조금 틀어져 있어서 조심히 보관 중입니다. 과사무실에 맡겼어요.",
      category: "액세서리",
      campus: "자연캠퍼스",
      location: "함박관(Y9)",
      createdAgoH: 6 * D - 4,
      eventGapH: 1,
      image: { kind: "glasses", color: "#1b1b1b", background: "whiteTable", rotate: 14, scale: 0.85, skew: 6, dx: 10, dy: 5, light: -0.1 },
    },
  },
  {
    pairId: "Q02",
    itemType: "보조배터리",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["흰색 샤오미 보조배터리", "C타입 케이블", "명진당 2층 열람실"],
    lost: {
      title: "흰색 보조배터리 잃어버렸어요",
      description: "샤오미 흰색 보조배터리에 C타입 케이블이 꽂혀 있어요. 명진당 2층 열람실 콘센트 근처에서 잃어버렸습니다.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 2 * D + 7,
      eventGapH: 2,
      image: { kind: "powerBank", color: "#f3f3f0", accent: "#e8e8e8", background: "desk", rotate: 10, scale: 0.9, skew: 0, dx: -30, dy: 0, light: 0.3 },
    },
    found: {
      title: "보조배터리 주웠습니다 (흰색)",
      description: "명진당 2층 열람실 자리에 흰색 샤오미 보조배터리가 케이블이랑 같이 있었어요. 1층 데스크에 맡겼어요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 2 * D + 4,
      eventGapH: 1,
      image: { kind: "powerBank", color: "#f3f3f0", accent: "#e8e8e8", background: "carpet", rotate: -24, scale: 0.8, skew: 5, dx: -20, dy: 10, light: 0.0 },
    },
  },
  {
    pairId: "Q03",
    itemType: "마우스",
    difficulty: "hard",
    locationRelation: "adjacent",
    timeRelation: "within_day",
    keyClues: ["로지텍 ≈ logi 로고", "흑연색 ≈ 어두운 회색", "수신기 없이 마우스만", "제4공학관 ↔ 제3공학관"],
    lost: {
      title: "무소음 마우스 찾습니다",
      description:
        "로지텍 무선 마우스인데 클릭 소리가 안 나는 모델이에요. 색은 흑연색 같은 짙은 회색이고, USB 수신기는 노트북에 꽂혀 있어서 마우스만 없어졌어요. 제4공학관 실습실에서 쓴 게 마지막이에요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제4공학관(Y13)",
      createdAgoH: 11 * D,
      eventGapH: 6,
      image: { kind: "mouse", color: "#3a3c40", background: "desk", rotate: -15, scale: 1.0, skew: 0, dx: 0, dy: 0, light: 0.25 },
    },
    found: {
      title: "실습실 서랍에서 마우스 발견",
      description: "제3공학관 실습실 책상 서랍에 어두운 회색 무선 마우스가 들어 있었어요. 수신기는 없고 바닥에 logi 로고가 있어요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제3공학관(Y19)",
      createdAgoH: 10 * D + 6,
      eventGapH: 3,
      image: { kind: "mouse", color: "#3a3c40", background: "concrete", rotate: 30, scale: 0.9, skew: -6, dx: 10, dy: 0, light: -0.2 },
    },
  },
  {
    pairId: "Q04",
    itemType: "전공서적",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["초록색 ≈ 녹색 표지", "경영통계학 ≈ 통계 교재", "포스트잇 ≈ 형광 포스트잇", "미래관 스터디룸"],
    lost: {
      title: "경영통계 전공책 잃어버렸어요",
      description: "초록색 표지 경영통계학 책이에요. 앞쪽 몇 장에 포스트잇이 잔뜩 붙어 있어요. 미래관 스터디룸에서 두고 나온 것 같습니다.",
      category: "책",
      campus: "인문캠퍼스",
      location: "미래관(S3)",
      createdAgoH: 8 * D,
      eventGapH: 2,
    },
    found: {
      title: "통계 교재 한 권 보관 중",
      description: "미래관 2층 스터디룸 책장 위에 녹색 표지 통계 책이 남아 있었어요. 형광 포스트잇이 여러 장 붙어 있습니다.",
      category: "책",
      campus: "인문캠퍼스",
      location: "미래관(S3)",
      createdAgoH: 8 * D - 5,
      eventGapH: 2,
    },
  },
  {
    pairId: "Q05",
    itemType: "USB",
    difficulty: "hard",
    locationRelation: "same_building_other_spot",
    timeRelation: "hours",
    keyClues: ["빨간색 ≈ 붉은색", "USB ≈ USB 메모리", "발표 후 안 뽑음 ≈ 교탁 PC에 꽂힌 채", "베리타스홀"],
    lost: {
      title: "발표 자료 든 USB 급하게 찾아요",
      description:
        "빨간색 샌디스크 USB인데 조별과제 발표 파일이 들어 있어요. 오늘 베리타스홀에서 발표하고 나서 노트북에서 뽑은 기억이 없어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "베리타스홀",
      createdAgoH: 22,
      eventGapH: 4,
    },
    found: {
      title: "교탁 컴퓨터에 꽂혀 있던 USB",
      description: "베리타스홀 강의실 교탁 PC 뒤쪽에 붉은색 USB 메모리가 꽂힌 채로 있어서 뽑아서 보관 중이에요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "베리타스홀",
      createdAgoH: 18,
      eventGapH: 2,
    },
  },
  {
    pairId: "Q06",
    itemType: "계산기",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["카시오 공학용 계산기", "뒷면 노란 스티커", "제2공학관"],
    lost: {
      title: "공학용 계산기 잃어버렸어요",
      description: "카시오 fx-570 공학용 계산기예요. 뒷면에 작은 노란 스티커가 붙어 있어요. 제2공학관에서 시험 끝나고 잃어버렸어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "제2공학관(Y8)",
      createdAgoH: 4 * D + 3,
      eventGapH: 2,
      image: { kind: "calculator", accent: "#f5c542", background: "desk", rotate: 8, scale: 0.9, skew: 0, dx: 0, dy: 0, light: 0.3 },
    },
    found: {
      title: "카시오 계산기 주웠어요",
      description: "제2공학관 2층 강의실에서 카시오 공학용 계산기를 주웠어요. 노란 스티커가 붙어 있어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "제2공학관(Y8)",
      createdAgoH: 4 * D,
      eventGapH: 1,
      image: { kind: "calculator", accent: "#f5c542", background: "floor", rotate: -20, scale: 0.8, skew: 6, dx: 0, dy: 10, light: -0.15 },
    },
  },
  {
    pairId: "Q07",
    itemType: "목도리",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["빨강·초록 체크 ≈ 레드·그린 타탄체크", "목도리 ≈ 머플러", "학생회관 식당"],
    lost: {
      title: "체크무늬 목도리 분실",
      description: "빨강이랑 초록 체크무늬 울 목도리예요. 학생회관 식당에서 밥 먹고 의자에 걸어두고 나왔어요.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 15 * D,
      eventGapH: 2,
    },
    found: {
      title: "타탄체크 머플러 보관 중",
      description: "학생회관 지하 식당 의자에 레드·그린 타탄체크 머플러가 걸려 있어서 식당 카운터에 맡겼습니다.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 15 * D - 3,
      eventGapH: 1,
    },
  },
  {
    pairId: "Q08",
    itemType: "모자",
    difficulty: "hard",
    locationRelation: "same",
    timeRelation: "within_day",
    keyClues: ["검은색 볼캡 ≈ 까만 야구모자", "흰색 자수 로고 ≈ 하얀 글씨 자수", "운동장 벤치"],
    lost: {
      title: "검은 볼캡 잃어버렸어요",
      description: "앞에 작은 흰색 자수 로고가 있는 검은색 볼캡이에요. 운동장에서 풋살하고 벤치에 벗어뒀는데 깜빡했어요.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "운동장",
      createdAgoH: 3 * D,
      eventGapH: 5,
    },
    found: {
      title: "벤치에 모자 하나",
      description: "운동장 옆 벤치에 까만 야구모자가 놓여 있었어요. 챙 부분이 좀 닳았고 정면에 하얀 글씨 자수가 있어요.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "운동장",
      createdAgoH: 2 * D + 12,
      eventGapH: 3,
    },
  },
];

// data.ts에 정의만 돼 있고 아직 Preview에 넣지 않은 정답쌍.
export const REUSED_PAIR_IDS = ["P06", "P13", "P22", "P25", "P26", "P27", "P29", "P30"];
export const REUSED_NEG_IDS = ["N08", "N30", "N32", "N33", "N35", "N36"];

// 재사용 게시글 중 이미지를 붙이는 것 (곰돌이 키링 ↔ 토끼 키링).
export const REUSED_IMAGES: Record<string, ImageSpec> = {
  "P26-lost": { kind: "keysCharm", charm: "bear", keyCount: 1, background: "desk", rotate: 12, scale: 0.85, skew: 0, dx: 20, dy: 0, light: 0.3 },
  "P26-found": { kind: "keysCharm", charm: "bear", keyCount: 1, background: "floor", rotate: -28, scale: 0.8, skew: 5, dx: 20, dy: 10, light: -0.15 },
  N32: { kind: "keysCharm", charm: "rabbit", keyCount: 1, background: "floor", rotate: 20, scale: 0.8, skew: -4, dx: 20, dy: 10, light: -0.1 },
};

// Unseen third views for image-search re-checks.
export const NEW_QUERY_IMAGES: Record<string, ImageSpec> = {
  Q01: { kind: "glasses", color: "#1b1b1b", background: "carpet", rotate: 25, scale: 0.85, skew: -5, dx: 0, dy: 0, light: 0.05 },
  Q02: { kind: "powerBank", color: "#f3f3f0", accent: "#e8e8e8", background: "whiteTable", rotate: 35, scale: 0.8, skew: 0, dx: -30, dy: 0, light: 0.1 },
  Q03: { kind: "mouse", color: "#3a3c40", background: "whiteTable", rotate: 70, scale: 0.9, skew: 4, dx: 0, dy: 0, light: 0.0 },
  Q06: { kind: "calculator", accent: "#f5c542", background: "concrete", rotate: 30, scale: 0.8, skew: -4, dx: 0, dy: 0, light: 0.05 },
  P26: { kind: "keysCharm", charm: "bear", keyCount: 1, background: "carpet", rotate: 40, scale: 0.8, skew: 0, dx: 20, dy: 0, light: 0.0 },
};

export const NEW_NEGATIVES: Negative[] = [
  {
    negId: "H01", itemType: "안경", board: "found", confusableWith: ["Q01"],
    whyNotMatch: "같은 건물 안경이지만 얇은 금테",
    post: {
      title: "금테 안경 주웠어요", description: "함박관 1층 로비 의자에 얇은 금색 테 안경이 있었어요. 안경집은 없어요.",
      category: "액세서리", campus: "자연캠퍼스", location: "함박관(Y9)", createdAgoH: 5 * D + 10, eventGapH: 2,
      image: { kind: "glasses", color: "#c9a44c", variant: "clean", background: "whiteTable", rotate: -10, scale: 0.85, skew: 3, dx: 0, dy: 5, light: -0.05 },
    },
  },
  {
    negId: "H02", itemType: "선글라스", board: "found", confusableWith: ["Q01"],
    whyNotMatch: "검은 뿔테지만 갈색 렌즈 선글라스이고 다른 건물",
    post: {
      title: "검은 뿔테 선글라스 습득", description: "제2공학관 앞 벤치에서 검은 뿔테 선글라스를 주웠어요. 렌즈가 짙은 갈색이에요.",
      category: "액세서리", campus: "자연캠퍼스", location: "제2공학관(Y8)", createdAgoH: 7 * D + 2, eventGapH: 3,
    },
  },
  {
    negId: "H03", itemType: "보조배터리", board: "found", confusableWith: ["Q02"],
    whyNotMatch: "같은 건물 보조배터리지만 검은색이고 케이블 없음",
    post: {
      title: "검은색 보조배터리 주웠어요", description: "명진당 1층 휴게실에서 검은색 보조배터리를 주웠어요. 케이블은 없어요.",
      category: "전자기기", campus: "자연캠퍼스", location: "명진당(Y3)", createdAgoH: 3 * D + 2, eventGapH: 2,
      image: { kind: "powerBank", color: "#232427", background: "carpet", rotate: -12, scale: 0.8, skew: 3, dx: 0, dy: 10, light: 0.0 },
    },
  },
  {
    negId: "H04", itemType: "보조배터리", board: "lost", confusableWith: ["Q02"],
    whyNotMatch: "같은 건물 보조배터리 분실이지만 분홍 맥세이프형",
    post: {
      title: "분홍 맥세이프 배터리 분실", description: "명진당 열람실에서 휴대폰 뒤에 붙이는 분홍색 맥세이프 보조배터리를 잃어버렸어요.",
      category: "전자기기", campus: "자연캠퍼스", location: "명진당(Y3)", createdAgoH: 2 * D + 20, eventGapH: 3,
    },
  },
  {
    negId: "H05", itemType: "마우스", board: "found", confusableWith: ["Q03"],
    whyNotMatch: "인접 건물 무선 마우스지만 흰색이고 수신기까지 있음",
    post: {
      title: "흰색 무선 마우스 습득", description: "제4공학관 1층 라운지에서 흰색 무선 마우스를 주웠어요. USB 수신기도 같이 꽂혀 있어요.",
      category: "전자기기", campus: "자연캠퍼스", location: "제4공학관(Y13)", createdAgoH: 9 * D + 4, eventGapH: 2,
      image: { kind: "mouse", color: "#eeeeea", accent: "#2b2b2b", background: "concrete", rotate: -18, scale: 0.9, skew: 3, dx: -20, dy: 0, light: -0.1 },
    },
  },
  {
    negId: "H06", itemType: "마우스", board: "lost", confusableWith: ["Q03"],
    whyNotMatch: "같은 공대 실습실 마우스 분실이지만 유선 RGB 게이밍 마우스",
    post: {
      title: "게이밍 마우스 잃어버렸어요", description: "제3공학관 실습실에서 RGB 불 들어오는 검은 유선 게이밍 마우스를 잃어버렸어요.",
      category: "전자기기", campus: "자연캠퍼스", location: "제3공학관(Y19)", createdAgoH: 10 * D + 20, eventGapH: 4,
    },
  },
  {
    negId: "H07", itemType: "전공서적", board: "found", confusableWith: ["Q04"],
    whyNotMatch: "같은 건물 초록 표지 책이지만 경제학원론이고 필기 없음",
    post: {
      title: "초록 표지 경제학원론 주웠어요", description: "미래관 1층 로비에 초록색 표지 경제학원론 책이 있었어요. 필기는 거의 없어요.",
      category: "책", campus: "인문캠퍼스", location: "미래관(S3)", createdAgoH: 7 * D + 18, eventGapH: 3,
    },
  },
  {
    negId: "H08", itemType: "USB", board: "found", confusableWith: ["Q05"],
    whyNotMatch: "같은 건물 USB지만 파란색이고 복도에서 주움",
    post: {
      title: "파란 USB 주웠어요", description: "베리타스홀 복도에서 파란색 USB를 주웠어요. 키링 고리가 달려 있어요.",
      category: "전자기기", campus: "인문캠퍼스", location: "베리타스홀", createdAgoH: 30, eventGapH: 2,
    },
  },
  {
    negId: "H09", itemType: "계산기", board: "found", confusableWith: ["Q06"],
    whyNotMatch: "같은 건물 계산기지만 공학용이 아닌 큰 버튼 사무용",
    post: {
      title: "일반 계산기 습득", description: "제2공학관 매점 앞에서 큰 버튼 달린 일반 사무용 계산기를 주웠어요.",
      category: "기타", campus: "자연캠퍼스", location: "제2공학관(Y8)", createdAgoH: 5 * D, eventGapH: 2,
    },
  },
  {
    negId: "H10", itemType: "목도리", board: "found", confusableWith: ["Q07"],
    whyNotMatch: "같은 건물 목도리지만 회색 니트, 무늬 없음",
    post: {
      title: "회색 목도리 주웠어요", description: "학생회관 2층 라운지 소파에 회색 니트 목도리가 있었어요.",
      category: "의류", campus: "인문캠퍼스", location: "학생회관(S2)", createdAgoH: 14 * D, eventGapH: 2,
    },
  },
  {
    negId: "H11", itemType: "모자", board: "found", confusableWith: ["Q08"],
    whyNotMatch: "같은 장소 검은 모자지만 니트 비니",
    post: {
      title: "검은색 비니 습득", description: "운동장 스탠드 계단에 검은색 니트 비니가 떨어져 있었어요.",
      category: "의류", campus: "인문캠퍼스", location: "운동장", createdAgoH: 2 * D + 3, eventGapH: 2,
    },
  },
  {
    negId: "H12", itemType: "노트북", board: "found", confusableWith: ["P13"],
    whyNotMatch: "같은 건물 노트북이지만 은색 삼성 갤럭시북",
    post: {
      title: "은색 노트북 보관 중", description: "제3공학관 2층 스터디룸에 은색 삼성 갤럭시북이 남아 있어서 조교실에 맡겼어요.",
      category: "전자기기", campus: "자연캠퍼스", location: "제3공학관(Y19)", createdAgoH: 7 * D + 20, eventGapH: 3,
    },
  },
  {
    negId: "H13", itemType: "열쇠", board: "found", confusableWith: ["P25", "P27"],
    whyNotMatch: "같은 생활관 열쇠 링이지만 열쇠 두 개, 장식 없음",
    post: {
      title: "열쇠 두 개 달린 링", description: "생활관 세탁실 앞에서 열쇠 두 개가 달린 링을 주웠어요. 장식은 없어요.",
      category: "기타", campus: "인문캠퍼스", location: "생활관(S8)", createdAgoH: 3 * D + 20, eventGapH: 2,
    },
  },
  {
    negId: "H14", itemType: "후드집업", board: "found", confusableWith: ["P22"],
    whyNotMatch: "같은 건물 후드집업이지만 네이비색",
    post: {
      title: "네이비 후드집업 주웠어요", description: "창조예술관 2층 복도에 네이비색 후드집업이 걸려 있었어요.",
      category: "의류", campus: "자연캠퍼스", location: "창조예술관(Y2)", createdAgoH: 4 * D + 14, eventGapH: 2,
    },
  },
];

// 대응되는 정답이 아예 없는 게시글 -- 추천/검색이 억지로 비슷한 물건을
// 끌어오는지 보기 위한 것.
export const NO_MATCH: { noMatchId: string; board: Board; nearestTheme: string; post: PostSpec }[] = [
  { noMatchId: "M01", board: "lost", nearestTheme: "갈색 가죽 소품",
    post: { title: "손목시계 잃어버렸어요", description: "갈색 가죽 줄 손목시계예요. 체육관 샤워실 들어가기 전에 풀어뒀다가 잃어버렸어요.", category: "액세서리", campus: "자연캠퍼스", location: "체육관(Y7)", createdAgoH: 9 * D, eventGapH: 3 } },
  { noMatchId: "M02", board: "found", nearestTheme: "카메라 소품",
    post: { title: "카메라 렌즈캡 주웠어요", description: "디자인조형센터 앞 계단에서 카메라 렌즈 뚜껑을 주웠어요. 캐논 로고가 있어요.", category: "기타", campus: "자연캠퍼스", location: "디자인조형센터(Y12)", createdAgoH: 12 * D, eventGapH: 2 } },
  { noMatchId: "M03", board: "found", nearestTheme: "헤어 소품",
    post: { title: "집게핀 주웠어요", description: "국제관 화장실 앞에서 갈색 대리석 무늬 집게핀을 주웠어요.", category: "액세서리", campus: "인문캠퍼스", location: "국제관(S4)", createdAgoH: 20 * D, eventGapH: 1 } },
  { noMatchId: "M04", board: "lost", nearestTheme: "은색 액세서리",
    post: { title: "은반지 분실", description: "MCC관 화장실에서 손 씻다가 얇은 은반지를 빼놓고 나왔어요.", category: "액세서리", campus: "인문캠퍼스", location: "MCC관(S10)", createdAgoH: 26 * D, eventGapH: 2 } },
  { noMatchId: "M05", board: "found", nearestTheme: "회색 생활용품",
    post: { title: "목베개 습득", description: "생활관 로비 소파에 회색 U자 목베개가 있었어요.", category: "기타", campus: "자연캠퍼스", location: "생활관(Y30~35)", createdAgoH: 17 * D, eventGapH: 3 } },
  { noMatchId: "M06", board: "lost", nearestTheme: "노트북 관련",
    post: { title: "노트북 거치대 두고 왔어요", description: "알루미늄 접이식 노트북 거치대를 함박관 강의실에 두고 나왔어요.", category: "전자기기", campus: "자연캠퍼스", location: "함박관(Y9)", createdAgoH: 5 * D + 6, eventGapH: 2 } },
  { noMatchId: "M07", board: "found", nearestTheme: "운동용품",
    post: { title: "줄넘기 주웠어요", description: "체육문화관 앞 잔디밭에서 파란 손잡이 줄넘기를 주웠어요.", category: "기타", campus: "자연캠퍼스", location: "체육문화관(Y6)", createdAgoH: 24 * D, eventGapH: 4 } },
  { noMatchId: "M08", board: "lost", nearestTheme: "우산류",
    post: { title: "베이지 양산 잃어버렸어요", description: "베이지색 접이식 양산을 정문 근처 벤치에 두고 왔어요.", category: "기타", campus: "인문캠퍼스", location: "정문", createdAgoH: 29 * D, eventGapH: 2 } },
  { noMatchId: "M09", board: "found", nearestTheme: "소형 전자기기",
    post: { title: "손선풍기 주웠어요", description: "강경대민주광장 벤치에 하늘색 손선풍기가 놓여 있었어요.", category: "전자기기", campus: "인문캠퍼스", location: "강경대민주광장", createdAgoH: 27 * D, eventGapH: 2 } },
  { noMatchId: "M10", board: "lost", nearestTheme: "서류/문서",
    post: { title: "서류 든 L자 파일 분실", description: "국제관 행정실 가는 길에 투명 L자 파일을 잃어버렸어요. 안에 교환학생 신청 서류가 들어 있어요.", category: "기타", campus: "인문캠퍼스", location: "국제관(S4)", createdAgoH: 19 * D, eventGapH: 1 } },
];

export type Job = { key: string; board: Board; spec: PostSpec };

export function allJobs(): Job[] {
  const jobs: Job[] = [];
  for (const pair of NEW_PAIRS) {
    jobs.push({ key: `${pair.pairId}-lost`, board: "lost", spec: pair.lost });
    jobs.push({ key: `${pair.pairId}-found`, board: "found", spec: pair.found });
  }
  for (const id of REUSED_PAIR_IDS) {
    const pair = PAIRS.find((p) => p.pairId === id)!;
    for (const side of ["lost", "found"] as const) {
      const key = `${id}-${side}`;
      jobs.push({ key, board: side, spec: { ...pair[side], image: REUSED_IMAGES[key] ?? pair[side].image } });
    }
  }
  for (const id of REUSED_NEG_IDS) {
    const neg = NEGATIVES.find((n) => n.negId === id)!;
    jobs.push({ key: id, board: neg.board, spec: { ...neg.post, image: REUSED_IMAGES[id] ?? neg.post.image } });
  }
  for (const neg of NEW_NEGATIVES) jobs.push({ key: neg.negId, board: neg.board, spec: neg.post });
  for (const m of NO_MATCH) jobs.push({ key: m.noMatchId, board: m.board, spec: m.post });
  return jobs;
}
