import type { PostType } from "@/lib/posts/schema";
import type { TranslationKey } from "./translate";

// 다국어(i18n) Phase: 이 앱의 몇몇 값은 DB에 한국어 문자열 그대로
// 저장돼 있다 -- 카테고리("전자기기"), 캠퍼스("인문캠퍼스"), 상태
// ("찾는 중"/"보관 중"/...). 이 값들 자체는 절대 번역하지 않는다:
// zod 스키마(listQuerySchema, createLostPostSchema 등)가 검증하고
// Prisma가 저장하는 값이 바로 이 문자열이라, 번역된 문자열을 대신
// 보내면 그 순간 검색/필터/저장이 전부 깨진다.
//
// 대신 "저장 값 -> 번역 키"만 여기서 한 번에 매핑한다. <select>의
// value는 항상 원문, 눈에 보이는 label만 t()를 거친다 -- 화면 어디서도
// 같은 매핑을 다시 손으로 적지 않도록 이 모듈 하나만 쓴다.
//
// 목록에 없는 값(예전에 자유 입력으로 들어간 카테고리 등 -- CATEGORIES는
// DB 제약이 아니라 UI 차원의 목록일 뿐이다, posts/schema.ts 참고)은
// 번역 키를 만들지 않고 원문을 그대로 보여준다. 그래서 반환 타입이
// `TranslationKey | null`이 아니라, 호출부가 편하도록 아래 label 헬퍼를
// 함께 제공한다.

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  전자기기: "category.전자기기",
  필기구: "category.필기구",
  책: "category.책",
  지갑: "category.지갑",
  카드: "category.카드",
  의류: "category.의류",
  가방: "category.가방",
  액세서리: "category.액세서리",
  기타: "category.기타",
};

const CAMPUS_KEYS: Record<string, TranslationKey> = {
  인문캠퍼스: "campus.인문캠퍼스",
  자연캠퍼스: "campus.자연캠퍼스",
};

const STATUS_KEYS: Record<string, TranslationKey> = {
  "찾는 중": "status.찾는 중",
  찾음: "status.찾음",
  "보관 중": "status.보관 중",
  완료: "status.완료",
};

const POST_TYPE_KEYS: Record<PostType, TranslationKey> = {
  lost: "post.type.lost",
  found: "post.type.found",
};

export function categoryLabelKey(category: string): TranslationKey | null {
  return CATEGORY_KEYS[category] ?? null;
}

export function campusLabelKey(campus: string): TranslationKey | null {
  return CAMPUS_KEYS[campus] ?? null;
}

// 상태는 항상 이 4개 중 하나다(LostPostStatus/FoundPostStatus enum) --
// 그래도 StatusBadge가 방어적으로 임의 문자열을 받는 기존 계약을 유지할
// 수 있도록 못 찾으면 null을 돌려준다.
export function statusLabelKey(status: string): TranslationKey {
  return STATUS_KEYS[status] ?? ("status.찾는 중" as TranslationKey);
}

export function statusLabelKeyOrNull(status: string): TranslationKey | null {
  return STATUS_KEYS[status] ?? null;
}

export function postTypeLabelKey(type: PostType): TranslationKey {
  return POST_TYPE_KEYS[type];
}
