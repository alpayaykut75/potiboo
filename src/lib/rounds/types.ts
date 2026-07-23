export type RoundPhase =
  | "waiting"
  | "spinning"
  | "countdown"
  | "writing"
  | "scoring"
  | "done";

export type Round = {
  id: string;
  room_id: string;
  round_number: number;
  letter: string | null;
  stopper_id: string | null;
  phase: RoundPhase;
  started_at: string | null;
  ended_at: string | null;
  /** 0..n-1 kategori, n = tur özeti */
  reveal_index: number;
  /** Kategori açıldığı an — Devam için min süre */
  reveal_started_at: string | null;
};

export type AnswerRow = {
  id: string;
  round_id: string;
  profile_id: string;
  category: string;
  value: string | null;
  score: number;
  is_invalidated: boolean;
};

export type RoundPlayerRow = {
  id: string;
  round_id: string;
  profile_id: string;
  finished_at: string | null;
  finish_rank: number | null;
  speed_bonus: number;
  objections_used: number;
  round_score: number;
};

export type ObjectionRow = {
  id: string;
  answer_id: string;
  raised_by: string;
  status: "voting" | "valid" | "invalid";
  created_at: string;
  resolved_at: string | null;
};

export type ObjectionVoteRow = {
  id: string;
  objection_id: string;
  profile_id: string;
  is_valid: boolean;
};
