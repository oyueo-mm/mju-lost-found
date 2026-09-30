-- 카테고리 대분류-소분류 전환 2단계: PostCategoryReview에 "어떻게 확정됐는지"를
-- 기록한다. status(accepted/overridden)는 추천값과 최종값이 같은지만 말해주므로,
-- 사람이 제목·설명을 보고 판단한 수동 확정과 추천기 결과를 그대로 받아들인
-- 자동 확정을 따로 남긴다.
--   'auto'   -- 추천기 결과를 그대로 확정 (제목 기반, 추가 판단 불필요)
--   'manual' -- 사람이 판단해 확정 (기존 기타, 정책상 대분류 변경, 모호한 제목,
--               설명 기반 추천, 추천과 다른 값으로 결정한 경우)
-- NULL은 아직 확정되지 않은(pending) 행이다. 기존 행은 건드리지 않는다.
--
-- Hand-written, same convention as every migration since Phase 23.

-- AlterTable
ALTER TABLE "PostCategoryReview" ADD COLUMN "resolution_method" TEXT;

ALTER TABLE "PostCategoryReview" ADD CONSTRAINT "postcategoryreview_resolution_method_check" CHECK (
    "resolution_method" IS NULL OR "resolution_method" IN ('auto', 'manual')
);
