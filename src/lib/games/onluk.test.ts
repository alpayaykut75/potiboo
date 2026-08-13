import { describe, expect, it } from "vitest";
import {
  applyRule,
  applyRules,
  expectedToken,
  initialSequence,
  normalizeOnlukToken,
  tokensForChips,
  validateToken,
} from "./onluk";

describe("onluk rules", () => {
  it("swap places two slots", () => {
    const seq = applyRule(initialSequence(), { type: "swap", i: 1, j: 4 });
    expect(seq[1]).toBe("5");
    expect(seq[4]).toBe("2");
  });

  it("rename accepts word or number", () => {
    let seq = applyRule(initialSequence(), {
      type: "rename",
      index: 5,
      token: "Armut",
    });
    expect(seq[5]).toBe("armut");
    seq = applyRule(seq, { type: "rename", index: 1, token: "9" });
    expect(seq[1]).toBe("9");
  });

  it("skip shortens sequence", () => {
    const seq = applyRule(initialSequence(), { type: "skip", index: 4 });
    expect(seq).toHaveLength(9);
    expect(seq).not.toContain("5");
  });

  it("skip refuses below min length", () => {
    let seq = ["1", "2"];
    expect(() => applyRule(seq, { type: "skip", index: 0 })).toThrow();
  });

  it("reverse flips the list", () => {
    const seq = applyRule(["1", "2", "3"], { type: "reverse" });
    expect(seq).toEqual(["3", "2", "1"]);
  });

  it("stacks rules like kids play", () => {
    const seq = applyRules(initialSequence(), [
      { type: "swap", i: 1, j: 4 },
      { type: "rename", index: 5, token: "armut" },
      { type: "skip", index: 0 },
    ]);
    expect(seq[0]).toBe("5");
    expect(seq).toContain("armut");
    expect(seq).not.toContain("1");
  });

  it("expected token follows cursor", () => {
    const seq = applyRule(initialSequence(), { type: "swap", i: 0, j: 1 });
    expect(expectedToken(seq, 0)).toBe("2");
    expect(expectedToken(seq, 1)).toBe("1");
  });

  it("normalizes TR case for compare", () => {
    expect(normalizeOnlukToken(" Armut ")).toBe("armut");
    expect(validateToken("")).toBeNull();
    expect(validateToken("a".repeat(13))).toBeNull();
  });

  it("chip list is unique", () => {
    expect(tokensForChips(["1", "9", "1", "armut"])).toEqual([
      "1",
      "9",
      "armut",
    ]);
  });
});
