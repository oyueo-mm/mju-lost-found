import { describe, expect, it } from "vitest";
import { custodyInputSchema, readCustody } from "./custodySchema";
describe("보관 정보", () => {
  it("supports older posts without inventing custody", () => { expect(readCustody(null)).toBeNull(); expect(readCustody(undefined)).toBeNull(); });
  it("does not accept owner-forged verification", () => {
    expect(custodyInputSchema.safeParse({ state: "REPORTED", place: "경비실", confirmedAt: new Date().toISOString() }).success).toBe(false);
  });
  // An undecided (PLANNED) or unknown (REPORTED) place is stored empty, never guessed.
  it("allows an empty handover place and suppresses private self-storage locations", () => {
    expect(custodyInputSchema.parse({ state: "PLANNED", place: "" })).toEqual({ state: "PLANNED", place: "" });
    expect(custodyInputSchema.parse({ state: "SELF", place: "집 주소" })).toEqual({ state: "SELF", place: "" });
    expect(readCustody({ state: "REPORTED", place: "경비실" })?.confirmedAt).toBeNull();
  });
});
