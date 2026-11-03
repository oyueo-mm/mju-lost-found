import { describe, expect, it } from "vitest";
import { custodyInputSchema, readCustody } from "./custodySchema";
describe("보관 정보", () => {
  it("supports older posts without inventing custody", () => { expect(readCustody(null)).toBeNull(); expect(readCustody(undefined)).toBeNull(); });
  it("does not accept owner-forged verification", () => {
    expect(custodyInputSchema.safeParse({ state: "REPORTED", place: "경비실", confirmedAt: new Date().toISOString() }).success).toBe(false);
  });
  it("requires a handover location and suppresses private self-storage locations", () => {
    expect(custodyInputSchema.safeParse({ state: "PLANNED", place: "" }).success).toBe(false);
    expect(custodyInputSchema.parse({ state: "SELF", place: "집 주소" })).toEqual({ state: "SELF", place: "" });
    expect(readCustody({ state: "REPORTED", place: "경비실" })?.confirmedAt).toBeNull();
  });
});
