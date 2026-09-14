import { CAMPUSES } from "./schema";
import type { Locale } from "@/lib/i18n/config";

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

// The value is always the official Korean place name used by the form/API.
// The label is a presentation-only string, so callers can localize known
// campus suffixes without ever changing the submitted canonical value.
export type LocationSuggestion = { value: string; label: string };

const LOCATION_WORDS: Partial<Record<Locale, Record<string, string>>> = {
  en: { 정문: "Main gate", 후문·기타: "Back gate / other entrance", 운동장: "Sports field", 학생회관: "Student union", 도서관: "Library", 체육관: "Gymnasium", 생활관: "Dormitory" },
  zh: { 정문: "正门", 후문·기타: "后门/其他入口", 운동장: "运动场", 학생회관: "学生会馆", 도서관: "图书馆", 체육관: "体育馆", 생활관: "宿舍" },
  vi: { 정문: "Cổng chính", 후문·기타: "Cổng sau / lối vào khác", 운동장: "Sân thể thao", 학생회관: "Nhà sinh viên", 도서관: "Thư viện", 체육관: "Nhà thi đấu", 생활관: "Ký túc xá" },
  mn: { 정문: "Гол хаалга", 후문·기타: "Арын хаалга / бусад орц", 운동장: "Спортын талбай", 학생회관: "Оюутны байр", 도서관: "Номын сан", 체육관: "Спорт заал", 생활관: "Дотуур байр" },
  ja: { 정문: "正門", 후문·기타: "裏門・その他の入口", 운동장: "運動場", 학생회관: "学生会館", 도서관: "図書館", 체육관: "体育館", 생활관: "学生寮" },
  fr: { 정문: "Entrée principale", 후문·기타: "Entrée arrière / autre entrée", 운동장: "Terrain de sport", 학생회관: "Maison des étudiants", 도서관: "Bibliothèque", 체육관: "Gymnase", 생활관: "Résidence universitaire" },
};

function translateLocationPart(part: string, locale: Locale): string {
  return LOCATION_WORDS[locale]?.[part] ?? part;
}

export function getLocalizedLocationSuggestions(campus: string, locale: Locale): readonly LocationSuggestion[] {
  return getLocationSuggestions(campus).map((value) => ({
    value,
    label: value.split(/(정문|후문·기타|운동장|학생회관|도서관|체육관|생활관)/u).map((part) => translateLocationPart(part, locale)).join(""),
  }));
}
