import { describe, expect, it } from "vitest";
import {
  applyAnte,
  applyPlay,
  assignTableSlots,
  buildDeck,
  canStake,
  isInRange,
  leaders,
  maxStake,
  rangeOf,
  resolveIntervalHands,
  stakeOptions,
  visibleBank,
  type IntervalTile,
} from "./interval";

const cyan = (value: number): IntervalTile => ({ value, color: "cyan" });
const red = (value: number): IntervalTile => ({ value, color: "red" });

describe("interval domain", () => {
  it("builds a 50-tile deck (1–10 × 5 colors)", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(50);
    expect(deck.filter((t) => t.value === 7)).toHaveLength(5);
  });

  it("range uses numbers only; endpoints win", () => {
    expect(rangeOf(cyan(3), red(8))).toEqual({ lo: 3, hi: 8 });
    expect(canStake(3, 8)).toBe(true);
    expect(isInRange(cyan(5), 3, 8)).toBe(true);
    expect(isInRange(cyan(3), 3, 8)).toBe(true);
    expect(isInRange(cyan(8), 3, 8)).toBe(true);
  });

  it("adjacent values are stakeable; identical values are not", () => {
    expect(canStake(4, 5)).toBe(true);
    expect(isInRange(cyan(4), 4, 5)).toBe(true);
    expect(isInRange(cyan(5), 4, 5)).toBe(true);
    expect(canStake(7, 7)).toBe(false);
  });

  it("ante takes 10 from each bank into the pot", () => {
    const seats = ["a", "b"];
    const { banks, pot } = applyAnte({ a: 100, b: 100 }, seats, 0);
    expect(pot).toBe(20);
    expect(banks).toEqual({ a: 90, b: 90 });
  });

  it("ante caps at remaining bank", () => {
    const { banks, pot } = applyAnte({ a: 3, b: 100 }, ["a", "b"], 0);
    expect(pot).toBe(13);
    expect(banks.a).toBe(0);
    expect(banks.b).toBe(90);
  });

  it("hit pays 2× stake from pot", () => {
    const result = applyPlay({
      banks: { a: 90, b: 90 },
      pot: 20,
      playerId: "a",
      stake: 5,
      lo: 2,
      hi: 9,
      drawn: cyan(5),
    });
    expect(result.event.kind).toBe("hit");
    expect(result.pot).toBe(20 + 5 - 10);
    expect(result.banks.a).toBe(90 - 5 + 10);
  });

  it("miss leaves stake in pot", () => {
    const result = applyPlay({
      banks: { a: 90, b: 90 },
      pot: 20,
      playerId: "a",
      stake: 5,
      lo: 2,
      hi: 9,
      drawn: cyan(1),
    });
    expect(result.event.kind).toBe("miss");
    expect(result.pot).toBe(25);
    expect(result.banks.a).toBe(85);
  });

  it("hit on endpoints (inclusive range)", () => {
    const result = applyPlay({
      banks: { a: 90, b: 90 },
      pot: 20,
      playerId: "a",
      stake: 5,
      lo: 4,
      hi: 5,
      drawn: cyan(4),
    });
    expect(result.event.kind).toBe("hit");
    expect(result.banks.a).toBe(95);
  });

  it("seats 2–4 sit symmetrically on heads and sides", () => {
    expect(assignTableSlots(["a", "b"])).toEqual([
      "a", null, null, null, "b", null, null, null,
    ]);
    expect(assignTableSlots(["a", "b", "c"])).toEqual([
      "a", null, "b", null, null, null, "c", null,
    ]);
    expect(assignTableSlots(["a", "b", "c", "d"])).toEqual([
      "a", null, "b", null, "c", null, "d", null,
    ]);
  });

  it("visibleBank hides hit/miss until result", () => {
    const banks = { a: 95 };
    const hit = {
      kind: "hit" as const,
      by: "a",
      stake: 5,
      drawn: cyan(4),
      lo: 4,
      hi: 5,
      payout: 10,
      pot_before: 20,
      pot_after: 15,
    };
    expect(visibleBank(banks, "a", hit, "put")).toBe(90);
    expect(visibleBank(banks, "a", hit, "spin")).toBe(85);
    expect(visibleBank(banks, "a", hit, "show")).toBe(85);
    expect(visibleBank(banks, "a", hit, "result")).toBe(95);
  });

  it("rejects stake above pot or bank", () => {
    expect(maxStake(10, 3)).toBe(3);
    expect(() =>
      applyPlay({
        banks: { a: 2 },
        pot: 20,
        playerId: "a",
        stake: 5,
        lo: 1,
        hi: 10,
        drawn: cyan(5),
      }),
    ).toThrow();
  });

  it("stake options stay within max", () => {
    expect(stakeOptions(20, 90)).toEqual([1, 5, 10, 20]);
    expect(stakeOptions(3, 100)).toEqual([1, 3]);
  });

  it("leaders picks highest bank; ties keep all", () => {
    expect(leaders({ a: 80, b: 120, c: 40 }, ["a", "b", "c"])).toEqual(["b"]);
    expect(leaders({ a: 50, b: 50 }, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("resolves hand count settings", () => {
    expect(resolveIntervalHands(3)).toBe(3);
    expect(resolveIntervalHands(7)).toBe(5);
  });
});
