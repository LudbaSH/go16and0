// Tiny Web Audio synth for the draft spin. No audio files (nothing to license or
// download) - every sound is generated live from oscillators. The "spin" is a run
// of short ticks like a prize wheel, and "settle" is a soft two-note chime. The
// mute preference is the only thing persisted (localStorage). The AudioContext is
// created lazily on the first sound, which also satisfies browser autoplay policy
// (it's always triggered by a click).

const Sound = (() => {
  const MUTE_KEY = "16-0:muted";
  let ctx = null;
  let muted = localStorage.getItem(MUTE_KEY) === "1";

  function ensureCtx() {
    if (muted) return null;
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One percussive blip: an oscillator through a fast volume decay envelope.
  function blip(freq, { type = "square", duration = 0.05, gain = 0.06, when = 0 } = {}) {
    const audio = ensureCtx();
    if (!audio) return;
    const t = audio.currentTime + when;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005); // quick attack
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration); // fast decay
    osc.connect(env).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // A single wheel tick. Pitch rises slightly as the reel slows so it feels like
  // it's winding down (caller passes progress 0..1).
  function tick(progress = 0) {
    blip(900 + progress * 500, { type: "square", duration: 0.04, gain: 0.05 });
  }

  // The reel lands: a pleasant rising two-note chime.
  function settle() {
    blip(660, { type: "triangle", duration: 0.18, gain: 0.08, when: 0 });
    blip(990, { type: "triangle", duration: 0.22, gain: 0.07, when: 0.09 });
  }

  function isMuted() { return muted; }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    return muted;
  }

  return { tick, settle, isMuted, toggleMute };
})();
