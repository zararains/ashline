// audio.js — every sound is synthesised with WebAudio: no audio files, so the
// game ships as pure code and still cracks, thuds and beeps. One shared
// context, a small pool of noise buffers, and distance attenuation done by
// hand for world sounds (shots, explosions, footsteps).

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function env(gain, t0, peak, decay) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

// A burst of filtered noise: the body of every gunshot and explosion.
// vol is pre-attenuated by the caller for world sounds.
function burst({ dur = 0.12, freq = 1800, q = 0.7, vol = 0.5, type = 'lowpass', slide = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + slide), t0 + dur);
  const g = ctx.createGain(); env(g, t0, vol, dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

function tone({ freq = 440, dur = 0.1, vol = 0.2, type = 'square', slide = 0, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  const g = ctx.createGain(); env(g, t0, vol, dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// Attenuation for sounds in the world relative to the listener.
export function worldVol(dist, ref = 12) {
  if (dist <= ref) return 1;
  return Math.max(0, ref / dist) ** 1.4;
}

const SHOT_STYLE = {
  pistol:  { dur: 0.1,  freq: 2400, vol: 0.5,  crack: 900 },
  smg:     { dur: 0.08, freq: 2100, vol: 0.42, crack: 800 },
  shotgun: { dur: 0.24, freq: 1100, vol: 0.75, crack: 500 },
  rifle:   { dur: 0.13, freq: 1700, vol: 0.58, crack: 1000 },
  sniper:  { dur: 0.34, freq: 900,  vol: 0.85, crack: 1400 },
};

export function sfxShot(kind, vol = 1) {
  const s = SHOT_STYLE[kind] || SHOT_STYLE.rifle;
  burst({ dur: s.dur, freq: s.freq, vol: s.vol * vol });
  burst({ dur: 0.03, freq: s.crack + 2600, vol: 0.22 * vol, type: 'highpass' });
  tone({ freq: 120, dur: s.dur * 0.8, vol: 0.18 * vol, type: 'triangle', slide: -60 });
}
export function sfxDryFire() { tone({ freq: 1900, dur: 0.03, vol: 0.12, type: 'square' }); }
export function sfxReload() {
  tone({ freq: 500, dur: 0.04, vol: 0.15, type: 'square' });
  tone({ freq: 320, dur: 0.04, vol: 0.15, type: 'square', delay: 0.16 });
  tone({ freq: 700, dur: 0.05, vol: 0.18, type: 'square', delay: 0.3 });
}
export function sfxDraw() { burst({ dur: 0.05, freq: 3000, vol: 0.1, type: 'bandpass' }); }
export function sfxHit(head) {
  tone({ freq: head ? 1560 : 1050, dur: 0.06, vol: 0.22, type: 'sine' });
  if (head) tone({ freq: 2100, dur: 0.09, vol: 0.16, type: 'sine', delay: 0.03 });
}
export function sfxHurt() { tone({ freq: 190, dur: 0.14, vol: 0.3, type: 'sawtooth', slide: -70 }); }
export function sfxStep(vol = 0.06) { burst({ dur: 0.045, freq: 700, vol, type: 'lowpass' }); }
export function sfxJump() { burst({ dur: 0.06, freq: 1200, vol: 0.07, type: 'bandpass' }); }
export function sfxThrow() { burst({ dur: 0.09, freq: 1600, vol: 0.1, type: 'bandpass', slide: -700 }); }
export function sfxExplosion(vol = 1) {
  burst({ dur: 0.7, freq: 420, vol: 0.95 * vol, slide: -320 });
  burst({ dur: 0.18, freq: 2600, vol: 0.4 * vol, type: 'highpass' });
  tone({ freq: 64, dur: 0.55, vol: 0.5 * vol, type: 'sine', slide: -28 });
}
export function sfxFlashPop(vol = 1) { burst({ dur: 0.06, freq: 3400, vol: 0.4 * vol, type: 'highpass' }); tone({ freq: 2400, dur: 0.25, vol: 0.1 * vol, type: 'sine' }); }
export function sfxBeep(final = false) { tone({ freq: final ? 1560 : 1180, dur: final ? 0.16 : 0.07, vol: 0.22, type: 'square' }); }
export function sfxPlant() { tone({ freq: 880, dur: 0.07, vol: 0.18, type: 'square' }); tone({ freq: 1174, dur: 0.09, vol: 0.18, type: 'square', delay: 0.1 }); }
export function sfxBuy() { tone({ freq: 1320, dur: 0.06, vol: 0.16, type: 'sine' }); tone({ freq: 1760, dur: 0.08, vol: 0.14, type: 'sine', delay: 0.05 }); }
export function sfxDeny() { tone({ freq: 220, dur: 0.11, vol: 0.18, type: 'square' }); }
export function sfxRoundEnd(win) {
  const base = win ? 523 : 392;
  tone({ freq: base, dur: 0.14, vol: 0.2, type: 'triangle' });
  tone({ freq: base * 1.25, dur: 0.14, vol: 0.2, type: 'triangle', delay: 0.13 });
  tone({ freq: base * (win ? 1.5 : 0.84), dur: 0.3, vol: 0.22, type: 'triangle', delay: 0.26 });
}
