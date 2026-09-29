// AI 평가/시연용 seed 데이터 정의 (Preview 전용).
//
// 모든 게시글은 사람이 직접 작성한 문장이며, Lost/Found 문장을 서로 복사하지
// 않았다. 장소는 src/lib/posts/campusLocations.ts의 공식 장소명을, 카테고리는
// src/lib/posts/schema.ts의 CATEGORIES를 그대로 사용한다. 실제 인물 이름,
// 학번, 전화번호는 쓰지 않는다.
//
// ground truth(정답쌍/난이도/hard negative 여부/시연 여부)는 이 파일과 seed
// 실행 후 생성되는 docs/ai-eval-seed/ground-truth.json에만 있고, 서비스 DB
// 스키마에는 어떤 컬럼도 추가하지 않는다.

export type Campus = "인문캠퍼스" | "자연캠퍼스";
export type Board = "lost" | "found";
export type Difficulty = "easy" | "medium" | "hard";
export type ImageKind =
  | "cardWallet"
  | "longWallet"
  | "studentCard"
  | "airpodsProCase"
  | "airpodsCase"
  | "phonePinkClearCase"
  | "phoneBlackLeather"
  | "clearCaseOnly"
  | "ipadWithPencil"
  | "galaxyTabKeyboard"
  | "clearUmbrellaWood"
  | "clearUmbrellaPlastic"
  | "ecoBagWithItems"
  | "ecoBagEmpty"
  | "glasses"
  | "powerBank"
  | "mouse"
  | "calculator"
  | "keysCharm"
  // batch 3
  | "budsCase"
  | "earphonesWired"
  | "bankCard"
  | "cardCase"
  | "laptop"
  | "charger"
  | "tumbler"
  | "cap";

export type Background = "desk" | "floor" | "whiteTable" | "bench" | "carpet" | "concrete";

export type ImageSpec = {
  kind: ImageKind;
  // Scene variant for the same physical object -- lets one object be shot
  // from a different angle/background/lighting on each board.
  background: Background;
  rotate: number;
  scale: number;
  skew: number;
  dx: number;
  dy: number;
  light: number; // -1 (dark/cool) .. 1 (bright/warm)
  // Object-level variant knobs (e.g. sticker color/position) so a decoy
  // can be drawn as a genuinely different object of the same kind.
  variant?: "default" | "greenSticker" | "clean" | "noSticker";
  // Main/accent colors and keyring charm for the later-added object kinds.
  color?: string;
  accent?: string;
  charm?: "bear" | "rabbit" | "none";
  keyCount?: number;
  // batch 3: cardCase drawn with a lanyard strap.
  strap?: boolean;
};

export type PostSpec = {
  title: string;
  description: string;
  category: string;
  campus: Campus;
  location: string | null;
  createdAgoH: number; // hours before seed time
  eventGapH: number | null; // lostAt/foundAt = createdAt - eventGapH; null = unknown
  status?: "찾는 중" | "찾음" | "보관 중" | "완료";
  image?: ImageSpec;
};

export type Pair = {
  pairId: string;
  itemType: string; // semantic item type (finer than DB category)
  difficulty: Difficulty;
  locationRelation: "same" | "adjacent" | "lost_unknown" | "same_building_other_spot";
  timeRelation: "hours" | "within_day" | "days" | "lost_time_unknown";
  keyClues: string[];
  lost: PostSpec;
  found: PostSpec;
};

export type Negative = {
  negId: string;
  itemType: string;
  board: Board;
  confusableWith: string[]; // pairIds
  whyNotMatch: string;
  demoAdjacentTo?: string; // demo scenario id
  post: PostSpec;
};

export type Filler = { fillerId: string; board: Board; post: PostSpec };

export type DemoScenario = {
  demoId: string;
  name: string;
  pairId: string;
  keyClues: string[];
  // Natural-language query to type into AI 검색 on the 습득물 board.
  searchQuery: string;
  // Which image file under docs/ai-eval-seed/query-images/ to upload for
  // the image-search part of the demo (a third, unseen view of the lost
  // item -- never one of the uploaded post images).
  queryImage: ImageSpec;
};

const H = 1;
const D = 24;

export const PAIRS: Pair[] = [
  // ---------- 지갑 ----------
  {
    pairId: "P01",
    itemType: "지갑",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["검은색", "카드지갑", "학생회관 2층", "체크카드·교통카드"],
    lost: {
      title: "검은색 카드지갑 잃어버렸어요",
      description:
        "학생회관 2층 라운지에서 과제하다가 두고 나온 것 같아요. 무광 검은색 카드지갑이고 안에 체크카드랑 교통카드가 들어 있습니다. 보신 분 연락 부탁드려요!",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 26 * H,
      eventGapH: 3,
      image: { kind: "cardWallet", background: "desk", rotate: -8, scale: 1.05, skew: 0, dx: -10, dy: 5, light: 0.3 },
    },
    found: {
      title: "검정 카드지갑 주웠습니다",
      description:
        "학생회관 2층 라운지 소파 옆에 검정색 카드지갑이 떨어져 있었어요. 카드 몇 장 들어 있는 것 같고 1층 안내데스크에 맡겨뒀습니다.",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 22 * H,
      eventGapH: 1.5,
      image: { kind: "cardWallet", background: "floor", rotate: 17, scale: 0.9, skew: -6, dx: 25, dy: 15, light: -0.2 },
    },
  },
  {
    pairId: "P02",
    itemType: "지갑",
    difficulty: "medium",
    locationRelation: "same_building_other_spot",
    timeRelation: "hours",
    keyClues: ["갈색 가죽", "반지갑", "국제관 3층", "학생증"],
    lost: {
      title: "갈색 반지갑을 찾고 있어요",
      description:
        "국제관 3층 강의실에서 수업 끝나고 가방 정리하다가 흘린 것 같아요. 갈색 가죽 반지갑이고 모서리가 좀 닳았어요. 안에 학생증이 있어요.",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "국제관(S4)",
      createdAgoH: 5 * D,
      eventGapH: 2,
    },
    found: {
      title: "국제관에서 반지갑 습득",
      description:
        "국제관 3층 복도 창가 턱에 반지갑이 놓여 있어서 보관 중입니다. 브라운 계열 가죽이고 오래 쓴 느낌이에요. 신분증 같은 카드가 꽂혀 있어요.",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "국제관(S4)",
      createdAgoH: 5 * D - 3,
      eventGapH: 1,
    },
  },
  {
    pairId: "P03",
    itemType: "지갑",
    difficulty: "hard",
    locationRelation: "adjacent",
    timeRelation: "within_day",
    keyClues: ["남색 ≈ 어두운 파란색", "반지갑", "금속 로고 ≈ 금속 장식", "명진당 ↔ 학생회관"],
    lost: {
      title: "지갑 분실 (남색)",
      description:
        "어제 오후에 명진당에서 공부하다 나왔는데 저녁에 보니 지갑이 없더라고요. 남색 반지갑이고 앞면에 작은 금속 로고가 붙어 있어요.",
      category: "지갑",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 9 * D,
      eventGapH: 8,
    },
    found: {
      title: "자판기 옆 의자에서 지갑 주움",
      description:
        "학생회관 1층 음료 자판기 옆 의자에 어두운 파란색 작은 지갑이 놓여 있었어요. 카드가 몇 장 꽂혀 있고 겉에 반짝이는 장식 같은 게 달려 있습니다.",
      category: "지갑",
      campus: "자연캠퍼스",
      location: "학생회관(Y1)",
      createdAgoH: 9 * D - 14,
      eventGapH: 2,
    },
  },
  // ---------- 카드 ----------
  {
    pairId: "P04",
    itemType: "카드(학생증)",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["실물 학생증", "방목학술정보관 출입 게이트"],
    lost: {
      title: "학생증 잃어버렸어요",
      description:
        "방목학술정보관 들어갈 때까지는 있었는데 나올 때 보니 없어요. 모바일 말고 실물 학생증입니다.",
      category: "카드",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 7 * D,
      eventGapH: 1,
    },
    found: {
      title: "학생증 주웠어요",
      description: "방목학술정보관 출입 게이트 앞 바닥에 학생증이 떨어져 있어서 주웠어요. 1층 데스크에 맡겼습니다.",
      category: "카드",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 7 * D - 2,
      eventGapH: 0.5,
    },
  },
  {
    pairId: "P05",
    itemType: "카드(학생증)",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["스크래치 많음 ≈ 많이 긁힘", "소프트웨어 계열 학과", "제5공학관"],
    lost: {
      title: "융합소프트웨어학부 학생증 분실",
      description:
        "스크래치가 많이 난 학생증이에요. 케이스 없이 들고 다녔고, 오늘 오전 제5공학관 실습 끝나고 잃어버린 것 같습니다.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "제5공학관(Y5)",
      createdAgoH: 30 * H,
      eventGapH: 4,
      image: { kind: "studentCard", background: "desk", rotate: -5, scale: 1.0, skew: 0, dx: 0, dy: 0, light: 0.25 },
    },
    found: {
      title: "공대 쪽에서 낡은 학생증 습득",
      description:
        "제5공학관 1층 엘리베이터 앞에서 학생증을 주웠어요. 겉면이 많이 긁혀 있고 소프트웨어 관련 학과 같습니다. 개인정보라 사진은 흐리게 올려요.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "제5공학관(Y5)",
      createdAgoH: 27 * H,
      eventGapH: 1,
      image: { kind: "studentCard", background: "concrete", rotate: 14, scale: 0.88, skew: 5, dx: 20, dy: -10, light: -0.3 },
    },
  },
  {
    pairId: "P06",
    itemType: "카드(체크카드)",
    difficulty: "hard",
    locationRelation: "adjacent",
    timeRelation: "within_day",
    keyClues: ["신한 체크카드 ≈ '신…'으로 시작하는 파란 은행 카드", "체육관 ↔ 체육문화관"],
    lost: {
      title: "지갑은 있는데 카드만 빠졌어요",
      description:
        "카드지갑에서 신한 체크카드 한 장만 없어졌어요. 체육관에서 운동하고 사물함 정리하다가 흘린 것 같습니다.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "체육관(Y7)",
      createdAgoH: 12 * D,
      eventGapH: 5,
    },
    found: {
      title: "체육문화관 앞에서 은행 카드 한 장",
      description:
        "체육문화관 입구 계단에서 파란색 계열 은행 카드를 주웠습니다. 카드사 이름은 일부만 적을게요, '신…'으로 시작해요.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "체육문화관(Y6)",
      createdAgoH: 12 * D - 9,
      eventGapH: 3,
    },
  },
  // ---------- 무선 이어폰 ----------
  {
    pairId: "P07",
    itemType: "무선 이어폰",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["흰색 에어팟", "종합관 강의실"],
    lost: {
      title: "흰색 에어팟 잃어버렸어요",
      description: "종합관 강의실에서 수업 듣고 나오면서 잃어버렸어요. 각인 같은 건 없고 기본 흰색 케이스입니다.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "종합관(S1)",
      createdAgoH: 4 * D,
      eventGapH: 2,
    },
    found: {
      title: "흰색 에어팟 주웠어요",
      description: "종합관 4층 강의실 뒷자리 책상 위에 흰색 에어팟이 있었어요. 과사무실에 맡겨뒀습니다.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "종합관(S1)",
      createdAgoH: 4 * D - 3,
      eventGapH: 1,
    },
  },
  {
    pairId: "P08",
    itemType: "무선 이어폰",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["에어팟 프로 ≈ 무선 이어폰", "파란색 스티커 ≈ 파란 스티커", "흰색"],
    lost: {
      title: "에어팟 프로 찾아요",
      description: "흰색 에어팟 프로를 잃어버렸어요. 케이스에 작은 파란색 스티커가 있습니다.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 9 * H,
      eventGapH: 2,
      image: { kind: "airpodsProCase", background: "desk", rotate: -12, scale: 1.05, skew: 0, dx: -15, dy: 0, light: 0.35 },
    },
    found: {
      title: "무선 이어폰 주웠습니다",
      description: "학생회관에서 파란 스티커가 붙은 흰색 무선 이어폰을 주웠습니다.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 6 * H,
      eventGapH: 1,
      image: { kind: "airpodsProCase", background: "bench", rotate: 20, scale: 0.85, skew: -8, dx: 30, dy: 20, light: -0.15 },
    },
  },
  {
    pairId: "P09",
    itemType: "무선 이어폰",
    difficulty: "hard",
    locationRelation: "adjacent",
    timeRelation: "within_day",
    keyClues: ["버즈 오른쪽 한쪽 ≈ 커널형 한 개", "짙은 회색", "제2공학관 ↔ 제1공학관"],
    lost: {
      title: "이어폰 한쪽만 잃어버렸어요",
      description:
        "갤럭시 버즈2 프로 오른쪽 한쪽이 없어졌어요. 색은 짙은 회색이고 케이스는 저한테 있어요. 제2공학관에서 쉬는 시간에 귀에서 빼놨다가 못 챙긴 것 같아요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제2공학관(Y8)",
      createdAgoH: 6 * D,
      eventGapH: 3,
    },
    found: {
      title: "강의실 책상 밑 무선이어폰 한 짝",
      description:
        "제1공학관 강의실 책상 밑에서 짙은 회색 커널형 이어폰 한 개를 주웠어요. 케이스는 없고 이어팁이 끼워져 있습니다.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제1공학관(Y_)",
      createdAgoH: 6 * D - 10,
      eventGapH: 4,
    },
  },
  // ---------- 휴대폰 ----------
  {
    pairId: "P10",
    itemType: "휴대폰",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["검은색 갤럭시", "케이스 없음", "명진당 열람실"],
    lost: {
      title: "갤럭시 휴대폰 잃어버렸어요",
      description: "갤럭시 S24 검은색이고 케이스는 없어요. 명진당 열람실에서 잃어버린 것 같습니다.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 3 * D,
      eventGapH: 1,
    },
    found: {
      title: "갤럭시 핸드폰 주웠어요",
      description: "명진당 2층 열람실 책상에 검은색 갤럭시 폰이 남아 있어서 1층 데스크에 맡겼어요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 3 * D - 2,
      eventGapH: 0.5,
    },
  },
  {
    pairId: "P11",
    itemType: "휴대폰",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["핑크 ≈ 연분홍", "투명 젤리 케이스", "케이스 안 영화 티켓 ≈ 종이", "MCC관"],
    lost: {
      title: "아이폰 15 분실 (투명 케이스)",
      description:
        "아이폰 15 핑크색이고 투명 젤리 케이스 끼워놨어요. 케이스 안쪽에 영화 티켓 한 장 넣어둔 게 보일 거예요. MCC관에서 잃어버렸습니다.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "MCC관(S10)",
      createdAgoH: 20 * H,
      eventGapH: 2,
      image: { kind: "phonePinkClearCase", background: "desk", rotate: 8, scale: 1.0, skew: 0, dx: 0, dy: 0, light: 0.3 },
    },
    found: {
      title: "투명 케이스 아이폰 습득",
      description:
        "MCC관 1층 카페 테이블에 연분홍색 아이폰이 있었어요. 투명 케이스 안에 종이 같은 게 끼워져 있습니다. 경비실에 맡겼어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "MCC관(S10)",
      createdAgoH: 16 * H,
      eventGapH: 1,
      image: { kind: "phonePinkClearCase", background: "whiteTable", rotate: -22, scale: 0.85, skew: 6, dx: -20, dy: 10, light: 0.0 },
    },
  },
  {
    pairId: "P12",
    itemType: "휴대폰",
    difficulty: "hard",
    locationRelation: "same_building_other_spot",
    timeRelation: "within_day",
    keyClues: ["고양이 캐릭터 스티커 ≈ 동물 그림 스티커", "미래관 세미나실", "발표 준비"],
    lost: {
      title: "발표 준비하다 폰을 두고 나왔어요",
      description:
        "미래관 세미나실에서 조별 발표 연습하고 급하게 나오느라 휴대폰을 두고 온 것 같아요. 뒷면에 고양이 캐릭터 스티커가 붙어 있어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "미래관(S3)",
      createdAgoH: 10 * D,
      eventGapH: 4,
    },
    found: {
      title: "세미나실에 남겨진 휴대폰",
      description:
        "미래관 5층 세미나실 정리하다가 휴대폰 한 대를 발견했어요. 케이스 뒤에 동물 그림 스티커가 있고 배터리는 거의 없어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "미래관(S3)",
      createdAgoH: 10 * D - 8,
      eventGapH: 1,
    },
  },
  // ---------- 노트북/태블릿 ----------
  {
    pairId: "P13",
    itemType: "노트북",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["검은색 LG 그램", "제3공학관 3층 컴퓨터실"],
    lost: {
      title: "검은색 노트북 두고 왔어요",
      description: "제3공학관 3층 컴퓨터실에 LG 그램 검은색 노트북을 두고 나왔어요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제3공학관(Y19)",
      createdAgoH: 8 * D,
      eventGapH: 1,
    },
    found: {
      title: "검은색 노트북 보관 중",
      description: "제3공학관 3층 컴퓨터실 창가 자리에 LG 노트북이 남아 있어서 조교실에 맡겼습니다.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제3공학관(Y19)",
      createdAgoH: 8 * D - 2,
      eventGapH: 0.5,
    },
  },
  {
    pairId: "P14",
    itemType: "태블릿",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["아이패드 ≈ 태블릿", "애플펜슬 ≈ 펜", "필름 ≈ 보호필름", "방목학술정보관 4층"],
    lost: {
      title: "아이패드 에어 + 애플펜슬 분실",
      description:
        "스페이스 그레이 아이패드 에어에 종이질감 필름 붙어 있고, 애플펜슬도 옆에 붙여놨어요. 방목학술정보관 4층 노트북 열람실에서 잃어버린 것 같아요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 34 * H,
      eventGapH: 3,
      image: { kind: "ipadWithPencil", background: "desk", rotate: -4, scale: 1.0, skew: 0, dx: 0, dy: 0, light: 0.25 },
    },
    found: {
      title: "태블릿이랑 펜 같이 주웠어요",
      description:
        "도서관 4층 열람실 자리에 회색 태블릿이 펜이 붙은 채로 놓여 있었어요. 화면에 보호필름이 있어요. 도서관 안내데스크에 맡겼습니다.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 31 * H,
      eventGapH: 1,
      image: { kind: "ipadWithPencil", background: "whiteTable", rotate: 11, scale: 0.85, skew: -7, dx: 15, dy: 10, light: -0.1 },
    },
  },
  {
    pairId: "P15",
    itemType: "노트북 충전기",
    difficulty: "hard",
    locationRelation: "same_building_other_spot",
    timeRelation: "days",
    keyClues: ["맥북용 C타입 충전기 ≈ 하얀 어댑터 + USB-C 케이블", "제5공학관 실습실"],
    lost: {
      title: "노트북 충전기만 없어졌어요",
      description:
        "제5공학관 실습실에서 전날 수업 끝나고 정신없이 나왔는데 다음 날 보니 충전기가 없네요. 맥북용 C타입 충전기고 선이 좀 꼬여 있어요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제5공학관(Y5)",
      createdAgoH: 14 * D,
      eventGapH: 20,
    },
    found: {
      title: "실습실 콘센트에 꽂힌 어댑터",
      description: "제5공학관 실습실 뒤쪽 콘센트에 하얀 어댑터랑 USB-C 케이블이 꽂혀 있길래 챙겨뒀습니다.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제5공학관(Y5)",
      createdAgoH: 13 * D,
      eventGapH: 6,
    },
  },
  // ---------- 우산 ----------
  {
    pairId: "P16",
    itemType: "우산",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "days",
    keyClues: ["검은색 장우산", "곡선형 손잡이", "행정동 1층 우산꽂이"],
    lost: {
      title: "검은색 장우산 잃어버렸어요",
      description: "비 오는 날 행정동 1층 우산꽂이에 꽂아뒀는데 없어졌어요. 검은색 장우산이고 손잡이가 곡선형이에요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "행정동(S5)",
      createdAgoH: 11 * D,
      eventGapH: 5,
    },
    found: {
      title: "검은 장우산 보관 중",
      description: "행정동 1층 우산꽂이에 며칠째 검은색 장우산이 남아 있어서 1층 데스크로 옮겨뒀어요. 손잡이가 둥글게 휘어 있어요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "행정동(S5)",
      createdAgoH: 9 * D,
      eventGapH: 2,
    },
  },
  {
    pairId: "P17",
    itemType: "우산",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["투명 ≈ 비닐", "나무 손잡이 ≈ 원목 느낌", "정문 버스정류장 ≈ 정문 셔틀 정류장"],
    lost: {
      title: "투명 비닐우산 (나무 손잡이)",
      description: "정문 버스정류장 근처에서 잃어버렸어요. 투명한 우산인데 손잡이만 나무로 되어 있어서 조금 특이해요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "정문",
      createdAgoH: 14 * H,
      eventGapH: 2,
      image: { kind: "clearUmbrellaWood", background: "concrete", rotate: -32, scale: 1.0, skew: 0, dx: 0, dy: 0, light: 0.1 },
    },
    found: {
      title: "정류장 벤치에 우산 두고 가셨어요",
      description: "정문 앞 셔틀 정류장 벤치에 비닐 우산이 걸려 있었어요. 손잡이가 원목 느낌이에요. 경비실에 있습니다.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "정문",
      createdAgoH: 11 * H,
      eventGapH: 1,
      image: { kind: "clearUmbrellaWood", background: "bench", rotate: 38, scale: 0.9, skew: 5, dx: 10, dy: 0, light: -0.25 },
    },
  },
  {
    pairId: "P18",
    itemType: "우산",
    difficulty: "hard",
    locationRelation: "lost_unknown",
    timeRelation: "days",
    keyClues: ["남색 ≈ 네이비", "3단 접이식 ≈ 접이 우산", "끈 태그 ≈ 손목 끈 태그"],
    lost: {
      title: "접이식 우산 어디 뒀는지 모르겠어요",
      description:
        "지난주 비 온 날 수업 몇 개 듣고 나서 우산이 없어진 걸 알았어요. 남색 3단 접이식이고 끈에 작은 태그가 달려 있어요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: null,
      createdAgoH: 13 * D,
      eventGapH: null,
    },
    found: {
      title: "우산꽂이에 오래 남은 우산",
      description:
        "베리타스홀 입구 우산꽂이에 네이비색 접이 우산이 일주일 가까이 그대로 있어서 보관 중이에요. 손목 끈에 태그가 붙어 있습니다.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "베리타스홀",
      createdAgoH: 7 * D,
      eventGapH: 3,
    },
  },
  // ---------- 가방 ----------
  {
    pairId: "P19",
    itemType: "가방",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["검은색 노스페이스 백팩", "학생복지관 식당"],
    lost: {
      title: "검은색 백팩 잃어버렸어요",
      description: "학생복지관 식당에서 밥 먹고 의자에 걸어둔 검은색 백팩을 두고 나왔어요. 노스페이스 로고 있어요.",
      category: "가방",
      campus: "자연캠퍼스",
      location: "학생복지관(Y21)",
      createdAgoH: 2 * D,
      eventGapH: 1,
    },
    found: {
      title: "검은 백팩 주웠어요",
      description: "학생복지관 식당 의자에 노스페이스 검은색 백팩이 걸려 있어서 식당 카운터에 맡겼습니다.",
      category: "가방",
      campus: "자연캠퍼스",
      location: "학생복지관(Y21)",
      createdAgoH: 2 * D - 2,
      eventGapH: 0.5,
    },
  },
  {
    pairId: "P20",
    itemType: "가방",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["아이보리 캔버스 에코백 ≈ 흰색 천가방", "전공책 ≈ 두꺼운 책", "파란 필통 ≈ 필기구 파우치"],
    lost: {
      title: "에코백 분실 (책이랑 필통)",
      description:
        "아이보리색 캔버스 에코백이에요. 안에 전공책 한 권이랑 파란 필통이 들어 있어요. 학생회관 2층에서 잃어버린 것 같아요.",
      category: "가방",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 40 * H,
      eventGapH: 3,
      image: { kind: "ecoBagWithItems", background: "desk", rotate: 4, scale: 1.0, skew: 0, dx: 0, dy: 0, light: 0.3 },
    },
    found: {
      title: "천가방 하나 보관하고 있어요",
      description: "학생회관 2층 공용 테이블에 흰색 천가방이 놓여 있었어요. 두꺼운 책 한 권이랑 필기구 파우치가 들어 있어요.",
      category: "가방",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 37 * H,
      eventGapH: 1,
      image: { kind: "ecoBagWithItems", background: "floor", rotate: -14, scale: 0.85, skew: 6, dx: -15, dy: 15, light: -0.2 },
    },
  },
  {
    pairId: "P21",
    itemType: "가방",
    difficulty: "hard",
    locationRelation: "adjacent",
    timeRelation: "within_day",
    keyClues: ["회색 ≈ 그레이", "크로스백", "물병 ≈ 텀블러", "체육문화관 ↔ 대운동장"],
    lost: {
      title: "운동 끝나고 가방을 놓고 왔어요",
      description: "저녁에 운동하고 바로 집에 갔는데 크로스백을 놓고 온 것 같아요. 회색이고 안에 물병이랑 이어폰 줄이 있었어요.",
      category: "가방",
      campus: "자연캠퍼스",
      location: "체육문화관(Y6)",
      createdAgoH: 15 * D,
      eventGapH: 12,
    },
    found: {
      title: "스탠드에 놓인 크로스백",
      description: "대운동장 관중석 스탠드에 작은 그레이 크로스백이 있어서 챙겨왔어요. 텀블러 같은 게 들어 있습니다.",
      category: "가방",
      campus: "자연캠퍼스",
      location: "대운동장",
      createdAgoH: 15 * D - 6,
      eventGapH: 8,
    },
  },
  // ---------- 의류 ----------
  {
    pairId: "P22",
    itemType: "의류",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["회색 후드집업", "가슴 로고 자수", "창조예술관 2층"],
    lost: {
      title: "회색 후드집업 두고 왔어요",
      description: "창조예술관 2층 강의실에 회색 후드집업을 두고 나왔어요. 가슴에 작은 로고 자수가 있어요.",
      category: "의류",
      campus: "자연캠퍼스",
      location: "창조예술관(Y2)",
      createdAgoH: 4 * D + 5,
      eventGapH: 2,
    },
    found: {
      title: "회색 후드집업 주웠어요",
      description: "창조예술관 2층 강의실 의자에 걸려 있던 회색 후드집업 보관 중이에요. 왼쪽 가슴에 자수가 있어요.",
      category: "의류",
      campus: "자연캠퍼스",
      location: "창조예술관(Y2)",
      createdAgoH: 4 * D + 2,
      eventGapH: 1,
    },
  },
  {
    pairId: "P23",
    itemType: "의류",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["검은색 ≈ 까만", "경량 패딩 조끼 ≈ 경량 베스트", "안주머니 이어폰"],
    lost: {
      title: "검은색 패딩 조끼 분실",
      description: "종합관 강의실 의자에 걸어둔 검은색 경량 패딩 조끼를 두고 나왔어요. 안주머니에 줄 이어폰이 있을 거예요.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "종합관(S1)",
      createdAgoH: 6 * D,
      eventGapH: 2,
    },
    found: {
      title: "강의실에 남은 얇은 패딩 베스트",
      description: "종합관 5층 강의실 뒷줄 의자에 까만 경량 베스트가 걸려 있었어요. 주머니에 이어폰이 들어 있습니다.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "종합관(S1)",
      createdAgoH: 6 * D - 4,
      eventGapH: 2,
    },
  },
  {
    pairId: "P24",
    itemType: "의류",
    difficulty: "hard",
    locationRelation: "same_building_other_spot",
    timeRelation: "days",
    keyClues: ["네이비 ≈ 남색", "바람막이 ≈ 얇은 점퍼", "소매 흰 줄 ≈ 팔 하얀 라인"],
    lost: {
      title: "바람막이 어디 뒀는지 기억이 안 나요",
      description: "체육 수업 끝나고 겉옷을 벗어뒀는데 어디였는지 헷갈려요. 네이비색 바람막이고 소매에 흰 줄이 있어요.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "운동장",
      createdAgoH: 16 * D,
      eventGapH: null,
    },
    found: {
      title: "운동장 벤치에 걸린 남색 점퍼",
      description: "운동장 옆 벤치에 남색 얇은 점퍼가 이틀째 걸려 있어서 수거했어요. 팔 부분에 하얀 라인이 있어요.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "운동장",
      createdAgoH: 14 * D,
      eventGapH: 2,
    },
  },
  // ---------- 열쇠 ----------
  {
    pairId: "P25",
    itemType: "열쇠",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["열쇠 꾸러미", "열쇠 3개", "생활관 입구"],
    lost: {
      title: "열쇠 꾸러미 잃어버렸어요",
      description: "생활관 들어가다가 열쇠 꾸러미를 떨어뜨린 것 같아요. 열쇠 3개가 링에 달려 있어요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "생활관(S8)",
      createdAgoH: 3 * D + 6,
      eventGapH: 1,
    },
    found: {
      title: "열쇠 꾸러미 주웠어요",
      description: "생활관 입구 앞 계단에서 열쇠 3개 달린 꾸러미를 주웠어요. 생활관 사감실에 맡겼습니다.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "생활관(S8)",
      createdAgoH: 3 * D + 3,
      eventGapH: 1,
    },
  },
  {
    pairId: "P26",
    itemType: "열쇠",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["곰돌이 인형 키링 ≈ 작은 곰 인형", "학생회관 동아리방"],
    lost: {
      title: "동아리방 열쇠 분실 (곰돌이 키링)",
      description: "학생회관 동아리방 열쇠인데 갈색 곰돌이 인형 키링이 달려 있어요. 저녁에 동아리 모임 끝나고 잃어버렸어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "학생회관(Y1)",
      createdAgoH: 5 * D + 4,
      eventGapH: 3,
    },
    found: {
      title: "곰 인형 매달린 열쇠",
      description: "학생회관 3층 복도에서 작은 곰 인형이 매달린 열쇠를 주웠어요. 열쇠는 하나예요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "학생회관(Y1)",
      createdAgoH: 5 * D,
      eventGapH: 2,
    },
  },
  {
    pairId: "P27",
    itemType: "열쇠",
    difficulty: "hard",
    locationRelation: "lost_unknown",
    timeRelation: "lost_time_unknown",
    keyClues: ["은색 열쇠 두 개", "야구공 모양 키링 ≈ 동그란 공 모양 장식"],
    lost: {
      title: "자취방 열쇠를 어디서 흘린 것 같아요",
      description:
        "하루 종일 여기저기 돌아다녀서 정확히 어디인지 모르겠어요. 은색 열쇠 두 개에 작은 야구공 모양 키링이 같이 달려 있어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: null,
      createdAgoH: 17 * D,
      eventGapH: null,
    },
    found: {
      title: "화단에서 열쇠 링 발견",
      description: "백마상 옆 화단 가장자리에서 열쇠 두 개가 달린 링을 발견했어요. 동그란 공 모양 장식이 달려 있어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "백마상",
      createdAgoH: 16 * D,
      eventGapH: 5,
    },
  },
  // ---------- 기타 소지품 ----------
  {
    pairId: "P28",
    itemType: "텀블러",
    difficulty: "easy",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["파란색 스탠리 텀블러", "방목학술정보관 3층 열람실"],
    lost: {
      title: "파란색 텀블러 잃어버렸어요",
      description: "스탠리 파란색 텀블러예요. 방목학술정보관 3층 열람실에 두고 나온 것 같아요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 2 * D + 5,
      eventGapH: 2,
    },
    found: {
      title: "파란 텀블러 주웠어요",
      description: "방목학술정보관 3층 열람실 창가 자리에 파란색 텀블러가 있었어요. 스탠리 제품이에요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 2 * D + 2,
      eventGapH: 1,
    },
  },
  {
    pairId: "P29",
    itemType: "보온병",
    difficulty: "medium",
    locationRelation: "same",
    timeRelation: "hours",
    keyClues: ["흰색 보온병 ≈ 흰 텀블러", "여행 스티커 ≈ 도시 이름 스티커", "명진당 1층 휴게실"],
    lost: {
      title: "스티커 붙은 보온병 분실",
      description: "흰색 보온병에 여행 스티커 몇 개 붙여놨어요. 명진당 1층 휴게실에서 잃어버렸어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 8 * D + 3,
      eventGapH: 2,
    },
    found: {
      title: "휴게실에 텀블러 하나",
      description: "명진당 1층 휴게실 테이블에 흰 텀블러가 있었어요. 겉에 도시 이름이 적힌 스티커들이 붙어 있어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 8 * D,
      eventGapH: 1,
    },
  },
  {
    pairId: "P30",
    itemType: "파우치",
    difficulty: "hard",
    locationRelation: "same",
    timeRelation: "within_day",
    keyClues: ["베이지색 ≈ 연베이지", "손바닥만 한 파우치", "립밤·핸드크림 ≈ 작은 화장품들", "대운동장"],
    lost: {
      title: "작은 파우치 잃어버렸어요",
      description:
        "어제 저녁 대운동장 쪽에서 산책하다 뭔가 떨어뜨린 것 같아요. 손바닥만 한 베이지색 파우치에 립밤이랑 핸드크림이 들어 있어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "대운동장",
      createdAgoH: 18 * D,
      eventGapH: 14,
    },
    found: {
      title: "트랙 옆에서 화장품 파우치 습득",
      description: "대운동장 트랙 옆 잔디에 연베이지 파우치가 떨어져 있었어요. 안에 작은 화장품들이 들어 있습니다.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "대운동장",
      createdAgoH: 18 * D - 5,
      eventGapH: 10,
    },
  },
];

export const NEGATIVES: Negative[] = [
  // ---------- 지갑 ----------
  {
    negId: "N01",
    itemType: "지갑",
    board: "found",
    confusableWith: ["P01"],
    whyNotMatch: "같은 건물·같은 색이지만 카드지갑이 아니라 지퍼형 장지갑",
    demoAdjacentTo: "DEMO-1",
    post: {
      title: "검은색 장지갑 주웠어요",
      description: "학생회관 1층 편의점 앞에서 검정 장지갑을 주웠어요. 지퍼형이고 현금 몇 장이 들어 있어요.",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 30 * H,
      eventGapH: 1,
      image: { kind: "longWallet", background: "floor", rotate: 10, scale: 0.9, skew: -4, dx: 10, dy: 10, light: -0.1 },
    },
  },
  {
    negId: "N02",
    itemType: "지갑",
    board: "found",
    confusableWith: ["P01"],
    whyNotMatch: "인접 장소·같은 색이지만 동전지갑",
    demoAdjacentTo: "DEMO-1",
    post: {
      title: "까만 동전지갑 습득",
      description: "강경대민주광장 벤치에서 작은 까만색 동전지갑을 주웠어요. 동전이랑 머리끈이 들어 있어요.",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "강경대민주광장",
      createdAgoH: 44 * H,
      eventGapH: 2,
    },
  },
  {
    negId: "N03",
    itemType: "지갑",
    board: "found",
    confusableWith: ["P01"],
    whyNotMatch: "같은 장소·'검은색 카드 수납'이 겹치지만 휴대폰에 붙이는 카드 케이스이고 비어 있음",
    demoAdjacentTo: "DEMO-1",
    post: {
      title: "휴대폰 카드케이스 주웠어요",
      description: "학생회관 2층 계단에서 휴대폰 뒤에 붙이는 검은 카드 수납 케이스를 주웠어요. 카드는 없어요.",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 52 * H,
      eventGapH: 3,
    },
  },
  {
    negId: "N04",
    itemType: "지갑",
    board: "lost",
    confusableWith: ["P02"],
    whyNotMatch: "같은 건물·같은 갈색이지만 반지갑이 아니라 장지갑이고 학생증 언급 없음",
    post: {
      title: "갈색 장지갑 잃어버렸어요",
      description: "국제관 근처에서 갈색 장지갑을 잃어버렸어요. 현금이랑 영수증이 많이 들어 있어요.",
      category: "지갑",
      campus: "인문캠퍼스",
      location: "국제관(S4)",
      createdAgoH: 5 * D + 6,
      eventGapH: 4,
    },
  },
  // ---------- 카드 ----------
  {
    negId: "N05",
    itemType: "카드(학생증)",
    board: "found",
    confusableWith: ["P05"],
    whyNotMatch: "같은 장소의 학생증이지만 경영 계열이고 새 카드처럼 깨끗함(같은 학교 학생증이라 디자인은 동일)",
    demoAdjacentTo: "DEMO-2",
    post: {
      title: "학생증 한 장 주웠어요",
      description: "제5공학관 1층 로비에서 학생증 한 장 주웠어요. 경영 쪽 학과로 보이고 새 카드처럼 깨끗해요.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "제5공학관(Y5)",
      createdAgoH: 36 * H,
      eventGapH: 2,
      image: { kind: "studentCard", background: "concrete", rotate: -9, scale: 0.9, skew: 3, dx: -10, dy: 5, light: -0.2, variant: "clean" },
    },
  },
  {
    negId: "N06",
    itemType: "카드(교통카드)",
    board: "found",
    confusableWith: ["P05"],
    whyNotMatch: "같은 장소지만 학생증이 아니라 캐릭터 교통카드",
    demoAdjacentTo: "DEMO-2",
    post: {
      title: "교통카드 습득",
      description: "제5공학관 엘리베이터 근처에서 캐릭터 그림이 있는 교통카드를 주웠어요.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "제5공학관(Y5)",
      createdAgoH: 48 * H,
      eventGapH: 1,
    },
  },
  {
    negId: "N07",
    itemType: "카드(학생증 케이스)",
    board: "found",
    confusableWith: ["P05"],
    whyNotMatch: "공대 쪽 학생증 관련이지만 카드 없이 빈 케이스",
    demoAdjacentTo: "DEMO-2",
    post: {
      title: "빈 학생증 케이스 주웠어요",
      description: "제4공학관 앞 벤치에서 목걸이형 학생증 케이스를 주웠어요. 안에 카드는 없어요.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "제4공학관(Y13)",
      createdAgoH: 60 * H,
      eventGapH: 3,
    },
  },
  {
    negId: "N08",
    itemType: "카드(체크카드)",
    board: "lost",
    confusableWith: ["P06"],
    whyNotMatch: "은행 체크카드지만 KB·초록색이고 장소도 다름",
    post: {
      title: "체크카드 분실",
      description: "명진당에서 KB 체크카드를 잃어버렸어요. 초록색 디자인이에요.",
      category: "카드",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 12 * D + 3,
      eventGapH: 2,
    },
  },
  // ---------- 무선 이어폰 ----------
  {
    negId: "N09",
    itemType: "무선 이어폰",
    board: "found",
    confusableWith: ["P08", "P07"],
    whyNotMatch: "같은 장소·흰색 에어팟이지만 프로가 아닌 일반 모델이고 스티커 없음",
    demoAdjacentTo: "DEMO-3",
    post: {
      title: "흰색 에어팟 주웠어요",
      description: "학생회관 1층 로비 소파에 흰색 에어팟이 있었어요. 케이스에 스티커나 장식은 없어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 12 * H,
      eventGapH: 1,
      image: { kind: "airpodsCase", background: "bench", rotate: 6, scale: 0.9, skew: -3, dx: 0, dy: 10, light: -0.1, variant: "noSticker" },
    },
  },
  {
    negId: "N10",
    itemType: "무선 이어폰",
    board: "found",
    confusableWith: ["P08"],
    whyNotMatch: "같은 장소·'파란'이 겹치지만 케이스 자체가 파란색인 다른 이어폰",
    demoAdjacentTo: "DEMO-3",
    post: {
      title: "파란색 무선 이어폰 습득",
      description: "학생회관 2층 휴게실에서 파란색 무선 이어폰 케이스를 주웠어요. 브랜드는 잘 모르겠어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 18 * H,
      eventGapH: 2,
    },
  },
  {
    negId: "N11",
    itemType: "무선 헤드폰",
    board: "found",
    confusableWith: ["P08"],
    whyNotMatch: "인접 장소·흰색 무선 음향기기지만 헤드폰",
    demoAdjacentTo: "DEMO-3",
    post: {
      title: "흰색 헤드폰 주웠어요",
      description: "강경대민주광장 계단에 흰색 무선 헤드폰이 놓여 있었어요. 귀 쿠션이 조금 헤져 있어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "강경대민주광장",
      createdAgoH: 28 * H,
      eventGapH: 2,
    },
  },
  {
    negId: "N12",
    itemType: "무선 이어폰",
    board: "found",
    confusableWith: ["P08"],
    whyNotMatch: "같은 흰색 에어팟 프로·스티커도 있지만 초록색 스티커이고 다른 건물",
    demoAdjacentTo: "DEMO-3",
    post: {
      title: "에어팟 프로 습득 (초록 스티커)",
      description: "종합관 1층에서 흰색 에어팟 프로를 주웠어요. 케이스에 초록색 동그란 스티커가 붙어 있어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "종합관(S1)",
      createdAgoH: 21 * H,
      eventGapH: 1,
      image: { kind: "airpodsProCase", background: "whiteTable", rotate: -18, scale: 0.9, skew: 4, dx: -10, dy: 5, light: 0.1, variant: "greenSticker" },
    },
  },
  {
    negId: "N13",
    itemType: "무선 이어폰",
    board: "lost",
    confusableWith: ["P09"],
    whyNotMatch: "같은 건물·버즈 한쪽이지만 검은색 왼쪽",
    post: {
      title: "검은색 버즈 한쪽 분실",
      description: "제2공학관에서 검은색 갤럭시 버즈 왼쪽 한쪽을 잃어버렸어요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제2공학관(Y8)",
      createdAgoH: 6 * D + 5,
      eventGapH: 2,
    },
  },
  // ---------- 휴대폰 ----------
  {
    negId: "N14",
    itemType: "휴대폰",
    board: "found",
    confusableWith: ["P11"],
    whyNotMatch: "같은 장소 아이폰이지만 검은색 가죽 케이스",
    demoAdjacentTo: "DEMO-4",
    post: {
      title: "아이폰 주웠어요 (가죽 케이스)",
      description: "MCC관 2층 강의실에 아이폰 한 대가 있었어요. 검은색 가죽 케이스라 본체 색은 잘 모르겠어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "MCC관(S10)",
      createdAgoH: 24 * H,
      eventGapH: 1,
      image: { kind: "phoneBlackLeather", background: "whiteTable", rotate: 15, scale: 0.9, skew: -4, dx: 10, dy: 0, light: 0.0 },
    },
  },
  {
    negId: "N15",
    itemType: "휴대폰",
    board: "found",
    confusableWith: ["P11"],
    whyNotMatch: "연분홍 휴대폰이지만 갤럭시 플립이고 케이스 없음",
    demoAdjacentTo: "DEMO-4",
    post: {
      title: "연분홍 갤럭시 플립 습득",
      description: "종합관 1층 카페 앞에서 연분홍색 갤럭시 플립 폰을 주웠어요. 케이스는 없어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "종합관(S1)",
      createdAgoH: 33 * H,
      eventGapH: 2,
    },
  },
  {
    negId: "N16",
    itemType: "휴대폰 케이스",
    board: "found",
    confusableWith: ["P11"],
    whyNotMatch: "같은 장소·'투명 케이스 안 종이'가 겹치지만 휴대폰 없이 케이스만 있음",
    demoAdjacentTo: "DEMO-4",
    post: {
      title: "투명 폰케이스만 주웠어요",
      description: "MCC관 1층 화장실 앞에 투명 휴대폰 케이스만 떨어져 있었어요. 안에 사진 한 장이 끼워져 있어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "MCC관(S10)",
      createdAgoH: 19 * H,
      eventGapH: 1,
      image: { kind: "clearCaseOnly", background: "floor", rotate: -10, scale: 0.9, skew: 5, dx: 0, dy: 5, light: -0.1 },
    },
  },
  {
    negId: "N17",
    itemType: "휴대폰",
    board: "lost",
    confusableWith: ["P10"],
    whyNotMatch: "갤럭시·케이스 없음이 겹치지만 S23 회색이고 장소가 다름",
    post: {
      title: "갤럭시 S23 분실",
      description: "자연도서관에서 회색 갤럭시 S23을 잃어버렸어요. 케이스는 안 끼웠어요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "자연도서관",
      createdAgoH: 3 * D + 4,
      eventGapH: 3,
    },
  },
  // ---------- 노트북/태블릿 ----------
  {
    negId: "N18",
    itemType: "태블릿",
    board: "found",
    confusableWith: ["P14"],
    whyNotMatch: "같은 장소 태블릿이지만 검은색 갤럭시탭 + 키보드 커버, 펜 없음",
    demoAdjacentTo: "DEMO-5",
    post: {
      title: "갤럭시탭 주웠어요",
      description: "방목학술정보관 3층에서 검은색 갤럭시탭을 주웠어요. 키보드 커버가 달려 있어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 38 * H,
      eventGapH: 2,
      image: { kind: "galaxyTabKeyboard", background: "whiteTable", rotate: 6, scale: 0.9, skew: -3, dx: 0, dy: 0, light: -0.05 },
    },
  },
  {
    negId: "N19",
    itemType: "태블릿 펜",
    board: "found",
    confusableWith: ["P14"],
    whyNotMatch: "같은 장소·애플펜슬이지만 태블릿 없이 펜만",
    demoAdjacentTo: "DEMO-5",
    post: {
      title: "애플펜슬만 주웠어요",
      description: "도서관 4층 복도에서 흰색 애플펜슬 하나를 주웠어요. 태블릿은 없었어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 29 * H,
      eventGapH: 1,
    },
  },
  {
    negId: "N20",
    itemType: "노트북",
    board: "found",
    confusableWith: ["P14"],
    whyNotMatch: "회색 애플 기기지만 맥북 에어이고 다른 건물",
    demoAdjacentTo: "DEMO-5",
    post: {
      title: "회색 맥북 보관 중",
      description: "미래관 4층 스터디룸에 회색 맥북 에어가 남아 있어요. 스티커가 몇 개 붙어 있어요.",
      category: "전자기기",
      campus: "인문캠퍼스",
      location: "미래관(S3)",
      createdAgoH: 50 * H,
      eventGapH: 3,
    },
  },
  {
    negId: "N21",
    itemType: "노트북 충전기",
    board: "lost",
    confusableWith: ["P15"],
    whyNotMatch: "노트북 충전기지만 LG 그램용 검은 어댑터이고 다른 건물",
    post: {
      title: "LG 그램 충전기 분실",
      description: "제3공학관 컴퓨터실에서 LG 그램 충전기를 잃어버렸어요. 검은색 어댑터예요.",
      category: "전자기기",
      campus: "자연캠퍼스",
      location: "제3공학관(Y19)",
      createdAgoH: 13 * D + 5,
      eventGapH: 4,
    },
  },
  // ---------- 우산 ----------
  {
    negId: "N22",
    itemType: "우산",
    board: "found",
    confusableWith: ["P17"],
    whyNotMatch: "같은 장소·투명 비닐우산이지만 손잡이가 흰 플라스틱",
    demoAdjacentTo: "DEMO-6",
    post: {
      title: "투명 우산 주웠어요",
      description: "정문 셔틀 정류장 근처에 투명 비닐우산이 있었어요. 손잡이는 흰 플라스틱이에요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "정문",
      createdAgoH: 8 * H,
      eventGapH: 1,
      image: { kind: "clearUmbrellaPlastic", background: "bench", rotate: 34, scale: 0.9, skew: 3, dx: 0, dy: 0, light: -0.2 },
    },
  },
  {
    negId: "N23",
    itemType: "우산",
    board: "found",
    confusableWith: ["P17"],
    whyNotMatch: "'나무 손잡이'가 겹치지만 검은색 장우산이고 다른 건물",
    demoAdjacentTo: "DEMO-6",
    post: {
      title: "나무 손잡이 장우산 보관 중",
      description: "명진당 입구 우산꽂이에 나무 손잡이가 달린 검은색 장우산이 있어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 26 * H,
      eventGapH: 4,
    },
  },
  {
    negId: "N24",
    itemType: "우산",
    board: "found",
    confusableWith: ["P17"],
    whyNotMatch: "투명 우산이지만 손잡이가 부러져 있고 다른 장소",
    demoAdjacentTo: "DEMO-6",
    post: {
      title: "손잡이 부러진 투명 우산",
      description: "학생회관 앞 벤치에 손잡이가 부러진 투명 우산이 있어서 치워뒀어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "학생회관(Y1)",
      createdAgoH: 46 * H,
      eventGapH: 2,
    },
  },
  {
    negId: "N25",
    itemType: "우산",
    board: "lost",
    confusableWith: ["P18", "P16"],
    whyNotMatch: "남색 우산이지만 접이식이 아닌 장우산",
    post: {
      title: "남색 장우산 잃어버렸어요",
      description: "행정동 앞에서 남색 장우산을 잃어버렸어요. 손잡이는 검은색이에요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "행정동(S5)",
      createdAgoH: 8 * D,
      eventGapH: 3,
    },
  },
  // ---------- 가방 ----------
  {
    negId: "N26",
    itemType: "가방",
    board: "found",
    confusableWith: ["P20"],
    whyNotMatch: "같은 장소 에코백이지만 베이지색이고 안이 비어 있음",
    demoAdjacentTo: "DEMO-7",
    post: {
      title: "에코백 주웠어요",
      description: "학생회관 2층 계단 옆에 베이지색 에코백이 있었어요. 안에는 아무것도 없어요.",
      category: "가방",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 42 * H,
      eventGapH: 2,
      image: { kind: "ecoBagEmpty", background: "floor", rotate: 8, scale: 0.9, skew: -3, dx: 0, dy: 10, light: -0.15 },
    },
  },
  {
    negId: "N27",
    itemType: "가방",
    board: "found",
    confusableWith: ["P20"],
    whyNotMatch: "같은 건물·전공책이 겹치지만 종이 쇼핑백",
    demoAdjacentTo: "DEMO-7",
    post: {
      title: "쇼핑백에 전공책 두 권",
      description: "학생회관 1층 로비에 종이 쇼핑백이 있었는데 전공책 두 권이 들어 있어요.",
      category: "가방",
      campus: "인문캠퍼스",
      location: "학생회관(S2)",
      createdAgoH: 55 * H,
      eventGapH: 3,
    },
  },
  {
    negId: "N28",
    itemType: "가방",
    board: "found",
    confusableWith: ["P20"],
    whyNotMatch: "인접 장소·아이보리색이지만 크로스백이고 내용물이 다름",
    demoAdjacentTo: "DEMO-7",
    post: {
      title: "아이보리 크로스백 습득",
      description: "강경대민주광장 벤치에 아이보리색 작은 크로스백이 있었어요. 화장품 파우치가 들어 있어요.",
      category: "가방",
      campus: "인문캠퍼스",
      location: "강경대민주광장",
      createdAgoH: 64 * H,
      eventGapH: 2,
    },
  },
  {
    negId: "N29",
    itemType: "가방",
    board: "lost",
    confusableWith: ["P21"],
    whyNotMatch: "운동 후 크로스백이지만 검은색이고 안에 지갑",
    post: {
      title: "검은색 크로스백 분실",
      description: "체육관에서 운동하고 검은색 크로스백을 놓고 나왔어요. 안에 지갑이 있어요.",
      category: "가방",
      campus: "자연캠퍼스",
      location: "체육관(Y7)",
      createdAgoH: 15 * D + 2,
      eventGapH: 3,
    },
  },
  // ---------- 의류 ----------
  {
    negId: "N30",
    itemType: "의류",
    board: "found",
    confusableWith: ["P22"],
    whyNotMatch: "같은 건물·회색 상의지만 맨투맨",
    post: {
      title: "회색 맨투맨 주웠어요",
      description: "창조예술관 1층 로비 의자에 회색 맨투맨이 놓여 있었어요. 앞에 프린팅은 없어요.",
      category: "의류",
      campus: "자연캠퍼스",
      location: "창조예술관(Y2)",
      createdAgoH: 4 * D,
      eventGapH: 2,
    },
  },
  {
    negId: "N31",
    itemType: "의류",
    board: "lost",
    confusableWith: ["P23"],
    whyNotMatch: "같은 건물·검은 패딩이지만 롱패딩",
    post: {
      title: "검은색 롱패딩 분실",
      description: "종합관 강의실에 무릎까지 오는 검은색 롱패딩을 두고 나왔어요.",
      category: "의류",
      campus: "인문캠퍼스",
      location: "종합관(S1)",
      createdAgoH: 6 * D + 6,
      eventGapH: 2,
    },
  },
  // ---------- 열쇠 ----------
  {
    negId: "N32",
    itemType: "열쇠",
    board: "found",
    confusableWith: ["P26"],
    whyNotMatch: "같은 건물·인형 키링 열쇠지만 분홍 토끼",
    post: {
      title: "토끼 키링 달린 열쇠",
      description: "학생회관 2층에서 분홍색 토끼 인형 키링이 달린 열쇠를 주웠어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "학생회관(Y1)",
      createdAgoH: 5 * D + 8,
      eventGapH: 2,
    },
  },
  {
    negId: "N33",
    itemType: "자동차 키",
    board: "lost",
    confusableWith: ["P27"],
    whyNotMatch: "같은 장소 열쇠지만 자동차 스마트키",
    post: {
      title: "자동차 스마트키 분실",
      description: "백마상 근처 주차장 가는 길에 검은색 자동차 스마트키를 떨어뜨렸어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "백마상",
      createdAgoH: 16 * D + 6,
      eventGapH: 1,
    },
  },
  // ---------- 기타 ----------
  {
    negId: "N34",
    itemType: "텀블러",
    board: "found",
    confusableWith: ["P28"],
    whyNotMatch: "같은 장소 텀블러지만 검은색",
    post: {
      title: "검은색 텀블러 주웠어요",
      description: "방목학술정보관 3층 열람실에 검은색 텀블러가 있었어요. 브랜드는 잘 모르겠어요.",
      category: "기타",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 2 * D + 8,
      eventGapH: 2,
    },
  },
  {
    negId: "N35",
    itemType: "보온병",
    board: "found",
    confusableWith: ["P29"],
    whyNotMatch: "같은 건물 흰 보온병이지만 스티커 없음",
    post: {
      title: "흰 보온병 보관 중",
      description: "명진당 2층 열람실에 흰색 보온병이 있어요. 겉에 아무 장식이 없어요.",
      category: "기타",
      campus: "자연캠퍼스",
      location: "명진당(Y3)",
      createdAgoH: 7 * D + 20,
      eventGapH: 2,
    },
  },
  {
    negId: "N36",
    itemType: "필통",
    board: "lost",
    confusableWith: ["P30"],
    whyNotMatch: "같은 장소·베이지 소품 파우치류지만 필통",
    post: {
      title: "베이지색 필통 잃어버렸어요",
      description: "대운동장 근처 벤치에서 베이지색 필통을 잃어버렸어요. 볼펜이랑 형광펜이 들어 있어요.",
      category: "필기구",
      campus: "자연캠퍼스",
      location: "대운동장",
      createdAgoH: 18 * D + 3,
      eventGapH: 2,
    },
  },
];

// 정답도 hard negative도 아닌 일반 게시글 -- 카테고리가 한쪽에 몰리지 않고
// 목록 화면이 자연스럽게 보이도록 넣는다(책/필기구/액세서리 등). 평가에서는
// "관련 없는 배경 게시글"로만 취급한다.
export const FILLERS: Filler[] = [
  {
    fillerId: "F01",
    board: "lost",
    post: {
      title: "자료구조 전공책 두고 왔어요",
      description: "제2공학관 강의실에 자료구조 전공책을 두고 나왔어요. 옆면에 형광펜 표시가 많아요.",
      category: "책",
      campus: "자연캠퍼스",
      location: "제2공학관(Y8)",
      createdAgoH: 3 * D + 10,
      eventGapH: 2,
    },
  },
  {
    fillerId: "F02",
    board: "found",
    post: {
      title: "토익 문제집 주웠어요",
      description: "방목학술정보관 1층 로비 테이블에 토익 RC 문제집이 있었어요. 필기가 꽤 되어 있어요.",
      category: "책",
      campus: "인문캠퍼스",
      location: "방목학술정보관(S9)",
      createdAgoH: 10 * D + 4,
      eventGapH: 2,
      status: "완료",
    },
  },
  {
    fillerId: "F03",
    board: "found",
    post: {
      title: "검은색 필통 주웠어요",
      description: "MCC관 강의실 책상 서랍에 검은색 필통이 있었어요. 샤프랑 지우개가 들어 있어요.",
      category: "필기구",
      campus: "인문캠퍼스",
      location: "MCC관(S10)",
      createdAgoH: 2 * D + 12,
      eventGapH: 3,
    },
  },
  {
    fillerId: "F04",
    board: "lost",
    post: {
      title: "제도 샤프 잃어버렸어요",
      description: "함박관에서 은색 로트링 제도 샤프를 잃어버렸어요. 오래 써서 그립 부분이 닳았어요.",
      category: "필기구",
      campus: "자연캠퍼스",
      location: "함박관(Y9)",
      createdAgoH: 9 * D + 6,
      eventGapH: 3,
      status: "찾음",
    },
  },
  {
    fillerId: "F05",
    board: "lost",
    post: {
      title: "은목걸이 분실",
      description: "체육관 탈의실에서 얇은 은목걸이를 잃어버렸어요. 작은 달 모양 펜던트가 있어요.",
      category: "액세서리",
      campus: "자연캠퍼스",
      location: "체육관(Y7)",
      createdAgoH: 55 * H,
      eventGapH: 4,
    },
  },
  {
    fillerId: "F06",
    board: "found",
    post: {
      title: "뿔테 안경 주웠어요",
      description: "국제관 4층 복도에서 검은 뿔테 안경을 주웠어요. 안경닦이도 같이 있었어요.",
      category: "액세서리",
      campus: "인문캠퍼스",
      location: "국제관(S4)",
      createdAgoH: 3 * D + 1,
      eventGapH: 2,
    },
  },
  {
    fillerId: "F07",
    board: "found",
    post: {
      title: "진주 귀걸이 한 쪽 습득",
      description: "학생복지관 식당 바닥에서 진주 귀걸이 한 쪽을 주웠어요. 식당 카운터에 맡겼습니다.",
      category: "액세서리",
      campus: "자연캠퍼스",
      location: "학생복지관(Y21)",
      createdAgoH: 6 * D + 2,
      eventGapH: 1,
    },
  },
  {
    fillerId: "F08",
    board: "lost",
    post: {
      title: "초록색 스프링 노트 분실",
      description: "베리타스홀 근처에서 초록색 스프링 노트를 잃어버렸어요. 수업 필기가 많이 되어 있어요.",
      category: "책",
      campus: "인문캠퍼스",
      location: "베리타스홀",
      createdAgoH: 11 * D + 2,
      eventGapH: 2,
    },
  },
];

export const DEMOS: DemoScenario[] = [
  {
    demoId: "DEMO-1",
    name: "검은색 카드지갑",
    pairId: "P01",
    keyClues: ["검은색 = 검정", "카드지갑", "학생회관 2층 라운지"],
    searchQuery: "학생회관에서 검은색 카드지갑 잃어버렸어요",
    queryImage: { kind: "cardWallet", background: "carpet", rotate: 28, scale: 0.95, skew: 7, dx: 0, dy: 10, light: 0.0 },
  },
  {
    demoId: "DEMO-2",
    name: "긁힌 학생증",
    pairId: "P05",
    keyClues: ["스크래치 많음 = 많이 긁힘", "소프트웨어 계열", "제5공학관"],
    searchQuery: "공대 건물에서 긁힌 학생증 잃어버렸어요",
    queryImage: { kind: "studentCard", background: "whiteTable", rotate: 3, scale: 0.95, skew: -5, dx: 10, dy: 0, light: 0.2 },
  },
  {
    demoId: "DEMO-3",
    name: "파란 스티커 에어팟 프로",
    pairId: "P08",
    keyClues: ["에어팟 프로 = 흰색 무선 이어폰", "파란색 스티커", "학생회관"],
    searchQuery: "파란 스티커 붙은 흰색 에어팟 프로 잃어버렸어요",
    queryImage: { kind: "airpodsProCase", background: "carpet", rotate: 4, scale: 1.0, skew: 6, dx: 0, dy: 0, light: -0.05 },
  },
  {
    demoId: "DEMO-4",
    name: "투명 케이스 분홍 아이폰",
    pairId: "P11",
    keyClues: ["핑크 = 연분홍", "투명 케이스 안 영화 티켓 = 종이", "MCC관"],
    searchQuery: "분홍색 아이폰인데 투명 케이스 안에 티켓이 들어있어요",
    queryImage: { kind: "phonePinkClearCase", background: "carpet", rotate: -40, scale: 0.9, skew: 0, dx: 0, dy: 0, light: 0.1 },
  },
  {
    demoId: "DEMO-5",
    name: "아이패드 + 애플펜슬",
    pairId: "P14",
    keyClues: ["아이패드 = 회색 태블릿", "애플펜슬 = 펜", "도서관 4층"],
    searchQuery: "도서관에서 아이패드랑 펜슬 같이 잃어버렸어요",
    queryImage: { kind: "ipadWithPencil", background: "carpet", rotate: -16, scale: 0.9, skew: 5, dx: 0, dy: 0, light: 0.1 },
  },
  {
    demoId: "DEMO-6",
    name: "나무 손잡이 투명 우산",
    pairId: "P17",
    keyClues: ["투명 = 비닐", "나무 손잡이 = 원목 느낌", "정문 정류장"],
    searchQuery: "손잡이가 나무로 된 투명 우산",
    queryImage: { kind: "clearUmbrellaWood", background: "floor", rotate: -52, scale: 0.9, skew: -4, dx: 0, dy: 0, light: 0.2 },
  },
  {
    demoId: "DEMO-7",
    name: "책이 든 아이보리 에코백",
    pairId: "P20",
    keyClues: ["아이보리 캔버스 에코백 = 흰색 천가방", "전공책·파란 필통", "학생회관 2층"],
    searchQuery: "전공책이랑 필통 들어있는 흰색 에코백",
    queryImage: { kind: "ecoBagWithItems", background: "carpet", rotate: 18, scale: 0.9, skew: 4, dx: 0, dy: 0, light: 0.05 },
  },
];

// 게시자 계정. 실제 인물이 아닌 가상의 닉네임이며, 이메일은 seed 계정임을
// 관리 화면에서 식별할 수 있도록 고정된 패턴을 쓴다(일반 화면에는 이메일이
// 노출되지 않는다).
export const POSTERS: { nickname: string }[] = [
  { nickname: "민트초코" },
  { nickname: "새벽세시" },
  { nickname: "공강사냥꾼" },
  { nickname: "자캠셔틀러" },
  { nickname: "도서관지박령" },
  { nickname: "과제요정" },
  { nickname: "인문캠산책" },
  { nickname: "명진당단골" },
  { nickname: "코딩하는곰" },
  { nickname: "학식러버" },
  { nickname: "비오는날" },
  { nickname: "오늘도출석" },
  { nickname: "아메리카노두잔" },
  { nickname: "조별과제생존자" },
  { nickname: "행정동근처" },
  { nickname: "택배기다리는중" },
  { nickname: "고양이집사" },
  { nickname: "체대생" },
];
