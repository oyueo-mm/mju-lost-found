import { z } from "zod";

import { CAMPUSES, CATEGORIES } from "@/lib/posts/schema";
import { EXCLUDE_KEYWORD_MAX_LENGTH, KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH, MAX_EXCLUDE_KEYWORDS_PER_ALERT } from "./config";

// 키워드 알림 Phase: "글 종류" 조건의 3가지 값 -- LostPost/FoundPost.status가
// 아니라 어느 게시판(글 종류) 글인지를 가리킨다. posts/schema.ts의
// POST_TYPES(lost/found)에 "all"(전체)이 하나 더 있는 형태.
export const KEYWORD_ALERT_POST_TYPES = ["all", "lost", "found"] as const;
export type KeywordAlertPostTypeValue = (typeof KEYWORD_ALERT_POST_TYPES)[number];

// campuses/categories는 "빈 배열 = 전체(필터 없음)"이라는 이 모델 자신의
// schema.prisma 주석과 동일한 규칙 -- 값이 있으면 그 목록 안의 canonical
// 값만 허용한다(campus는 CAMPUSES처럼 이미 순수 zod enum, category는
// LostPost.category와 달리 이 필드가 완전히 새 필드라 과거 자유 텍스트
//데이터와의 호환을 신경 쓸 필요가 없으므로 CATEGORIES도 그대로 enum으로
// 강제한다 -- posts/schema.ts 자신의 CAMPUSES 필드가 이미 같은 이유로
// CATEGORIES와 달리 엄격한 이유이기도 하다).
const campusList = z.array(z.enum(CAMPUSES)).max(CAMPUSES.length);
const categoryList = z.array(z.enum(CATEGORIES)).max(CATEGORIES.length);

// 대표 키워드/제외 키워드 모두 같은 길이 규칙(공백 트림 후 2~50자) --
// matcher.ts가 둘 다 동일한 "제목+본문에 포함되는지" 대소문자 무시
// substring 비교로 다루므로, 검증 규칙도 동일하게 둔다.
const keywordField = (max: number) => z.string().trim().min(KEYWORD_MIN_LENGTH).max(max);

export const createKeywordAlertSchema = z.object({
  keyword: keywordField(KEYWORD_MAX_LENGTH),
  postType: z.enum(KEYWORD_ALERT_POST_TYPES).default("all"),
  campuses: campusList.default([]),
  categories: categoryList.default([]),
  excludeKeywords: z.array(keywordField(EXCLUDE_KEYWORD_MAX_LENGTH)).max(MAX_EXCLUDE_KEYWORDS_PER_ALERT).default([]),
});
export type CreateKeywordAlertInput = z.infer<typeof createKeywordAlertSchema>;

// 수정은 생성과 완전히 같은 필드 집합/규칙 -- 부분 업데이트가 아니라 폼이
// 매번 전체 상태를 다시 제출하는 이 앱의 다른 설정 폼들(NicknameSettings
// 제외, 그건 필드가 하나뿐)과 다른 관례지만, 이 폼 자체가 필드 5개짜리
// 하나의 "규칙"이라 부분 patch를 지원할 이유가 없다 -- 항상 전체를 다시
// 검증/저장한다.
export const updateKeywordAlertSchema = createKeywordAlertSchema;
export type UpdateKeywordAlertInput = CreateKeywordAlertInput;
