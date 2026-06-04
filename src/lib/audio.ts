let ctx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gain: GainNode | null = null;

function ensureCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** Single short beep (~250ms). */
export function beepOnce(freq = 880, durMs = 250) {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.value = 0.0001;
  osc.connect(g).connect(c.destination);
  const t = c.currentTime;
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
  osc.start(t);
  osc.stop(t + durMs / 1000 + 0.02);
}

/** Start continuous alarm tone (used by Manager). */
export function startContinuousAlarm(freq = 1000) {
  const c = ensureCtx();
  if (!c || oscillator) return;
  oscillator = c.createOscillator();
  gain = c.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = freq;
  gain.gain.value = 0.18;
  oscillator.connect(gain).connect(c.destination);
  oscillator.start();
}

export function stopContinuousAlarm() {
  try { oscillator?.stop(); } catch {}
  oscillator?.disconnect();
  gain?.disconnect();
  oscillator = null;
  gain = null;
}

/** Speak a short message via Web Speech API. */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 1;
  u.volume = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}