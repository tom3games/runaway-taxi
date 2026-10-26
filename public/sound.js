// 効果音・エンジン音・BGM。Web Audio で鳴らすだけ（音声ファイルなし）。最初に画面を触るまで鳴らない（ブラウザの決まり）。
const KEY = 'taxi-mute'
let ctx = null, master = null, sfxBus = null, bgmBus = null, muted = false
let engine = null, rainNode = null
let bgm = { want: null, timer: 0, step: 0, tempo: 1 }
try { muted = localStorage.getItem(KEY) === '1' } catch {}

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  try {
    ctx = new AC()
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination)
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master)
    bgmBus = ctx.createGain(); bgmBus.gain.value = 0.32; bgmBus.connect(master)
    if (bgm.want) startBgm(bgm.want)
  } catch { ctx = null }
}
addEventListener('pointerdown', unlock, { passive: true })
addEventListener('keydown', unlock)

export const isMuted = () => muted
export function setMuted(m) {
  muted = m
  try { localStorage.setItem(KEY, m ? '1' : '0') } catch {}
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.02)
}

function tone(freq, dur, { type = 'square', vol = 0.12, at = 0, slide = 0, bus = sfxBus } = {}) {
  if (!ctx || muted) return
  const t = ctx.currentTime + at
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(bus)
  o.start(t); o.stop(t + dur + 0.03)
}
function noise(dur, vol, cutoff, { at = 0, type = 'lowpass', bus = sfxBus } = {}) {
  if (!ctx || muted) return
  const len = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.5
  const src = ctx.createBufferSource(); src.buffer = buf
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = cutoff
  const g = ctx.createGain(); g.gain.value = vol
  src.connect(f); f.connect(g); g.connect(bus)
  src.start(ctx.currentTime + at)
}

export const sfx = {
  crash(p = 1) { noise(0.25, Math.min(0.9, 0.35 + p * 0.12), 520); tone(80, 0.18, { type: 'sine', vol: 0.3, slide: -40 }) },
  cone() { noise(0.12, 0.35, 1500); tone(520, 0.08, { type: 'triangle', vol: 0.08 }) },
  meow() { tone(700, 0.12, { type: 'sawtooth', vol: 0.06, slide: 500 }); tone(1100, 0.22, { type: 'sawtooth', vol: 0.05, at: 0.1, slide: -500 }) },
  honk() { tone(370, 0.32, { vol: 0.08 }); tone(466, 0.32, { vol: 0.07 }) },
  splash() { noise(0.5, 0.5, 2400, { type: 'bandpass' }) },
  coin() { [988, 1319].forEach((f, i) => tone(f, 0.14, { type: 'square', vol: 0.07, at: i * 0.07 })) },
  deliver() { this.coin(); [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.09, at: 0.12 + i * 0.07 })) },
  board() { [660, 990].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.08, at: i * 0.08 })) },
  angry() { tone(220, 0.25, { type: 'sawtooth', vol: 0.07, slide: -60 }); tone(180, 0.35, { type: 'sawtooth', vol: 0.06, at: 0.2, slide: -60 }) },
  call() { tone(1046, 0.07, { vol: 0.06 }); tone(1318, 0.09, { vol: 0.05, at: 0.06 }) },
  calm() { [784, 988, 1175].forEach((f, i) => tone(f, 0.18, { type: 'sine', vol: 0.08, at: i * 0.08 })) },
  count(go) { tone(go ? 1046 : 523, go ? 0.35 : 0.12, { vol: 0.1 }) },
  shutter() { noise(0.06, 0.5, 4000, { type: 'highpass' }); noise(0.05, 0.4, 3000, { type: 'highpass', at: 0.08 }) },
  siren() { tone(880, 0.25, { type: 'sine', vol: 0.06, slide: 300 }); tone(1180, 0.25, { type: 'sine', vol: 0.06, at: 0.25, slide: -300 }) },
  thunder() { noise(1.4, 0.7, 260); noise(0.3, 0.3, 1800) },
  phase() { [392, 523, 659].forEach((f, i) => tone(f, 0.2, { vol: 0.08, at: i * 0.1 })) },
  wreck() { noise(0.6, 0.9, 700); tone(140, 0.5, { type: 'sawtooth', vol: 0.15, slide: -100 }); tone(600, 0.4, { type: 'sine', vol: 0.08, at: 0.5, slide: -450 }) },
  timeup() { [784, 659, 523, 392].forEach((f, i) => tone(f, 0.22, { type: 'square', vol: 0.08, at: i * 0.14 })) },
  fanfare() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.28, { type: 'square', vol: 0.08, at: i * 0.11 })) },
  sad() { [392, 370, 349, 330].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.09, at: i * 0.3 })) },
  stamp() { noise(0.12, 0.6, 400); tone(90, 0.12, { type: 'sine', vol: 0.3 }) },
  tick() { tone(1500, 0.03, { vol: 0.03 }) }
}

// エンジン音（速さで音の高さが変わる）
export function setEngine(speed, on) {
  if (!ctx) return
  if (!engine) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter()
    o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 420
    g.gain.value = 0
    o.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus)
    o.start(); o2.start()
    engine = { o, o2, g }
  }
  const t = ctx.currentTime
  const v = muted || !on ? 0 : 0.035 + Math.min(1, speed / 7) * 0.03
  engine.g.gain.setTargetAtTime(v, t, 0.08)
  engine.o.frequency.setTargetAtTime(48 + speed * 16, t, 0.08)
  engine.o2.frequency.setTargetAtTime(24 + speed * 8, t, 0.08)
}

// 雨の音（第3幕）
export function setRain(on) {
  if (!ctx) return
  if (on && !rainNode) {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.6
    const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.09, ctx.currentTime, 0.8)
    src.connect(f); f.connect(g); g.connect(sfxBus); src.start()
    rainNode = { src, g }
  } else if (!on && rainNode) {
    rainNode.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3)
    const r = rainNode; setTimeout(() => { try { r.src.stop() } catch {} }, 1200)
    rainNode = null
  }
}

// BGM: 街ごとに音の並びが違う短いループ。幕が進むと速くなる
const SONGS = {
  shitamachi: { bpm: 112, scale: [0, 2, 5, 7, 9, 12, 14], root: 293.66, bass: [0, 0, 5, 7], lead: [4, 3, 2, 3, 4, 5, 4, 2, 1, 2, 0, -1, 1, 2, 3, -1] },
  minato: { bpm: 104, scale: [0, 2, 3, 5, 7, 9, 10, 12], root: 261.63, bass: [0, 5, 3, 4], lead: [4, -1, 5, 4, 2, -1, 3, 2, 0, -1, 2, 4, 5, 4, 2, -1] },
  neon: { bpm: 128, scale: [0, 3, 5, 7, 10, 12, 15], root: 220, bass: [0, 0, 3, 4], lead: [0, 2, 4, 2, 5, 4, 2, -1, 0, 2, 4, 6, 5, 4, 2, -1] }
}
export function startBgm(id) {
  bgm.want = id
  if (!ctx) return
  stopBgmTimer()
  const song = SONGS[id] || SONGS.shitamachi
  bgm.step = 0
  const tickFn = () => {
    if (!ctx || bgm.want !== id) return
    const spb = 60 / (song.bpm * bgm.tempo) / 2 // 8分音符
    const s = bgm.step++
    const note = i => song.root * Math.pow(2, song.scale[((i % song.scale.length) + song.scale.length) % song.scale.length] / 12) * (i >= song.scale.length ? 2 : 1)
    const l = song.lead[s % song.lead.length]
    if (l >= 0) tone(note(l), spb * 0.9, { type: 'square', vol: 0.05, bus: bgmBus })
    if (s % 2 === 0) tone(note(song.bass[Math.floor(s / 8) % song.bass.length]) / 4, spb * 1.6, { type: 'triangle', vol: 0.12, bus: bgmBus })
    if (s % 4 === 0) noise(0.08, 0.25, 180, { bus: bgmBus })
    if (s % 4 === 2) noise(0.05, 0.12, 6000, { type: 'highpass', bus: bgmBus })
    bgm.timer = setTimeout(tickFn, spb * 1000)
  }
  tickFn()
}
export function setTempo(k) { bgm.tempo = k }
function stopBgmTimer() { clearTimeout(bgm.timer); bgm.timer = 0 }
export function stopBgm() { bgm.want = null; stopBgmTimer(); setEngine(0, false); setRain(false) }
