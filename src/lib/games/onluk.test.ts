import { describe, expect, it } from "vitest";
import {
  applyRule,
  applyRules,
  expectedToken,
  initialSequence,
  normalizeOnlukToken,
  wordChipsFromSequence,
  validateToken,
} from "./onluk";

describe("onluk rules", () => {
  it("swap by value: 5 and 6 trade places in the count order", () => {
    const seq = applyRule(initialSequence(), { type: "swap", a: "5", b: "6" });
    expect(seq).toEqual(["1", "2", "3", "4", "6", "5", "7", "8", "9", "10"]);
    expect(expectedToken(seq, 4)).toBe("6");
    expect(expectedToken(seq, 5)).toBe("5");
  });

  it("swap by value works after reverse", () => {
    let seq = applyRule(initialSequence(), { type: "reverse" });
    seq = applyRule(seq, { type: "swap", a: "5", b: "6" });
    // ...10,9,8,7,6,5,4,3,2,1 → 6 and 5 swap → ...10,9,8,7,5,6,4,3,2,1
    expect(seq[4]).toBe("5");
    expect(seq[5]).toBe("6");
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
    const seq = ["1", "2"];
    expect(() => applyRule(seq, { type: "skip", index: 0 })).toThrow();
  });

  it("reverse flips the list", () => {
    const seq = applyRule(["1", "2", "3"], { type: "reverse" });
    expect(seq).toEqual(["3", "2", "1"]);
  });

  it("stacks rules like kids play", () => {
    const seq = applyRules(initialSequence(), [
      { type: "swap", a: "2", b: "5" },
      { type: "rename", index: 5, token: "armut" },
      { type: "skip", index: 0 },
    ]);
    expect(seq[0]).toBe("5");
    expect(seq).toContain("armut");
    expect(seq).not.toContain("1");
  });

  it("normalizes TR case for compare", () => {
    expect(normalizeOnlukToken(" Armut ")).toBe("armut");
    expect(validateToken("")).toBeNull();
    expect(validateToken("a".repeat(13))).toBeNull();
  });

  it("word chips exclude numbers", () => {
    expect(wordChipsFromSequence(["1", "9", "armut", "elma", "9"])).toEqual([
      "armut",
      "elma",
    ]);
  });
});
