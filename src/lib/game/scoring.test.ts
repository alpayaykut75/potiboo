import { describe, expect, it } from "vitest";
import { startsWithPoolLetter } from "./letters";
import { scoreRound } from "./scoring";

describe("startsWithPoolLetter", () => {
  it("O harfinde Ördek ve Orman geçerli", () => {
    expect(startsWithPoolLetter("Ördek", "O")).toBe(true);
    expect(startsWithPoolLetter("Orman", "O")).toBe(true);
    expect(startsWithPoolLetter("Araba", "O")).toBe(false);
  });

  it("I harfinde İsim ve Isparta geçerli", () => {
    expect(startsWithPoolLetter("İsim", "I")).toBe(true);
    expect(startsWithPoolLetter("Isparta", "I")).toBe(true);
  });
});

describe("scoreRound", () => {
  const categories = ["Hayvan"];
  const letter = "K";

  it("itiraz sonrası 10 → 20 yükselir", () => {
    const playerIds = ["ali", "ayse", "mehmet"];
    const base = {
      letter,
      categories,
      finishes: [] as { profileId: string; finishedAt: string | null }[],
      speedBonusEnabled: false,
      playerIds,
    };

    const before = scoreRound({
      ...base,
      answers: [
        { profileId: "ali", category: "Hayvan", value: "Kedi" },
        { profileId: "ayse", category: "Hayvan", value: "Kedi" },
        { profileId: "mehmet", category: "Hayvan", value: "Kanguru" },
      ],
    });

    expect(
      before.answers.find((a) => a.profileId === "ali")?.score,
    ).toBe(10);
    expect(
      before.answers.find((a) => a.profileId === "ayse")?.score,
    ).toBe(10);
    expect(
      before.answers.find((a) => a.profileId === "mehmet")?.score,
    ).toBe(20);

    const after = scoreRound({
      ...base,
      answers: [
        { profileId: "ali", category: "Hayvan", value: "Kedi" },
        {
          profileId: "ayse",
          category: "Hayvan",
          value: "Kedi",
          isInvalidated: true,
        },
        { profileId: "mehmet", category: "Hayvan", value: "Kanguru" },
      ],
    });

    expect(after.answers.find((a) => a.profileId === "ayse")?.score).toBe(0);
    expect(after.answers.find((a) => a.profileId === "ali")?.score).toBe(20);
    expect(after.answers.find((a) => a.profileId === "mehmet")?.score).toBe(
      20,
    );
  });

  it("hız bonusunu yalnızca tüm kategorileri dolduranlara verir", () => {
    const cats = ["İsim", "Şehir"];
    const playerIds = ["a", "b"];
    const t1 = "2026-01-01T00:00:01.000Z";
    const t2 = "2026-01-01T00:00:02.000Z";

    const result = scoreRound({
      letter: "A",
      categories: cats,
      playerIds,
      speedBonusEnabled: true,
      finishes: [
        { profileId: "a", finishedAt: t1 },
        { profileId: "b", finishedAt: t2 },
      ],
      answers: [
        { profileId: "a", category: "İsim", value: "Ali" },
        { profileId: "a", category: "Şehir", value: "Ankara" },
        { profileId: "b", category: "İsim", value: "Ayşe" },
        { profileId: "b", category: "Şehir", value: "" },
      ],
    });

    expect(result.players.find((p) => p.profileId === "a")?.speedBonus).toBe(
      10,
    );
    expect(result.players.find((p) => p.profileId === "b")?.speedBonus).toBe(
      0,
    );
  });

  it("Ördek ile Ordek farklı cevaplardır", () => {
    const playerIds = ["a", "b"];
    const result = scoreRound({
      letter: "O",
      categories: ["Hayvan"],
      playerIds,
      speedBonusEnabled: false,
      finishes: [],
      answers: [
        { profileId: "a", category: "Hayvan", value: "Ördek" },
        { profileId: "b", category: "Hayvan", value: "Ordek" },
      ],
    });
    expect(result.answers.every((a) => a.score === 20)).toBe(true);
  });
});
