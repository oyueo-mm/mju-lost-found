// 명지대 캠퍼스별 데이터. 인문(서울)·자연(용인) 은 절대 섞이지 않는다.
//
// 장소는 학교 공식 건물 목록으로 제한한다(자유 입력 X). 세부 위치는 별도 자유 입력.
// code = 학교 건물번호 (인문 S, 자연 Y — 강의실 코드 S1234 의 앞자리). 번호 없는 시설은 이름만.
// 게시글에는 name 이 저장된다 (코드가 바뀌어도 데이터는 그대로).

export const CAMPUSES = {
  humanities: {
    key: "humanities",
    label: "인문캠퍼스",
    city: "서울",
    locations: [
      { code: "S1", name: "종합관" },
      { code: "S2", name: "학생회관" },
      { name: "미래관" },
      { code: "S4", name: "국제관" },
      { code: "S5", name: "행정동" },
      { code: "S9", name: "방목학술정보관(도서관)" },
      { code: "S10", name: "MCC관 · 베리타스홀" },
      { code: "S10", name: "코이노니아홀" },
      { name: "크로바관" },
      { name: "생활관(기숙사)" },
      { name: "대학교회(채플)" },
      { name: "대운동장" },
      { name: "농구장" },
      { name: "정문" },
      { name: "후문" },
      { name: "셔틀버스 정류장" },
      { name: "통학버스" },
      { name: "교내 상가" },
      { name: "기타" },
    ],
  },
  natural: {
    key: "natural",
    label: "자연캠퍼스",
    city: "용인",
    // 공식 건물 목록(미래교육원 배치도) 기준. Y번호는 확인된 것만 — 나머지는 캠퍼스 지도 보고 채울 것.
    locations: [
      // 교육·행정
      { name: "행정동(본관)" },
      { code: "Y1", name: "학생회관" },
      { code: "Y21", name: "학생복지관(복지동)" },
      { code: "Y2", name: "창조예술관" },
      { code: "Y23", name: "차세대과학관" },
      { name: "제1공학관" },
      { code: "Y8", name: "제2공학관(에코바이오관)" },
      { code: "Y19", name: "제3공학관" },
      { code: "Y13", name: "제4공학관" },
      { code: "Y5", name: "제5공학관" },
      { code: "Y12", name: "디자인조형센터" },
      { code: "Y9", name: "함박관" },
      { name: "방목학술정보관(도서관)" },
      { code: "Y16", name: "방목기념관" },
      { code: "Y3", name: "명진당" },
      { name: "국제문화관" },
      { name: "백마관" },
      { name: "예체능관" },
      { name: "건축도시설계원" },
      { code: "Y22", name: "60주년 채플관" },
      { code: "Y17", name: "산학협력관" },
      { code: "Y18", name: "공동실험동" },
      { code: "Y24", name: "하이브리드 구조실험센터" },
      { name: "구조재료실험동" },
      { name: "모형실험동" },
      { name: "수리모형실습동" },
      { code: "Y11", name: "학군단" },
      // 체육
      { code: "Y7", name: "체육관" },
      { code: "Y6", name: "체육문화관" },
      { name: "대운동장" },
      { name: "소운동장" },
      { name: "테니스장" },
      { name: "실내테니스장" },
      { name: "야외음악당" },
      // 생활관
      { name: "명현관(기숙사)" },
      { name: "명덕관(기숙사)" },
      { name: "MCC(제3생활관)" },
      { name: "제3학생기숙사 1동" },
      { name: "제3학생기숙사 4동" },
      { name: "제3학생기숙사 5동" },
      { name: "제3학생기숙사 B동" },
      { name: "명지마을" },
      { name: "방문자숙소" },
      // 출입·이동·기타
      { name: "정문" },
      { name: "후문" },
      { name: "통학버스 승강장" },
      { name: "셔틀버스 정류장" },
      { name: "백마상" },
      { name: "교내 상가" },
      { name: "기타" },
    ],
  },
};

export const CAMPUS_KEYS = Object.keys(CAMPUSES);

export function isCampus(v) {
  return CAMPUS_KEYS.includes(v);
}

export function campusLabel(v) {
  return CAMPUSES[v]?.label || "";
}

// [{ code?, name }] — 폼 select 용
export function campusLocations(v) {
  return CAMPUSES[v]?.locations || [];
}

// 저장·검증용 이름 목록
export function campusLocationNames(v) {
  return campusLocations(v).map((l) => l.name);
}

// "S1 종합관" / "미래관" — 표시용
export function locationLabel(loc) {
  if (!loc) return "";
  return loc.code ? `${loc.code} ${loc.name}` : loc.name;
}

// 저장된 이름으로 코드 붙여서 표시 ("종합관" → "S1 종합관"). 캠퍼스 모르면 이름 그대로.
export function locationDisplay(campus, name) {
  if (!name) return "";
  const found = campusLocations(campus).find((l) => l.name === name);
  return found ? locationLabel(found) : name;
}
