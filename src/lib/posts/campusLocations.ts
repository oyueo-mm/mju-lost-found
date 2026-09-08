import { CAMPUSES } from "./schema";

// Phase P-2: replaces the old H-3/H-6/Phase-I placeholder lists (a handful
// of generically-guessed buildings, especially thin on 자연캠퍼스, which had
// zero real posts to check against at the time -- see PostForm.tsx's own
// former comment on that asymmetry). This is the full, campus-provided list
// of real named locations for each campus, kept verbatim (names/labels not
// reworded or reordered by campus convention) -- suggestions only, never a
// closed enum: the 위치 field stays plain free text (see PostForm.tsx), so
// nothing here restricts what a user can actually type.
export const CAMPUS_LOCATIONS: Record<(typeof CAMPUSES)[number], readonly string[]> = {
  인문캠퍼스: [
    "정문",
    "종합관(S1)",
    "MCC관(S10)",
    "베리타스홀",
    "코이노니아홀",
    "운동장",
    "방목학술정보관(S9)",
    "후문·기타 출입구",
    "학생회관(S2)",
    "강경대민주광장",
    "행정동(S5)",
    "국제관(S4)",
    "생활관(S8)",
    "양호거사비 주변 숲",
    "미래관(S3)",
    "명지대학교 교회",
  ],
  자연캠퍼스: [
    "정문",
    "창조예술관(Y2)",
    "명진당(Y3)",
    "자연도서관",
    "60주년 채플관(Y22)",
    "차세대과학관(Y23)",
    "제1공학관(Y_)",
    "제2공학관(Y8)",
    "제3공학관(Y19)",
    "제4공학관(Y13)",
    "제5공학관(Y5)",
    "체육관(Y7)",
    "체육문화관(Y6)",
    "디자인조형센터(Y12)",
    "함박관(Y9)",
    "학생회관(Y1)",
    "학생복지관(Y21)",
    "산학협력관(Y17)",
    "방목기념관(Y16)",
    "명원",
    "백마상",
    "대운동장",
    "야외음악당",
    "야외/실내테니스장",
    "실험한옥",
    "하이브리드 구조실험센터(Y24)",
    "공동실험동(Y18)",
    "학군단(Y11)",
    "생활관(Y30~35)",
  ],
};

// Returns [] for a value that isn't one of the two known campuses (e.g. a
// not-yet-selected/invalid state during render) instead of throwing --
// callers can always safely map over the result.
export function getLocationSuggestions(campus: string): readonly string[] {
  return CAMPUS_LOCATIONS[campus as (typeof CAMPUSES)[number]] ?? [];
}
