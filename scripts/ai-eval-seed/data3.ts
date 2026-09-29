// 4차 추가분 (batch 3, append-only): 기존 Preview 게시글 99개는 건드리지 않고
// 정답쌍 30개(R01~R30, 게시글 60개), hard negative 50개(G01~G50), 대응
// 정답이 없는 no-match 40개(M11~M50)를 추가해 전체를 약 250개로 늘린다.
//
// 구성 원칙:
// - 기존 실패 유형을 일부러 더 많이 만든다: 색상 함정(color), 제목 키워드
//   함정(titleKeyword), 카드/카드케이스류 category 혼동(category), 에어팟/
//   버즈/이어폰 같은 계열 제품(family), 노트북/충전기/거치대 같은 연관
//   물건(related). 그 외 세부 특징만 다른 물건(detail), 표현을 크게 바꾼
//   동일 물건(paraphrase), 시간/장소가 조금 어긋난 경우(offset).
// - 기존 99개 게시글과 우연히 "진짜 정답"이 되지 않도록 색·장소·모델을 골랐고,
//   기존 게시글이 새 쌍의 hard negative 역할을 하는 경우는 existingConfusers에
//   제목으로 기록한다(ground truth에서 id로 풀린다).
// - 이미지는 전체의 30~40%가 되도록 일부 게시글에만 붙인다(코드로 그린 합성
//   이미지, 실사진 아님).
import type { Board, Campus, ImageSpec, Negative, Pair, PostSpec } from "./data";

const D = 24;
const I: Campus = "인문캠퍼스";
const N: Campus = "자연캠퍼스";

export type Challenge = "color" | "titleKeyword" | "category" | "family" | "related" | "detail" | "paraphrase" | "offset";

export type Pair3 = Pair & { challenges: Challenge[]; searchQuery?: string; existingConfusers?: string[] };
export type Negative3 = Negative & { challenges: Challenge[] };
export type NoMatch3 = { noMatchId: string; board: Board; nearestTheme: string; proximity: "near" | "far"; post: PostSpec };

function post(
  title: string,
  description: string,
  category: string,
  campus: Campus,
  location: string,
  createdAgoH: number,
  eventGapH: number | null,
  image?: ImageSpec,
): PostSpec {
  return { title, description, category, campus, location, createdAgoH, eventGapH, ...(image && { image }) };
}

function im(kind: ImageSpec["kind"], background: ImageSpec["background"], rotate: number, extra: Partial<ImageSpec> = {}): ImageSpec {
  return { kind, background, rotate, scale: 0.9, skew: 0, dx: 0, dy: 0, light: 0.1, ...extra };
}

// ---------------------------------------------------------------------------
// 정답쌍 30개
// ---------------------------------------------------------------------------
export const PAIRS3: Pair3[] = [
  {
    pairId: "R01", itemType: "에어팟 3세대", difficulty: "medium", locationRelation: "same_building_other_spot", timeRelation: "hours",
    keyClues: ["에어팟 3세대 ≈ 프로 아닌 작은 케이스", "뒷면 JH 각인", "방목학술정보관"],
    challenges: ["family", "titleKeyword"],
    searchQuery: "각인 있는 에어팟 3세대 케이스 도서관에서 잃어버렸어요",
    existingConfusers: ["흰색 에어팟 주웠어요"],
    lost: post("에어팟 3세대 케이스 분실", "에어팟 3세대(프로 아님)를 케이스째로 잃어버렸어요. 케이스 뒷면에 JH 각인이 있어요. 방목학술정보관 3층 열람실에 있었어요.", "전자기기", I, "방목학술정보관(S9)", 5 * D, 3,
      im("airpodsCase", "desk", -10, { light: 0.3 })),
    found: post("열람실에서 이어폰 케이스 주웠어요", "방목 4층 열람실 창가 자리에 작은 흰색 무선 이어폰 케이스가 있었어요. 뒤쪽에 영문 이니셜이 새겨져 있어요. 1층 대출대에 맡겼습니다.", "전자기기", I, "방목학술정보관(S9)", 5 * D - 5, 2,
      im("airpodsCase", "carpet", 22, { scale: 0.8, skew: 5, light: -0.1 })),
  },
  {
    pairId: "R02", itemType: "갤럭시 버즈2 프로", difficulty: "hard", locationRelation: "same", timeRelation: "within_day",
    keyClues: ["버즈 ≈ 삼성 무선 이어폰", "보라색 ≈ 라벤더색", "조약돌 모양 케이스", "제1공학관"],
    challenges: ["family", "paraphrase", "color"],
    searchQuery: "보라색 갤럭시 버즈 케이스째로 잃어버렸어요",
    lost: post("버즈 잃어버렸어요 (보라색)", "갤럭시 버즈2 프로 보라색을 케이스째로 잃어버렸어요. 제1공학관 1층 라운지에서 충전하다가 두고 온 것 같아요.", "전자기기", N, "제1공학관(Y_)", 9 * D, 4,
      im("budsCase", "desk", 8, { color: "#b9a7e0", light: 0.25 })),
    found: post("라벤더색 이어폰 케이스 습득", "제1공학관 라운지 콘센트 옆에 연보라색 조약돌 모양 무선 이어폰 케이스가 있었어요. 삼성 제품 같아요.", "전자기기", N, "제1공학관(Y_)", 9 * D - 8, 1,
      im("budsCase", "whiteTable", -25, { color: "#b9a7e0", scale: 0.8, skew: -4, light: -0.05 })),
  },
  {
    pairId: "R03", itemType: "유선 이어폰", difficulty: "hard", locationRelation: "adjacent", timeRelation: "within_day",
    keyClues: ["줄 이어폰 ≈ 유선 이어폰", "C타입 단자", "흰색", "제2공학관 ↔ 제3공학관"],
    challenges: ["family", "paraphrase", "offset"],
    lost: post("줄 이어폰 분실 (C타입)", "삼성 흰색 유선 이어폰이고 단자가 C타입이에요. 줄 중간에 매듭이 하나 있어요. 제2공학관에서 수업 듣고 나서 없어졌어요.", "전자기기", N, "제2공학관(Y8)", 12 * D, 6,
      im("earphonesWired", "desk", 5, { light: 0.25 })),
    found: post("하얀 이어폰 줄 하나 주웠어요", "제3공학관 1층 강의실 의자에 흰 유선 이어폰이 걸려 있었어요. 끝이 USB-C 모양이에요.", "전자기기", N, "제3공학관(Y19)", 11 * D + 10, 3,
      im("earphonesWired", "concrete", -18, { scale: 0.85, light: -0.15 })),
  },
  {
    pairId: "R04", itemType: "소니 무선 이어폰 한쪽", difficulty: "hard", locationRelation: "same_building_other_spot", timeRelation: "hours",
    keyClues: ["소니 WF-1000XM4 ≈ SONY 글씨", "왼쪽 유닛만", "검정", "체육관"],
    challenges: ["family", "detail"],
    existingConfusers: ["검은색 버즈 한쪽 분실"],
    lost: post("소니 이어폰 한쪽만 잃어버렸어요", "소니 WF-1000XM4 검은색 왼쪽 유닛만 없어졌어요. 체육관 헬스장에서 운동하다가 빠진 것 같아요. 케이스는 저한테 있어요.", "전자기기", N, "체육관(Y7)", 3 * D, 2),
    found: post("검은 이어폰 한 쪽 (유닛만)", "체육관 러닝머신 옆 바닥에 검은 무선 이어폰 한 쪽이 떨어져 있었어요. 동그랗고 옆에 SONY 글씨가 있어요.", "전자기기", N, "체육관(Y7)", 3 * D - 3, 1),
  },
  {
    pairId: "R05", itemType: "체크카드", difficulty: "easy", locationRelation: "same", timeRelation: "hours",
    keyClues: ["카카오뱅크 라이언 체크카드 ≈ 노란 캐릭터 카드", "학생회관 ATM"],
    challenges: ["category", "color"],
    existingConfusers: ["체크카드 분실"],
    lost: post("라이언 체크카드 분실", "카카오뱅크 라이언 체크카드(노란색)를 잃어버렸어요. 학생회관 1층 ATM에서 돈 뽑고 나서 없어졌어요.", "카드", I, "학생회관(S2)", 2 * D, 2,
      im("bankCard", "desk", -6, { color: "#f6d33c", accent: "#8a5a33", light: 0.3 })),
    found: post("ATM 옆에 카드 한 장", "학생회관 1층 ATM 옆 선반에 노란 캐릭터 그려진 카카오뱅크 카드가 있었어요. 학생회관 안내데스크에 맡겼어요.", "카드", I, "학생회관(S2)", 2 * D - 2, 1,
      im("bankCard", "floor", 16, { color: "#f6d33c", accent: "#8a5a33", scale: 0.8, skew: -5, light: -0.1 })),
  },
  {
    pairId: "R06", itemType: "맥세이프 카드지갑", difficulty: "hard", locationRelation: "same_building_other_spot", timeRelation: "within_day",
    keyClues: ["폰 뒤 카드 포켓 ≈ 자석 카드홀더", "네이비 가죽", "학생증 한 장", "국제관"],
    challenges: ["category", "paraphrase", "titleKeyword"],
    existingConfusers: ["휴대폰 카드케이스 주웠어요"],
    lost: post("폰 뒤에 붙이는 카드 포켓 분실", "폰 뒤에 자석으로 붙이는 네이비색 가죽 카드 포켓이에요. 안에 학생증 한 장만 들어 있어요. 국제관 2층 강의실 가는 길에 떨어진 것 같아요.", "액세서리", I, "국제관(S4)", 6 * D, 5,
      im("cardCase", "desk", 12, { color: "#23304f", light: 0.25 })),
    found: post("네이비 가죽 카드홀더 보관 중", "국제관 1층 계단 아래에서 자석 달린 남색 가죽 카드홀더를 주웠어요. 학생증 같은 카드가 한 장 꽂혀 있어요.", "지갑", I, "국제관(S4)", 6 * D - 7, 2,
      im("cardCase", "concrete", -20, { color: "#23304f", scale: 0.85, light: -0.15 })),
  },
  {
    pairId: "R07", itemType: "교통카드", difficulty: "medium", locationRelation: "same", timeRelation: "hours",
    keyClues: ["흰색 티머니 ≈ 하얀 카드", "캐릭터 없음", "정문 셔틀 정류장"],
    challenges: ["titleKeyword", "category", "color"],
    existingConfusers: ["교통카드 습득"],
    lost: post("교통카드 잃어버렸어요", "캐릭터 없는 흰색 티머니 카드예요. 정문 셔틀버스 정류장에서 줄 서다가 떨어뜨린 것 같아요.", "카드", I, "정문", 30, 2),
    found: post("정문 셔틀 정류장에서 하얀 카드 한 장", "정문 셔틀 타는 곳 바닥에 티머니 로고만 있는 흰 카드가 떨어져 있었어요. 경비실에 맡겼습니다.", "카드", I, "정문", 27, 1,
      im("bankCard", "concrete", 24, { color: "#f4f4f2", accent: "#e0484a", scale: 0.8, light: -0.1 })),
  },
  {
    pairId: "R08", itemType: "노트북 충전기", difficulty: "hard", locationRelation: "same_building_other_spot", timeRelation: "within_day",
    keyClues: ["갤럭시북 충전기 ≈ 삼성 로고 어댑터", "흰색 65W C타입", "선 끝 테이프", "MCC관"],
    challenges: ["related", "titleKeyword", "paraphrase"],
    existingConfusers: ["LG 그램 충전기 분실", "노트북 충전기만 없어졌어요"],
    lost: post("삼성 갤럭시북 충전기 잃어버렸어요", "갤럭시북 노트북 충전기예요. 흰색 65W C타입이고 선 끝에 파란 테이프를 감아놨어요. MCC관 5층 강의실에서 잃어버렸어요.", "전자기기", I, "MCC관(S10)", 8 * D, 6,
      im("charger", "desk", -8, { light: 0.25 })),
    found: post("흰색 어댑터 하나 보관 중", "MCC관 3층 강의실 콘센트에 흰색 충전 어댑터가 꽂혀 있었어요. 65W C타입이고 삼성 로고가 있어요. 케이블 끝에 테이프가 감겨 있습니다.", "전자기기", I, "MCC관(S10)", 8 * D - 9, 3,
      im("charger", "whiteTable", 20, { scale: 0.85, light: -0.05 })),
  },
  {
    pairId: "R09", itemType: "맥북 에어", difficulty: "medium", locationRelation: "same", timeRelation: "hours",
    keyClues: ["스페이스그레이 ≈ 회색", "우주인 스티커 ≈ 우주비행사 스티커", "명진당 4층"],
    challenges: ["related", "titleKeyword"],
    existingConfusers: ["검은색 노트북 두고 왔어요"],
    searchQuery: "우주인 스티커 붙은 회색 맥북 잃어버렸어요",
    lost: post("맥북 에어 두고 나왔어요", "스페이스그레이 맥북 에어예요. 뒷면에 우주인 스티커가 붙어 있어요. 명진당 4층 열람실에 두고 나왔는데 돌아가 보니 없었어요.", "전자기기", N, "명진당(Y3)", 4 * D, 3,
      im("laptop", "desk", -4, { color: "#7f8288", accent: "#3d6fb6", light: 0.2 })),
    found: post("명진당 4층에서 노트북 발견", "명진당 4층 열람실 끝자리에 회색 맥북이 덮인 채로 있었어요. 상판에 우주비행사 스티커가 있어요. 1층 데스크에 맡겼습니다.", "전자기기", N, "명진당(Y3)", 4 * D - 2, 1,
      im("laptop", "carpet", 14, { color: "#7f8288", accent: "#3d6fb6", scale: 0.8, skew: 4, light: -0.1 })),
  },
  {
    pairId: "R10", itemType: "텀블러", difficulty: "medium", locationRelation: "same_building_other_spot", timeRelation: "hours",
    keyClues: ["스타벅스 ≈ 별 로고", "민트색 스테인리스", "뚜껑 흠집", "차세대과학관"],
    challenges: ["color", "detail"],
    lost: post("스타벅스 텀블러 잃어버렸어요", "민트색 스타벅스 스테인리스 텀블러예요. 뚜껑에 긁힌 자국이 있어요. 차세대과학관 1층 카페에서 공부하고 두고 나왔어요.", "기타", N, "차세대과학관(Y23)", 7 * D, 3,
      im("tumbler", "desk", 6, { color: "#8fd3c4", light: 0.3 })),
    found: post("민트색 보온 텀블러 주웠습니다", "차세대과학관 로비 테이블에 민트색 스테인리스 텀블러가 있었어요. 별 모양 로고가 있고 뚜껑에 흠집이 있어요.", "기타", N, "차세대과학관(Y23)", 7 * D - 4, 2,
      im("tumbler", "whiteTable", -12, { color: "#8fd3c4", scale: 0.85, light: -0.05 })),
  },
  {
    pairId: "R11", itemType: "장우산", difficulty: "medium", locationRelation: "same", timeRelation: "days",
    keyClues: ["검은 장우산", "자동", "가죽 손잡이", "종합관 우산꽂이", "사흘 차이"],
    challenges: ["offset", "color"],
    lost: post("검은 장우산 잃어버렸어요", "자동으로 펴지는 검은 장우산이에요. 손잡이가 갈색 가죽으로 감싸져 있어요. 사흘 전에 종합관 1층 우산꽂이에 꽂아뒀는데 없어졌어요.", "기타", I, "종합관(S1)", 6 * D, 3 * D),
    found: post("종합관 우산꽂이에 검정 장우산", "종합관 1층 우산꽂이에 며칠째 검정 장우산이 남아 있어요. 손잡이가 가죽이에요. 경비실에 가져다 뒀습니다.", "기타", I, "종합관(S1)", 2 * D, 1),
  },
  {
    pairId: "R12", itemType: "볼캡", difficulty: "easy", locationRelation: "same", timeRelation: "hours",
    keyClues: ["뉴욕양키스 ≈ NY 자수", "남색", "대운동장 스탠드"],
    challenges: ["color", "paraphrase"],
    lost: post("뉴욕양키스 모자 분실", "남색 뉴욕양키스 볼캡이에요. 앞에 흰색 NY 자수가 있어요. 대운동장 스탠드에서 축구 보다가 두고 왔어요.", "의류", N, "대운동장", 10 * D, 3,
      im("cap", "bench", -6, { color: "#1d2b4f", accent: "#ffffff", light: 0.25 })),
    found: post("남색 야구모자 습득", "대운동장 스탠드 맨 윗줄에 남색 야구모자가 있었어요. 흰 NY 자수가 있어요.", "의류", N, "대운동장", 10 * D - 4, 2,
      im("cap", "concrete", 18, { color: "#1d2b4f", accent: "#ffffff", scale: 0.8, light: -0.1 })),
  },
  {
    pairId: "R13", itemType: "백팩", difficulty: "easy", locationRelation: "same", timeRelation: "hours",
    keyClues: ["잔스포츠 ≈ 배낭", "베이지", "앞주머니 뱃지", "행정동 벤치"],
    challenges: ["paraphrase"],
    lost: post("잔스포츠 백팩 분실", "베이지색 잔스포츠 백팩이에요. 앞주머니에 뱃지가 여러 개 달려 있어요. 행정동 앞 벤치에 잠깐 두고 자리를 비웠어요.", "가방", I, "행정동(S5)", 3 * D + 5, 2),
    found: post("행정동 벤치에 가방 하나", "행정동 앞 벤치에 베이지색 배낭이 놓여 있었어요. 앞쪽에 뱃지가 잔뜩 달려 있어요. 행정동 1층에 맡겼어요.", "가방", I, "행정동(S5)", 3 * D + 2, 1),
  },
  {
    pairId: "R14", itemType: "캐릭터 필통", difficulty: "medium", locationRelation: "same_building_other_spot", timeRelation: "within_day",
    keyClues: ["스누피 ≈ 강아지 캐릭터", "파란 파우치형 필통", "코이노니아홀"],
    challenges: ["paraphrase", "detail", "color"],
    lost: post("스누피 필통 잃어버렸어요", "파란색 스누피 파우치 필통이에요. 안에 제도 샤프랑 형광펜이 들어 있어요. 코이노니아홀 강의실에서 잃어버렸어요.", "필기구", I, "코이노니아홀", 14 * D, 5),
    found: post("강아지 캐릭터 그려진 파란 필통", "코이노니아홀 로비 의자에 흰 강아지 캐릭터가 그려진 파란 천 필통이 있었어요. 샤프랑 형광펜이 들어 있어요.", "필기구", I, "코이노니아홀", 14 * D - 6, 2),
  },
  {
    pairId: "R15", itemType: "제도 샤프", difficulty: "hard", locationRelation: "same", timeRelation: "hours",
    keyClues: ["로트링 600 ≈ rOtring 금속 샤프", "검정 금속", "제도실"],
    challenges: ["detail", "paraphrase"],
    lost: post("제도 샤프 잃어버렸어요", "로트링 600 검은색 금속 샤프예요. 오래 써서 그립 부분이 조금 벗겨졌어요. 디자인조형센터 제도실에서 잃어버렸어요.", "필기구", N, "디자인조형센터(Y12)", 16 * D, 4),
    found: post("검은 금속 샤프 한 자루", "디자인조형센터 제도실 책상에 무거운 검정 금속 샤프가 있었어요. 옆면에 rOtring 글씨가 있어요.", "필기구", N, "디자인조형센터(Y12)", 16 * D - 5, 2),
  },
  {
    pairId: "R16", itemType: "금목걸이", difficulty: "hard", locationRelation: "same_building_other_spot", timeRelation: "days",
    keyClues: ["14K 금 체인 ≈ 금색 목걸이", "작은 하트 펜던트", "체육관 탈의실 ↔ 사물함", "일주일 차이"],
    challenges: ["offset", "detail"],
    lost: post("금목걸이 잃어버렸어요", "얇은 14K 금 체인에 작은 하트 펜던트가 달린 목걸이예요. 일주일 전쯤 체육관 탈의실에서 샤워하기 전에 빼둔 것 같아요.", "액세서리", N, "체육관(Y7)", 9 * D, 7 * D),
    found: post("하트 목걸이 습득", "체육관 사물함 근처 바닥에 금색 하트 목걸이가 떨어져 있었어요. 체육관 사무실에 맡겼어요.", "액세서리", N, "체육관(Y7)", 3 * D, 2),
  },
  {
    pairId: "R17", itemType: "3단 우산", difficulty: "medium", locationRelation: "adjacent", timeRelation: "days",
    keyClues: ["분홍 체크 ≈ 핑크 체크무늬", "3단 ≈ 접이식", "학생복지관 ↔ 학생회관"],
    challenges: ["offset", "paraphrase", "detail"],
    lost: post("분홍 체크 3단우산 분실", "분홍색 체크무늬 3단 우산이에요. 이틀 전에 학생복지관 식당에 들렀다가 두고 나온 것 같아요.", "기타", N, "학생복지관(Y21)", 4 * D, 2 * D),
    found: post("핑크 체크무늬 접이식 우산", "학생회관(자연) 1층 입구 쪽에 핑크 체크무늬 접이식 우산이 있었어요. 커버는 없어요.", "기타", N, "학생회관(Y1)", 2 * D, 2),
  },
  {
    pairId: "R18", itemType: "전공서적", difficulty: "easy", locationRelation: "same", timeRelation: "hours",
    keyClues: ["C로 쓴 자료구조", "파란 표지", "제1공학관"],
    challenges: ["detail"],
    lost: post("자료구조 책 분실", "'C로 쓴 자료구조' 파란 표지 책이에요. 이름은 안 써놨어요. 제1공학관 3층 강의실에서 잃어버렸어요.", "책", N, "제1공학관(Y_)", 13 * D, 3),
    found: post("파란 표지 자료구조 교재", "제1공학관 3층 강의실 사물함 위에 파란 표지 자료구조 책이 있었어요. C언어 책이에요.", "책", N, "제1공학관(Y_)", 13 * D - 4, 1),
  },
  {
    pairId: "R19", itemType: "토익 문제집", difficulty: "medium", locationRelation: "same", timeRelation: "hours",
    keyClues: ["해커스 토익 RC", "빨간 표지", "필기 많음", "방목학술정보관 열람실"],
    challenges: ["titleKeyword", "color"],
    lost: post("토익 문제집 두고 왔어요", "해커스 토익 RC 빨간 책이에요. 문법 파트에 필기가 많아요. 방목학술정보관 3층 열람실에 두고 나왔어요.", "책", I, "방목학술정보관(S9)", 11 * D, 3),
    found: post("빨간 영어 문제집 보관", "방목 3층 열람실 책상에 빨간 표지 해커스 RC 문제집이 있었어요. 안에 연필 필기가 가득해요.", "책", I, "방목학술정보관(S9)", 11 * D - 3, 1),
  },
  {
    pairId: "R20", itemType: "롱패딩", difficulty: "medium", locationRelation: "same", timeRelation: "hours",
    keyClues: ["노스페이스 검정 롱패딩", "지퍼 고장", "학생회관(자연) 식당"],
    challenges: ["color", "detail"],
    lost: post("검정 롱패딩 분실", "노스페이스 검정 롱패딩이에요. 지퍼 손잡이가 떨어져서 클립을 달아놨어요. 자연캠 학생회관 식당 의자에 걸어두고 나왔어요.", "의류", N, "학생회관(Y1)", 20 * D, 2),
    found: post("검은 롱패딩 걸려있어요", "학생회관 2층 식당 의자 뒤에 검은 롱패딩이 걸려 있었어요. 지퍼에 클립이 달려 있어요. 식당 카운터에 맡겼습니다.", "의류", N, "학생회관(Y1)", 20 * D - 3, 1),
  },
  {
    pairId: "R21", itemType: "털장갑", difficulty: "hard", locationRelation: "lost_unknown", timeRelation: "within_day",
    keyClues: ["털장갑 한 쪽 ≈ 니트 손모아장갑 한 짝", "베이지 ≈ 연갈색", "오른쪽"],
    challenges: ["paraphrase", "offset"],
    lost: post("털장갑 한 쪽 잃어버렸어요", "베이지색 니트 털장갑 오른쪽 한 짝이에요. 오늘 인문캠 여기저기 돌아다녀서 어디서 떨어뜨렸는지 모르겠어요.", "의류", I, "강경대민주광장", 26, null),
    found: post("니트 손모아장갑 한 짝", "강경대민주광장 벤치에 연갈색 니트 손모아장갑 한 짝이 있었어요. 오른손 쪽이에요.", "의류", I, "강경대민주광장", 20, 2),
  },
  {
    pairId: "R22", itemType: "블루투스 키보드", difficulty: "medium", locationRelation: "same", timeRelation: "hours",
    keyClues: ["로지텍 K380", "분홍색", "동글동글한 키", "창조예술관"],
    challenges: ["related", "color"],
    lost: post("블루투스 키보드 분실", "로지텍 K380 분홍색 블루투스 키보드예요. 키가 동그란 모양이에요. 창조예술관 3층 과실에서 잃어버렸어요.", "전자기기", N, "창조예술관(Y2)", 17 * D, 3),
    found: post("분홍 키보드 습득", "창조예술관 3층 복도 테이블에 분홍색 무선 키보드가 있었어요. 동그란 키가 달린 작은 키보드예요.", "전자기기", N, "창조예술관(Y2)", 17 * D - 5, 2),
  },
  {
    pairId: "R23", itemType: "폴더블폰", difficulty: "medium", locationRelation: "same", timeRelation: "hours",
    keyClues: ["Z플립5 ≈ 접히는 휴대폰", "라벤더 ≈ 보라색", "투명 케이스", "대운동장"],
    challenges: ["paraphrase", "color", "family"],
    existingConfusers: ["아이폰 15 분실 (투명 케이스)"],
    lost: post("갤럭시 Z플립 분실", "라벤더색 Z플립5에 투명 케이스를 씌웠어요. 대운동장에서 운동하고 벤치에 두고 왔어요.", "전자기기", N, "대운동장", 25 * D, 2),
    found: post("접히는 휴대폰 주웠어요", "대운동장 벤치에서 보라색 폴더블폰을 주웠어요. 투명 케이스가 씌워져 있어요. 학생복지관 안내실에 맡겼어요.", "전자기기", N, "대운동장", 25 * D - 2, 1),
  },
  {
    pairId: "R24", itemType: "목걸이 카드케이스", difficulty: "medium", locationRelation: "same_building_other_spot", timeRelation: "within_day",
    keyClues: ["목걸이 카드지갑 ≈ 목걸이 카드케이스", "파란 스트랩", "학생증+교통카드", "국제관"],
    challenges: ["category", "paraphrase"],
    lost: post("목걸이 카드지갑 잃어버렸어요", "파란 스트랩 달린 목걸이형 카드지갑이에요. 안에 경영정보학과 학생증이랑 교통카드가 들어 있어요. 국제관에서 잃어버렸어요.", "카드", I, "국제관(S4)", 18 * D, 5,
      im("cardCase", "desk", -10, { color: "#2f6fed", accent: "#f3f3f3", strap: true, light: 0.25 })),
    found: post("파란 목걸이 카드케이스", "국제관 3층 화장실 앞에 파란 줄이 달린 카드케이스가 떨어져 있었어요. 학생증이랑 교통카드가 들어 있어요.", "지갑", I, "국제관(S4)", 18 * D - 6, 2,
      im("cardCase", "floor", 15, { color: "#2f6fed", accent: "#f3f3f3", strap: true, scale: 0.8, light: -0.15 })),
  },
  {
    pairId: "R25", itemType: "맥세이프 배터리", difficulty: "hard", locationRelation: "adjacent", timeRelation: "within_day",
    keyClues: ["애플 맥세이프 배터리 ≈ 흰 무선 배터리 팩", "채플관 ↔ 방목기념관"],
    challenges: ["family", "related", "color", "offset"],
    existingConfusers: ["흰색 보조배터리 잃어버렸어요", "분홍 맥세이프 배터리 분실"],
    lost: post("애플 맥세이프 배터리 잃어버렸어요", "애플 정품 흰색 맥세이프 배터리예요. 폰 뒤에 붙여 쓰다가 떨어졌어요. 60주년 채플관 예배 끝나고 없어졌어요.", "전자기기", N, "60주년 채플관(Y22)", 15 * D, 5,
      im("powerBank", "desk", 12, { color: "#f6f6f4", scale: 0.75, light: 0.25 })),
    found: post("흰 무선 배터리 팩", "방목기념관 입구 쪽 계단에서 휴대폰 뒤에 붙는 흰색 배터리 팩을 주웠어요. 케이블 단자 하나 있어요.", "전자기기", N, "방목기념관(Y16)", 15 * D - 7, 3,
      im("powerBank", "concrete", -22, { color: "#f6f6f4", scale: 0.7, skew: 5, light: -0.15 })),
  },
  {
    pairId: "R26", itemType: "애플펜슬", difficulty: "hard", locationRelation: "same_building_other_spot", timeRelation: "hours",
    keyClues: ["애플펜슬 2세대 ≈ 자석 붙는 흰 펜", "분홍 실리콘 캡", "산학협력관"],
    challenges: ["paraphrase", "related", "family"],
    existingConfusers: ["애플펜슬만 주웠어요", "아이패드 에어 + 애플펜슬 분실"],
    lost: post("애플펜슬 2세대 분실", "애플펜슬 2세대예요. 펜 끝에 분홍 실리콘 캡을 씌워놨어요. 산학협력관 4층 세미나실에서 잃어버렸어요.", "전자기기", N, "산학협력관(Y17)", 21 * D, 3),
    found: post("흰 스타일러스 펜 습득", "산학협력관 2층 휴게실에 자석이 붙는 흰색 태블릿 펜이 있었어요. 끝에 분홍색 캡이 끼워져 있어요.", "전자기기", N, "산학협력관(Y17)", 21 * D - 5, 2),
  },
  {
    pairId: "R27", itemType: "체육복", difficulty: "easy", locationRelation: "same", timeRelation: "hours",
    keyClues: ["초록 체육복 상의", "등에 명지 ICT", "체육문화관"],
    challenges: ["color"],
    lost: post("학과 체육복 상의 분실", "초록색 학과 체육복 상의예요. 등에 '명지 ICT'라고 쓰여 있어요. 체육문화관 탈의실에 두고 나왔어요.", "의류", N, "체육문화관(Y6)", 22 * D, 2),
    found: post("초록 체육복 상의 주웠어요", "체육문화관 탈의실 벤치에 초록색 체육복 윗도리가 있었어요. 등에 명지 ICT 글씨가 있어요.", "의류", N, "체육문화관(Y6)", 22 * D - 3, 1),
  },
  {
    pairId: "R28", itemType: "과잠", difficulty: "medium", locationRelation: "adjacent", timeRelation: "days",
    keyClues: ["남색 과잠", "등에 BUSINESS", "소매 21", "종합관 ↔ 학생회관", "사흘 차이"],
    challenges: ["offset", "detail", "color"],
    lost: post("과잠 잃어버렸어요 (경영)", "남색 경영학과 과잠이에요. 등에 BUSINESS, 왼쪽 소매에 21이 새겨져 있어요. 종합관 강의실에서 벗어두고 사흘 전에 잃어버렸어요.", "의류", I, "종합관(S1)", 8 * D, 3 * D),
    found: post("남색 과잠 보관중", "학생회관 2층 라운지 소파에 남색 과잠이 며칠째 있어요. 등에 BUSINESS 영문 자수, 소매에 숫자 21이 있어요.", "의류", I, "학생회관(S2)", 5 * D, 2),
  },
  {
    pairId: "R29", itemType: "에어팟 실리콘 커버", difficulty: "hard", locationRelation: "same", timeRelation: "hours",
    keyClues: ["실리콘 커버만 ≈ 케이스만(이어폰 없음)", "분홍", "베리타스홀"],
    challenges: ["titleKeyword", "category", "family"],
    lost: post("에어팟 실리콘 커버만 잃어버렸어요", "에어팟 본체는 있고 분홍색 실리콘 커버만 빠져서 잃어버렸어요. 베리타스홀 강의실 책상 근처예요.", "액세서리", I, "베리타스홀", 24 * D, 2,
      im("airpodsCase", "desk", 18, { color: "#f2a9bd", light: 0.3 })),
    found: post("분홍색 에어팟 케이스 습득", "베리타스홀 강의실 책상 밑에 분홍색 실리콘 에어팟 케이스가 있었어요. 안에 이어폰은 없고 커버만이에요.", "전자기기", I, "베리타스홀", 24 * D - 3, 1,
      im("airpodsCase", "floor", -14, { color: "#f2a9bd", scale: 0.8, light: -0.1 })),
  },
  {
    pairId: "R30", itemType: "도시락 가방", difficulty: "easy", locationRelation: "same", timeRelation: "hours",
    keyClues: ["체크무늬 보냉 도시락 가방 ≈ 체크 보냉백", "스텐 도시락", "명원"],
    challenges: ["paraphrase"],
    existingConfusers: ["체크무늬 목도리 분실"],
    lost: post("도시락 가방 두고 왔어요", "빨간 체크무늬 보냉 도시락 가방이에요. 안에 스텐 도시락통이 들어 있어요. 명원 벤치에서 점심 먹고 두고 왔어요.", "가방", N, "명원", 23 * D, 2),
    found: post("체크무늬 보냉백 습득", "명원 벤치에 빨간 체크 보냉백이 있었어요. 안에 스테인리스 도시락통이 있어요.", "가방", N, "명원", 23 * D - 3, 1),
  },
];

// ---------------------------------------------------------------------------
// Hard negative 50개 (G01~G50)
// ---------------------------------------------------------------------------
function neg(negId: string, board: Board, itemType: string, confusableWith: string[], challenges: Challenge[], whyNotMatch: string, p: PostSpec): Negative3 {
  return { negId, board, itemType, confusableWith, challenges, whyNotMatch, post: p };
}

export const NEGATIVES3: Negative3[] = [
  neg("G01", "found", "에어팟 프로", ["R01", "P08"], ["family", "titleKeyword"], "같은 건물 에어팟이지만 프로 케이스이고 스티커·각인 없음",
    post("에어팟 프로 케이스 주웠어요", "방목학술정보관 2층 복도 의자에 에어팟 프로 케이스가 있었어요. 스티커나 각인은 없어요.", "전자기기", I, "방목학술정보관(S9)", 4 * D + 20, 2,
      im("airpodsProCase", "whiteTable", -12, { variant: "noSticker", scale: 0.85 }))),
  neg("G02", "found", "갤럭시 버즈", ["R01"], ["family", "color"], "같은 건물 흰 무선이어폰 케이스지만 삼성 버즈",
    post("흰색 갤럭시 버즈 케이스", "방목 1층 로비 소파에 흰색 갤럭시 버즈 케이스가 있었어요. 각인은 없어요.", "전자기기", I, "방목학술정보관(S9)", 6 * D, 2,
      im("budsCase", "carpet", 10, { color: "#f1f1ef", scale: 0.85, light: 0 }))),
  neg("G03", "found", "필통", ["R02"], ["color"], "같은 건물 보라색 물건이지만 필통",
    post("보라색 필통 주웠어요", "제1공학관 1층 라운지 테이블에 연보라색 지퍼 필통이 있었어요.", "필기구", N, "제1공학관(Y_)", 9 * D - 2, 2)),
  neg("G04", "found", "갤럭시 버즈2", ["R02"], ["family", "titleKeyword"], "같은 건물 버즈 케이스지만 민트색",
    post("민트색 버즈2 케이스 주웠어요", "제1공학관 2층 강의실에 민트색 갤럭시 버즈2 케이스가 있었어요.", "전자기기", N, "제1공학관(Y_)", 8 * D, 3,
      im("budsCase", "desk", -18, { color: "#9ad9c6", scale: 0.85 }))),
  neg("G05", "found", "충전 케이블", ["R03"], ["related", "color"], "인접 건물 흰 C타입이지만 이어폰이 아닌 충전 케이블",
    post("흰색 C타입 케이블 주웠어요", "제2공학관 1층 콘센트에 흰색 C to C 충전 케이블이 꽂혀 있었어요.", "전자기기", N, "제2공학관(Y8)", 12 * D - 4, 2)),
  neg("G06", "found", "에어팟 유닛", ["R04"], ["family", "color"], "같은 건물 무선이어폰 한 쪽이지만 흰색 에어팟",
    post("무선 이어폰 한쪽 (흰색)", "체육관 1층 자판기 앞에서 흰색 에어팟 한쪽을 주웠어요. 오른쪽이에요.", "전자기기", N, "체육관(Y7)", 2 * D, 2)),
  neg("G07", "found", "카드지갑", ["R05"], ["category", "color"], "같은 건물 노란 물건이지만 카드가 아닌 카드지갑(빈 지갑)",
    post("노란 카드지갑 주웠어요", "학생회관 1층 편의점 앞에서 노란색 가죽 카드지갑을 주웠어요. 안은 비어 있어요.", "지갑", I, "학생회관(S2)", 2 * D + 5, 2,
      im("cardCase", "floor", 8, { color: "#e8c23a", scale: 0.8 }))),
  neg("G08", "found", "교통카드", ["R05"], ["category", "detail"], "같은 건물 카드지만 파란 교통카드",
    post("교통카드 한 장 습득 (파란색)", "학생회관 1층 계단에서 파란색 교통카드를 주웠어요. 은행 카드는 아니에요.", "카드", I, "학생회관(S2)", 3 * D, 2,
      im("bankCard", "concrete", -10, { color: "#2f6fed", accent: "#ffd166", scale: 0.8 }))),
  neg("G09", "found", "회원카드", ["R06", "P06"], ["titleKeyword", "category"], "같은 건물 카드 한 장이지만 헬스장 회원카드",
    post("카드 한 장 주웠어요", "국제관 1층 로비에서 카드 한 장을 주웠어요. 헬스장 회원카드 같아요.", "카드", I, "국제관(S4)", 5 * D, 2)),
  neg("G10", "found", "반지갑", ["R06"], ["color", "category"], "같은 건물 네이비 가죽이지만 반지갑",
    post("네이비 반지갑 주웠어요", "국제관 2층 강의실 뒷자리에 네이비색 가죽 반지갑이 있었어요. 현금이 조금 들어 있어요.", "지갑", I, "국제관(S4)", 7 * D, 3)),
  neg("G11", "found", "카드지갑", ["R07"], ["color", "category"], "같은 장소 흰색이지만 카드지갑",
    post("흰색 카드지갑 습득", "정문 버스정류장 벤치에 흰색 카드지갑이 있었어요. 안에 카드는 없어요.", "지갑", I, "정문", 2 * D, 2,
      im("cardCase", "bench", 10, { color: "#f1f0ec", scale: 0.8 }))),
  neg("G12", "found", "신용카드", ["R07", "P06"], ["category", "detail"], "같은 장소 카드지만 검은 신용카드",
    post("정문 앞에서 신용카드 주웠어요", "정문 횡단보도 앞에서 검은색 신용카드를 주웠어요. 경비실에 맡겼어요.", "카드", I, "정문", 36, 2,
      im("bankCard", "concrete", 14, { color: "#1c1c1f", accent: "#c9a44c", scale: 0.8 }))),
  neg("G13", "found", "노트북", ["R08"], ["titleKeyword", "related"], "같은 건물 갤럭시북이지만 충전기가 아닌 노트북 본체",
    post("갤럭시북 노트북 주웠어요", "MCC관 4층 스터디룸에 그라파이트색 갤럭시북 노트북이 있었어요. 충전기는 없었어요.", "전자기기", I, "MCC관(S10)", 7 * D, 3,
      im("laptop", "desk", 6, { color: "#4a4d52", scale: 0.8 }))),
  neg("G14", "found", "노트북 파우치", ["R08", "R09"], ["related"], "노트북 관련 물건이지만 파우치",
    post("노트북 파우치 보관 중", "MCC관 1층 로비에 회색 펠트 노트북 파우치가 있었어요. 안은 비어 있어요.", "가방", I, "MCC관(S10)", 9 * D, 2)),
  neg("G15", "found", "보조배터리", ["R08", "Q02", "R25"], ["related", "color"], "흰색 전자기기지만 앤커 보조배터리",
    post("흰색 보조배터리 습득 (앤커)", "MCC관 2층 콘센트 옆에 흰색 앤커 보조배터리가 있었어요. 케이블은 없어요.", "전자기기", I, "MCC관(S10)", 8 * D + 5, 2,
      im("powerBank", "whiteTable", -8, { color: "#f4f4f2", scale: 0.85 }))),
  neg("G16", "found", "맥북 충전기", ["R09"], ["titleKeyword", "related"], "같은 건물 맥북 관련이지만 충전기",
    post("맥북 충전기 주웠어요", "명진당 3층 열람실 콘센트에 흰색 맥북 충전기가 꽂혀 있었어요.", "전자기기", N, "명진당(Y3)", 4 * D + 6, 2,
      im("charger", "carpet", 12, { scale: 0.85 }))),
  neg("G17", "found", "맥북 프로", ["R09"], ["titleKeyword", "detail"], "맥북이지만 은색 프로, 스티커 없음, 다른 건물",
    post("은색 맥북 프로 보관", "자연도서관 2층에 은색 맥북 프로가 남아 있었어요. 스티커는 없어요.", "전자기기", N, "자연도서관", 5 * D, 3,
      im("laptop", "whiteTable", -10, { color: "#c9cbce", scale: 0.8 }))),
  neg("G18", "found", "필통", ["R10"], ["color"], "같은 건물 민트색 물건이지만 필통",
    post("민트색 필통 습득", "차세대과학관 1층 카페 테이블에 민트색 필통이 있었어요.", "필기구", N, "차세대과학관(Y23)", 7 * D + 3, 2)),
  neg("G19", "found", "텀블러", ["R10"], ["detail", "color"], "같은 건물 텀블러지만 하늘색, 로고 없음",
    post("하늘색 텀블러 보관 중", "차세대과학관 3층 실험실 앞 복도에 하늘색 텀블러가 있었어요. 로고는 없어요.", "기타", N, "차세대과학관(Y23)", 6 * D, 2,
      im("tumbler", "concrete", 8, { color: "#9cc9ec", accent: "#f4f4f2", scale: 0.85 }))),
  neg("G20", "found", "백팩", ["R11"], ["color"], "같은 건물 검은색이지만 백팩",
    post("검은색 백팩 주웠어요", "종합관 1층 로비 의자에 검은색 백팩이 있었어요. 안에 필기구가 들어 있어요.", "가방", I, "종합관(S1)", 3 * D, 2)),
  neg("G21", "found", "3단 우산", ["R11"], ["family", "detail"], "같은 건물 검은 우산이지만 3단 접이식",
    post("검정 3단 우산 습득", "종합관 2층 강의실 뒤에 검정 3단 접이식 우산이 있었어요.", "기타", I, "종합관(S1)", 4 * D, 2)),
  neg("G22", "found", "후드티", ["R12"], ["color"], "같은 장소 남색이지만 후드티",
    post("남색 후드티 주웠어요", "대운동장 스탠드에 남색 후드티가 놓여 있었어요.", "의류", N, "대운동장", 10 * D - 8, 2)),
  neg("G23", "found", "볼캡", ["R12", "Q08"], ["detail", "color"], "같은 장소 NY 볼캡이지만 검은색에 빨간 자수",
    post("검은 NY 볼캡 습득", "대운동장 트랙 옆에 검은색 NY 볼캡이 있었어요. 자수가 빨간색이에요.", "의류", N, "대운동장", 9 * D, 2,
      im("cap", "bench", 12, { color: "#18181b", accent: "#d6453d", scale: 0.8 }))),
  neg("G24", "found", "에코백", ["R13", "P20"], ["color", "family"], "같은 장소 베이지 가방이지만 에코백",
    post("베이지 에코백 주웠어요", "행정동 1층 민원실 앞에 베이지색 에코백이 있었어요. 안은 비어 있어요.", "가방", I, "행정동(S5)", 4 * D, 2,
      im("ecoBagEmpty", "floor", 6, { scale: 0.85 }))),
  neg("G25", "found", "필통", ["R14"], ["color", "detail"], "같은 건물 파란 필통이지만 캐릭터 없는 민무늬",
    post("파란 필통 보관 중", "코이노니아홀 2층 강의실에 캐릭터 없는 남색 필통이 있었어요.", "필기구", I, "코이노니아홀", 13 * D, 2)),
  neg("G26", "found", "볼펜", ["R15"], ["detail"], "같은 브랜드지만 로트링 볼펜",
    post("로트링 볼펜 습득", "디자인조형센터 1층 로비에서 은색 로트링 볼펜을 주웠어요.", "필기구", N, "디자인조형센터(Y12)", 15 * D, 2)),
  neg("G27", "found", "목걸이", ["R16"], ["detail", "color"], "같은 건물 목걸이지만 은색",
    post("은색 목걸이 주웠어요", "체육관 샤워실 앞 세면대에 은색 체인 목걸이가 있었어요.", "액세서리", N, "체육관(Y7)", 5 * D, 2)),
  neg("G28", "found", "귀걸이", ["R16"], ["detail"], "같은 건물 금색 액세서리지만 귀걸이 한 짝",
    post("금색 귀걸이 한 짝", "체육관 탈의실 바닥에 금색 링 귀걸이 한 짝이 떨어져 있었어요.", "액세서리", N, "체육관(Y7)", 6 * D, 2)),
  neg("G29", "found", "장우산", ["R17"], ["family", "color"], "분홍 우산이지만 장우산, 체크 없음",
    post("분홍색 장우산 습득", "학생복지관 입구 우산꽂이에 무늬 없는 분홍색 장우산이 있었어요.", "기타", N, "학생복지관(Y21)", 3 * D, 2)),
  neg("G30", "found", "전공서적", ["R18"], ["detail", "color"], "같은 건물 파란 표지지만 알고리즘 책",
    post("파란 표지 알고리즘 책", "제1공학관 2층 강의실에 파란 표지 알고리즘 책이 있었어요.", "책", N, "제1공학관(Y_)", 12 * D, 2)),
  neg("G31", "found", "토익 LC", ["R19"], ["titleKeyword", "detail"], "같은 건물 토익책이지만 LC, 초록 표지",
    post("토익 LC 책 주웠어요", "방목 2층 열람실에 초록 표지 토익 LC 책이 있었어요. 필기는 없어요.", "책", I, "방목학술정보관(S9)", 10 * D, 2)),
  neg("G32", "found", "노트", ["R19"], ["color"], "같은 건물 빨간 표지지만 스프링 노트",
    post("빨간 노트 주웠어요", "방목 3층 복도에서 빨간 스프링 노트를 주웠어요.", "책", I, "방목학술정보관(S9)", 11 * D - 8, 2)),
  neg("G33", "found", "숏패딩", ["R20"], ["detail", "color"], "같은 건물 검정 패딩이지만 숏패딩",
    post("검정 숏패딩 습득", "학생회관(자연) 1층 로비 의자에 검정 숏패딩이 있었어요.", "의류", N, "학생회관(Y1)", 19 * D, 2)),
  neg("G34", "found", "코트", ["R20"], ["color"], "같은 건물 검은 외투지만 울 코트",
    post("검은색 코트 주웠어요", "학생회관(자연) 2층 식당 옷걸이에 검은색 울 코트가 걸려 있었어요.", "의류", N, "학생회관(Y1)", 21 * D, 2)),
  neg("G35", "found", "목도리", ["R21", "Q07"], ["color", "family"], "베이지 니트지만 목도리",
    post("베이지 목도리 주웠어요", "강경대민주광장 옆 계단에 베이지색 니트 목도리가 있었어요.", "의류", I, "강경대민주광장", 30, 2)),
  neg("G36", "found", "마우스", ["R22"], ["related", "color"], "같은 건물 분홍 전자기기지만 마우스",
    post("분홍색 마우스 주웠어요", "창조예술관 3층 과실 앞에서 분홍색 무선 마우스를 주웠어요.", "전자기기", N, "창조예술관(Y2)", 16 * D, 2,
      im("mouse", "desk", 14, { color: "#f2a9bd", scale: 0.85 }))),
  neg("G37", "found", "지갑", ["R23"], ["color"], "같은 장소 보라색이지만 지갑",
    post("보라색 지갑 주웠어요", "대운동장 벤치 밑에 보라색 반지갑이 떨어져 있었어요.", "지갑", N, "대운동장", 24 * D, 2)),
  neg("G38", "found", "휴대폰", ["R23"], ["family", "color"], "보라색 휴대폰이지만 폴더블이 아닌 갤럭시 S24",
    post("보라색 갤럭시 S24 습득", "학생복지관 식당에서 보라색 갤럭시 S24를 주웠어요. 케이스는 없어요.", "전자기기", N, "학생복지관(Y21)", 26 * D, 2)),
  neg("G39", "found", "은행카드", ["R24"], ["color", "category"], "같은 건물 파란 카드지만 은행카드 한 장",
    post("파란 카드 주웠어요", "국제관 1층 엘리베이터 앞에서 파란색 은행카드를 주웠어요.", "카드", I, "국제관(S4)", 17 * D, 2,
      im("bankCard", "floor", -12, { color: "#2f6fed", accent: "#ffffff", scale: 0.8 }))),
  neg("G40", "found", "무선 충전 패드", ["R25"], ["related", "color"], "흰색 충전 기기지만 무선 충전 패드",
    post("무선 충전 패드 주웠어요", "60주년 채플관 로비 테이블에 흰색 원형 무선 충전 패드가 있었어요.", "전자기기", N, "60주년 채플관(Y22)", 14 * D, 2)),
  neg("G41", "found", "볼펜", ["R26"], ["color", "related"], "흰색 펜이지만 볼펜",
    post("흰색 볼펜 주웠어요", "산학협력관 4층 세미나실에서 흰색 볼펜을 주웠어요.", "필기구", N, "산학협력관(Y17)", 20 * D, 2)),
  neg("G42", "found", "S펜", ["R26"], ["family"], "태블릿 펜이지만 갤럭시 S펜",
    post("갤럭시 S펜 습득", "산학협력관 1층 로비에서 검은색 갤럭시 S펜을 주웠어요.", "전자기기", N, "산학협력관(Y17)", 22 * D, 2)),
  neg("G43", "found", "과잠", ["R27"], ["color", "family"], "같은 건물 초록 옷이지만 과잠",
    post("초록 과잠 주웠어요", "체육문화관 1층 로비에 초록색 과잠이 놓여 있었어요. 등에 영문 자수가 있어요.", "의류", N, "체육문화관(Y6)", 21 * D, 2)),
  neg("G44", "found", "과잠", ["R28"], ["detail", "color"], "경영학과 과잠이지만 검정",
    post("검정 경영학과 과잠 습득", "종합관 3층 강의실에서 검은색 경영학과 과잠을 주웠어요. 소매 숫자는 23이에요.", "의류", I, "종합관(S1)", 6 * D, 2)),
  neg("G45", "found", "에어팟", ["R29"], ["titleKeyword", "family"], "같은 건물 분홍 케이스지만 이어폰까지 든 에어팟",
    post("에어팟 주웠어요 (분홍 케이스)", "베리타스홀 복도에서 분홍 실리콘 케이스 씌운 에어팟을 주웠어요. 이어폰 두 쪽 다 들어 있어요.", "전자기기", I, "베리타스홀", 23 * D, 2,
      im("airpodsCase", "concrete", 20, { color: "#f2a9bd", scale: 0.8 }))),
  // Lost-board negatives for the found -> lost direction.
  neg("G46", "lost", "체크카드", ["R05"], ["color", "detail"], "노란 카드지만 캐릭터 없는 신한 카드",
    post("노란 체크카드 분실 (신한)", "캐릭터 없는 노란색 신한 체크카드를 잃어버렸어요. 인문캠 학생회관 근처인 것 같아요.", "카드", I, "학생회관(S2)", 3 * D, 4)),
  neg("G47", "lost", "맥북 프로", ["R09"], ["family", "detail"], "맥북이지만 프로, 스티커 없음, 다른 건물",
    post("스페이스그레이 맥북 프로 분실", "스티커 없는 스페이스그레이 맥북 프로를 제3공학관 실습실에서 잃어버렸어요.", "전자기기", N, "제3공학관(Y19)", 5 * D, 3)),
  neg("G48", "lost", "보온병", ["R10"], ["color", "detail"], "민트색 보온병이지만 써모스, 다른 건물",
    post("민트 텀블러 (써모스) 잃어버렸어요", "민트색 써모스 보온병을 명진당 2층에서 잃어버렸어요. 로고는 작게 써모스라고 있어요.", "기타", N, "명진당(Y3)", 8 * D, 3)),
  neg("G49", "lost", "비니", ["R12"], ["color", "family"], "남색 모자지만 니트 비니",
    post("남색 모자 잃어버렸어요 (비니)", "남색 니트 비니를 대운동장 근처에서 잃어버렸어요.", "의류", N, "대운동장", 11 * D, 3)),
  neg("G50", "lost", "에어팟 2세대", ["R29"], ["family", "titleKeyword"], "에어팟이지만 투명 커버 씌운 본체 전체, 다른 건물",
    post("에어팟 통째로 잃어버렸어요", "투명 케이스 씌운 에어팟 2세대를 케이스째로 잃어버렸어요. 체육관 헬스장인 것 같아요.", "전자기기", N, "체육관(Y7)", 12 * D, 4)),
];

// ---------------------------------------------------------------------------
// No-match 40개 (M11~M50): 정답이 되는 게시글이 DB 어디에도 없다.
// proximity "near"는 비슷한 계열 물건이 DB에 있어 억지 추천이 나오기 쉬운
// 경우, "far"는 비슷한 물건 자체가 거의 없는 경우.
// ---------------------------------------------------------------------------
function nm(noMatchId: string, board: Board, nearestTheme: string, proximity: "near" | "far", p: PostSpec): NoMatch3 {
  return { noMatchId, board, nearestTheme, proximity, post: p };
}

export const NO_MATCH3: NoMatch3[] = [
  nm("M11", "lost", "텀블러", "near", post("보라색 텀블러 잃어버렸어요", "보라색 플라스틱 빨대 텀블러를 제5공학관 강의실에서 잃어버렸어요.", "기타", N, "제5공학관(Y5)", 11 * D, 3,
    im("tumbler", "desk", -8, { color: "#8e6cc9", accent: "#f4f4f2" }))),
  nm("M12", "lost", "노트북", "near", post("분홍 노트북 잃어버렸어요", "분홍색 13인치 노트북을 미래관 스터디룸에 두고 나왔어요.", "전자기기", I, "미래관(S3)", 13 * D, 3,
    im("laptop", "desk", 8, { color: "#e8b4c0" }))),
  nm("M13", "found", "모자", "near", post("빨간 볼캡 습득", "학생회관(자연) 앞 벤치에 빨간색 볼캡이 있었어요. 로고는 흰 글씨예요.", "의류", N, "학생회관(Y1)", 16 * D, 2,
    im("cap", "bench", -10, { color: "#c2342b", accent: "#ffffff" }))),
  nm("M14", "found", "마우스", "near", post("연두색 무선 마우스 주웠어요", "공동실험동 1층에서 연두색 무선 마우스를 주웠어요.", "전자기기", N, "공동실험동(Y18)", 19 * D, 2,
    im("mouse", "whiteTable", 20, { color: "#a6d65a" }))),
  nm("M15", "lost", "안경", "near", post("빨간 뿔테 안경 분실", "빨간색 뿔테 안경을 코이노니아홀 화장실에서 잃어버렸어요.", "액세서리", I, "코이노니아홀", 12 * D, 2,
    im("glasses", "desk", 6, { color: "#b3261e" }))),
  nm("M16", "lost", "스마트기기", "near", post("갤럭시 워치 분실", "검은색 갤럭시 워치를 체육문화관 농구장에서 잃어버렸어요.", "전자기기", N, "체육문화관(Y6)", 14 * D, 2)),
  nm("M17", "lost", "이어폰/헤드폰", "near", post("소니 헤드폰 잃어버렸어요", "은색 소니 XM5 무선 헤드폰을 방목학술정보관 1층에서 잃어버렸어요.", "전자기기", I, "방목학술정보관(S9)", 18 * D, 3)),
  nm("M18", "found", "이어폰/헤드폰", "near", post("게이밍 헤드셋 주웠어요", "제4공학관 실습실에 마이크 달린 검은 게이밍 헤드셋이 있었어요.", "전자기기", N, "제4공학관(Y13)", 17 * D, 2)),
  nm("M19", "lost", "케이블/젠더", "near", post("C타입 HDMI 젠더 분실", "C타입을 HDMI로 바꿔주는 작은 회색 젠더를 행정동 회의실에서 잃어버렸어요.", "전자기기", I, "행정동(S5)", 15 * D, 3)),
  nm("M20", "found", "케이블", "near", post("랜선 주웠어요", "공동실험동 2층 복도에 파란색 LAN 케이블이 말려 있었어요.", "전자기기", N, "공동실험동(Y18)", 20 * D, 2)),
  nm("M21", "lost", "카드 케이스", "near", post("투명 학생증 케이스 분실", "학생증 넣는 투명 하드 케이스(카드 없음)를 미래관에서 잃어버렸어요.", "액세서리", I, "미래관(S3)", 9 * D, 2)),
  nm("M22", "found", "카드", "near", post("교직원증 주웠어요", "방목기념관 앞에서 교직원증 한 장을 주웠어요.", "카드", N, "방목기념관(Y16)", 10 * D, 2)),
  nm("M23", "found", "카드", "near", post("아이돌 포토카드 주웠어요", "학생회관 2층 계단에서 아이돌 포토카드 한 장을 주웠어요.", "기타", I, "학생회관(S2)", 6 * D, 2)),
  nm("M24", "lost", "지갑", "near", post("은색 명함지갑 분실", "은색 금속 명함지갑을 산학협력관 로비에서 잃어버렸어요.", "지갑", N, "산학협력관(Y17)", 27 * D, 2)),
  nm("M25", "lost", "케이블", "near", post("라이트닝 케이블 잃어버렸어요", "흰색 라이트닝 충전 케이블을 방목 열람실 콘센트에 꽂아두고 나왔어요.", "전자기기", I, "방목학술정보관(S9)", 7 * D, 2)),
  nm("M26", "found", "이어폰", "near", post("실리콘 이어팁 한 쌍 주웠어요", "명진당 2층 책상에서 회색 실리콘 이어팁 한 쌍을 주웠어요.", "전자기기", N, "명진당(Y3)", 8 * D, 2)),
  nm("M27", "lost", "전자기기", "near", post("JBL 블루투스 스피커 분실", "빨간색 JBL 블루투스 스피커를 야외음악당에서 잃어버렸어요.", "전자기기", N, "야외음악당", 28 * D, 3)),
  nm("M28", "lost", "USB", "near", post("USB 허브 잃어버렸어요", "은색 4포트 USB 허브를 제5공학관 실습실에서 잃어버렸어요.", "전자기기", N, "제5공학관(Y5)", 10 * D, 3)),
  nm("M29", "found", "USB/저장장치", "near", post("검은색 외장하드 주웠어요", "종합관 컴퓨터실에서 검은색 외장하드를 주웠어요.", "전자기기", I, "종합관(S1)", 16 * D, 2)),
  nm("M30", "found", "텀블러", "near", post("텀블러 뚜껑만 주웠어요", "자연도서관 1층에서 검은 플라스틱 텀블러 뚜껑만 주웠어요. 몸통은 없어요.", "기타", N, "자연도서관", 13 * D, 2)),
  nm("M31", "lost", "보온병/물병", "near", post("날진 물병 분실", "투명한 날진 물병을 대운동장 트랙 옆에서 잃어버렸어요.", "기타", N, "대운동장", 19 * D, 2)),
  nm("M32", "found", "안경", "near", post("안경닦이 천 주웠어요", "함박관 2층 강의실에서 회색 안경닦이 천을 주웠어요.", "기타", N, "함박관(Y9)", 5 * D, 2)),
  nm("M33", "lost", "카드", "near", post("우노 카드 잃어버렸어요", "보드게임 우노 카드 한 통을 학생회관 동아리방 근처에서 잃어버렸어요.", "기타", I, "학생회관(S2)", 21 * D, 3)),
  nm("M34", "found", "서류 파일", "near", post("악보 파일 습득", "창조예술관 1층 연습실 앞에서 악보가 든 검은 클리어 파일을 주웠어요.", "기타", N, "창조예술관(Y2)", 18 * D, 2)),
  nm("M35", "lost", "키링", "near", post("강아지 인형 키링 분실", "갈색 강아지 인형 키링(열쇠 없음)을 국제관 앞에서 잃어버렸어요.", "액세서리", I, "국제관(S4)", 22 * D, 2)),
  nm("M36", "found", "열쇠", "near", post("자전거 자물쇠 주웠어요", "정문 자전거 거치대 옆에 번호 자물쇠가 떨어져 있었어요.", "기타", N, "정문", 24 * D, 2)),
  nm("M37", "lost", "카드 목걸이", "near", post("빨간 목걸이 줄만 잃어버렸어요", "카드 없이 빨간 목걸이 줄만 MCC관에서 잃어버렸어요.", "액세서리", I, "MCC관(S10)", 16 * D, 2)),
  nm("M38", "lost", "노트/책", "near", post("초록 스프링 노트 분실", "초록 표지 스프링 노트를 함박관 강의실에서 잃어버렸어요. 필기가 많아요.", "책", N, "함박관(Y9)", 26 * D, 2)),
  nm("M39", "found", "필기구", "near", post("형광펜 세트 주웠어요", "미래관 스터디룸에서 다섯 색 형광펜 세트를 주웠어요.", "필기구", I, "미래관(S3)", 12 * D, 2)),
  nm("M40", "lost", "필기구", "near", post("만년필 잃어버렸어요", "남색 라미 만년필을 방목학술정보관 4층에서 잃어버렸어요.", "필기구", I, "방목학술정보관(S9)", 30 * D, 3)),
  nm("M41", "found", "카메라 소품", "near", post("카메라 스트랩 습득", "디자인조형센터 앞 벤치에 갈색 가죽 카메라 스트랩이 있었어요.", "기타", N, "디자인조형센터(Y12)", 11 * D, 2)),
  nm("M42", "lost", "도장", "far", post("인감도장 분실", "나무 케이스에 든 인감도장을 행정동 민원실 근처에서 잃어버렸어요.", "기타", I, "행정동(S5)", 17 * D, 2)),
  nm("M43", "found", "화장품", "far", post("립밤 주웠어요", "국제관 2층 강의실에서 립밤 하나를 주웠어요.", "기타", I, "국제관(S4)", 4 * D, 2)),
  nm("M44", "found", "미용기기", "far", post("고데기 주웠어요", "생활관 공용 화장실에 미니 고데기가 있었어요.", "기타", I, "생활관(S8)", 15 * D, 2)),
  nm("M45", "lost", "운동용품", "far", post("야구 글러브 잃어버렸어요", "갈색 야구 글러브를 대운동장 더그아웃에서 잃어버렸어요.", "기타", N, "대운동장", 29 * D, 3)),
  nm("M46", "found", "운동용품", "far", post("배드민턴 라켓 습득", "체육관 2층 코트 옆에 배드민턴 라켓 하나가 있었어요.", "기타", N, "체육관(Y7)", 18 * D, 2)),
  nm("M47", "lost", "생활용품", "far", post("콘택트렌즈 케이스 분실", "하늘색 렌즈 케이스를 생활관 세면실에서 잃어버렸어요.", "기타", N, "생활관(Y30~35)", 23 * D, 2)),
  nm("M48", "found", "담요", "far", post("무릎담요 주웠어요", "명진당 3층 열람실 의자에 체크무늬 없는 회색 무릎담요가 있었어요.", "기타", N, "명진당(Y3)", 20 * D, 2)),
  nm("M49", "found", "운동용품", "far", post("손목 보호대 습득", "체육문화관 헬스장 벤치에 검은 손목 보호대 한 쪽이 있었어요.", "기타", N, "체육문화관(Y6)", 9 * D, 2)),
  nm("M50", "lost", "생활용품", "far", post("휴대용 가습기 잃어버렸어요", "흰색 USB 휴대용 가습기를 미래관 열람실에서 잃어버렸어요.", "전자기기", I, "미래관(S3)", 25 * D, 3)),
];

// Unseen third views of the lost item, for image-search checks (local files
// under docs/ai-eval-seed/query-images/, never uploaded).
export const QUERY_IMAGES3: Record<string, ImageSpec> = Object.fromEntries(
  PAIRS3.filter((p) => p.lost.image && p.found.image).map((p) => [
    p.pairId,
    { ...p.lost.image!, background: "bench" as const, rotate: p.lost.image!.rotate + 35, scale: 0.8, skew: -4, dx: 15, dy: 5, light: 0.05 },
  ]),
);

export type Job3 = { key: string; board: Board; spec: PostSpec };

export function allJobs3(): Job3[] {
  return [
    ...PAIRS3.flatMap((p) => [
      { key: `${p.pairId}-lost`, board: "lost" as const, spec: p.lost },
      { key: `${p.pairId}-found`, board: "found" as const, spec: p.found },
    ]),
    ...NEGATIVES3.map((n) => ({ key: n.negId, board: n.board, spec: n.post })),
    ...NO_MATCH3.map((m) => ({ key: m.noMatchId, board: m.board, spec: m.post })),
  ];
}
