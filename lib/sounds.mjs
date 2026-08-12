// WebAudio-synthesized game sounds — no vendored assets to license or ship.
// The audio context is created lazily on the first user gesture-driven call
// so browsers won't reject it.

let audioContext = null;
let masterGain = null;

function ensureContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) {
    audioContext = new Ctor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(audioContext.destination);
  }
  // If the context was created outside a user gesture (e.g. the engine moves
  // first when the player is Black), the browser starts it suspended. Resume
  // opportunistically — inside a gesture this succeeds and audio works for
  // the rest of the session instead of staying silent forever.
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function envelope(oscillator, gain, { attack = 0.005, decay = 0.14, sustain = 0, release = 0.05, peak = 1 } = {}) {
  const ctx = audioContext;
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), now + attack + decay);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay + release);
  oscillator.start(now);
  oscillator.stop(now + attack + decay + release + 0.05);
}

function tone(freq, options = {}) {
  const ctx = ensureContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = options.type || "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(masterGain);
  envelope(osc, gain, options);
}

function chord(freqs, options = {}) {
  for (const [index, freq] of freqs.entries()) {
    setTimeout(() => tone(freq, options), index * (options.stagger || 40));
  }
}

// Public API — every call is a no-op if `enabled` is false, so callers don't
// have to guard.
export function playSound(kind, { enabled = true } = {}) {
  if (!enabled) return;
  switch (kind) {
    case "move":
      tone(440, { type: "sine", decay: 0.08, peak: 0.6 });
      break;
    case "capture":
      tone(220, { type: "triangle", decay: 0.16, peak: 0.9 });
      tone(180, { type: "sine", decay: 0.18, peak: 0.5 });
      break;
    case "check":
      chord([660, 990], { type: "square", decay: 0.12, peak: 0.5, stagger: 60 });
      break;
    case "castle":
      chord([440, 660], { type: "sine", decay: 0.12, peak: 0.6, stagger: 90 });
      break;
    case "promotion":
      chord([523, 659, 784, 1046], { type: "triangle", decay: 0.16, peak: 0.5, stagger: 60 });
      break;
    case "gameWin":
      chord([523, 659, 784, 1046], { type: "sine", decay: 0.24, peak: 0.7, stagger: 120 });
      break;
    case "gameLoss":
      chord([440, 330, 262], { type: "sine", decay: 0.32, peak: 0.6, stagger: 140 });
      break;
    case "gameDraw":
      chord([440, 440, 523], { type: "sine", decay: 0.26, peak: 0.5, stagger: 140 });
      break;
    case "drillSolved":
      chord([784, 1046], { type: "triangle", decay: 0.14, peak: 0.55, stagger: 80 });
      break;
    case "drillMissed":
      tone(196, { type: "sawtooth", decay: 0.22, peak: 0.4 });
      break;
    case "click":
      tone(880, { type: "sine", decay: 0.04, peak: 0.3 });
      break;
    default:
      tone(440, { decay: 0.08, peak: 0.5 });
  }
}

// The mating side is always the mover, so win vs loss depends on WHO is
// listening: pass the human player's color. Without it the old logic played
// the victory fanfare even when the bot checkmated the player.
export function classifyMoveForSound(move, gameAfter, perspectiveColor = null) {
  if (!move) return "move";
  if (gameAfter?.isCheckmate?.()) {
    if (!perspectiveColor) return "gameWin";
    return move.color === perspectiveColor ? "gameWin" : "gameLoss";
  }
  if (gameAfter?.isCheck?.()) return "check";
  if (move.promotion) return "promotion";
  if (move.san?.includes("O-O")) return "castle";
  if (move.captured) return "capture";
  return "move";
}
