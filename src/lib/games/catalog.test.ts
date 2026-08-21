import { describe, expect, it } from "vitest";
import {
  getGameBySlug,
  legacySlugRedirects,
  gameTitle,
} from "@/lib/games/catalog";
import { parseRulesSections } from "@/lib/games/rules";

describe("catalog renames", () => {
  it("resolves new and legacy slugs", () => {
    expect(getGameBySlug("listo")?.title).toBe("Listo");
    expect(getGameBySlug("stoppa")?.slug).toBe("listo");
    expect(getGameBySlug("toxxo")?.title).toBe("Toxxo");
    expect(getGameBySlug("xox")?.slug).toBe("toxxo");
    expect(getGameBySlug("bumpo")?.title).toBe("Bumpo");
    expect(getGameBySlug("kizma-birader")?.slug).toBe("bumpo");
  });

  it("keeps db ids in gameTitle", () => {
    expect(gameTitle("isim_sehir")).toBe("Listo");
    expect(gameTitle("kizma_birader")).toBe("Bumpo");
  });

  it("lists legacy redirects", () => {
    const map = Object.fromEntries(
      legacySlugRedirects().map((r) => [r.from, r.to]),
    );
    expect(map.stoppa).toBe("listo");
    expect(map.xox).toBe("toxxo");
    expect(map.muto).toBe("mutto");
  });
});

describe("parseRulesSections", () => {
  it("splits ### headings", () => {
    const sections = parseRulesSections(
      "### Amaç\n\nBir cümle.\n\n### Kurulum\n\n- Madde\n",
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]?.title).toBe("Amaç");
    expect(sections[1]?.title).toBe("Kurulum");
  });
});
