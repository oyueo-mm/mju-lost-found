import { describe, expect, it } from "vitest";

import {
  ILLEGAL_SEXUAL_CONTENT_REASON,
  REPORT_REASONS,
  createReportSchema,
  isRightsInfringementReason,
  isUrgentReportReason,
} from "./schema";

describe("report reasons (Legal pre-beta Phase)", () => {
  it("offers 개인정보 노출, 사생활 침해, 명예훼손 and illegal sexual content", () => {
    for (const r of ["개인정보 노출", "사생활 침해", "명예훼손", ILLEGAL_SEXUAL_CONTENT_REASON]) expect(REPORT_REASONS).toContain(r);
  });

  it("accepts only the listed reasons (the urgent flag keys off the exact value)", () => {
    expect(createReportSchema.safeParse({ targetType: "post", targetId: 1, reason: "명예훼손" }).success).toBe(true);
    expect(createReportSchema.safeParse({ targetType: "post", targetId: 1, reason: "아무 문자열" }).success).toBe(false);
  });

  it("only illegal sexual content is urgent", () => {
    expect(isUrgentReportReason(ILLEGAL_SEXUAL_CONTENT_REASON)).toBe(true);
    expect(isUrgentReportReason("명예훼손")).toBe(false);
  });

  it("rights-infringement reasons are the ones a temporary hide may be used for", () => {
    for (const r of ["개인정보 노출", "사생활 침해", "명예훼손", ILLEGAL_SEXUAL_CONTENT_REASON]) expect(isRightsInfringementReason(r)).toBe(true);
    for (const r of ["도배/스팸", "기타", "사기/허위 정보"]) expect(isRightsInfringementReason(r)).toBe(false);
  });
});
