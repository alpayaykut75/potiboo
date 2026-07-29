/**
 * Hafif oyun SFX — Web Audio (dosya yok, mobilde gesture sonrası açılır).
 */

type SfxName =
  | "letterLock"
  | "countdownTick"
  | "countdownGo"
  | "urgency"
  | "urgentTick"
  | "timeUp"
  | "tap"
  | "confetti"
  | "spinTick";

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** iOS/Safari: ilk kullanıcı dokunuşunda çağır */
export async function unlockSfx(): Promise<void> {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* ignore */
    }
  }
  unlocked = c.state === "running";
}

function tone(
  freq: number,
  duration: number,
  opts: {
    type?: OscillatorType;
    gain?: number;
    fade?: number;
    delay?: number;
  } = {},
) {
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") void c.resume();

  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  const peak = opts.gain ?? 0.08;
  const fade = opts.fade ?? 0.02;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + fade);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function playSfx(name: SfxName): void {
  switch (name) {
    case "tap":
      tone(520, 0.05, { type: "triangle", gain: 0.05 });
      break;
    case "spinTick":
      // Harf çarkı — çok kısa, düşük tık
      tone(1400 + Math.random() * 400, 0.028, {
        type: "square",
        gain: 0.018,
        fade: 0.004,
      });
      break;
    case "letterLock":
      // Harf kilit — kısa “ding”
      tone(440, 0.09, { type: "triangle", gain: 0.07 });
      tone(660, 0.14, { type: "sine", gain: 0.09, delay: 0.06 });
      tone(880, 0.18, { type: "sine", gain: 0.05, delay: 0.12 });
      break;
    case "countdownTick":
      tone(680, 0.1, { type: "square", gain: 0.045 });
      break;
    case "countdownGo":
      tone(523, 0.08, { type: "triangle", gain: 0.07 });
      tone(784, 0.2, { type: "sine", gain: 0.09, delay: 0.07 });
      break;
    case "urgency":
      // 10 sn uyarısı — dikkat çekici çift bip
      tone(880, 0.12, { type: "square", gain: 0.06 });
      tone(880, 0.12, { type: "square", gain: 0.06, delay: 0.14 });
      break;
    case "urgentTick":
      tone(920, 0.07, { type: "square", gain: 0.04 });
      break;
    case "timeUp":
      tone(320, 0.15, { type: "sawtooth", gain: 0.05 });
      tone(220, 0.25, { type: "triangle", gain: 0.06, delay: 0.1 });
      break;
    case "confetti":
      // Podyum fanfar — yükselen arpej
      tone(523, 0.12, { type: "triangle", gain: 0.07 });
      tone(659, 0.12, { type: "triangle", gain: 0.07, delay: 0.1 });
      tone(784, 0.14, { type: "triangle", gain: 0.08, delay: 0.2 });
      tone(1046, 0.35, { type: "sine", gain: 0.09, delay: 0.32 });
      tone(1318, 0.2, { type: "sine", gain: 0.04, delay: 0.45 });
      break;
    default:
      break;
  }
}
