import { describe, expect, it } from "vitest";
import {
  formatXoxScore,
  resolveXoxSeriesLength,
  xoxSeriesTarget,
  XOX_INFINITE_MOVE_LIMIT,
} from "@/lib/games/xox";

describe("toxxo series helpers", () => {
  it("resolves series length and targets", () => {
    expect(resolveXoxSeriesLength(3)).toBe(3);
    expect(resolveXoxSeriesLength(99)).toBe(3);
    expect(xoxSeriesTarget(1)).toBe(1);
    expect(xoxSeriesTarget(3)).toBe(2);
    expect(xoxSeriesTarget(5)).toBe(3);
  });

  it("formats half points", () => {
    expect(formatXoxScore(1)).toBe("1");
    expect(formatXoxScore(0.5)).toBe("0,5");
    expect(formatXoxScore(1.5)).toBe("1,5");
  });

  it("keeps infinite move limit configurable", () => {
    expect(XOX_INFINITE_MOVE_LIMIT).toBe(60);
  });
});
