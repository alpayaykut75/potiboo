import { describe, expect, it } from "vitest";
import { tallyObjectionVotes } from "../rounds/objections";
import type { RoomPlayerWithProfile } from "../rooms/types";

function player(id: string): RoomPlayerWithProfile {
  return {
    id,
    room_id: "r",
    profile_id: id,
    join_order: 1,
    is_connected: true,
    total_score: 0,
    joined_at: "",
    profiles: { display_name: id, avatar_key: "panda" },
  };
}

describe("tallyObjectionVotes", () => {
  // raiser, owner, a, b
  const players = [
    player("raiser"),
    player("owner"),
    player("a"),
    player("b"),
  ];

  it("itiraz eden otomatik Yanlış; sessiz Doğru; owner oyda yok", () => {
    const result = tallyObjectionVotes({
      raisedBy: "raiser",
      answerOwnerId: "owner",
      players,
      votes: [
        // sadece a Yanlış dedi; b sessiz
        { id: "1", objection_id: "o", profile_id: "a", is_valid: false },
      ],
    });
    // raiser Yanlış + a Yanlış = 2; b Doğru = 1 → düşer
    expect(result.yanlis).toBe(2);
    expect(result.dogru).toBe(1);
    expect(result.answerStaysValid).toBe(false);
  });

  it("diğerleri Doğru derse kelime kalır", () => {
    const result = tallyObjectionVotes({
      raisedBy: "raiser",
      answerOwnerId: "owner",
      players,
      votes: [
        { id: "1", objection_id: "o", profile_id: "a", is_valid: true },
        { id: "2", objection_id: "o", profile_id: "b", is_valid: true },
      ],
    });
    // raiser 1 Yanlış; a+b 2 Doğru
    expect(result.yanlis).toBe(1);
    expect(result.dogru).toBe(2);
    expect(result.answerStaysValid).toBe(true);
  });
});
