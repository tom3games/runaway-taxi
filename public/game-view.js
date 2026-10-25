// 暴走タクシーの画面。サーバーから届いた状態を描くだけ。操作は押した/離したをそのまま送る。
// render(state, { send }) は状態が届くたび（15回/秒）に呼ばれる。描画は requestAnimationFrame で別に回し、届いた位置の間を補間する。
import { W, H, TILES, PLACES, PARK, blockCenter } from './map.js'

const $ = s => document.querySelector(s)

export const ROLE_NAME = { wheel: 'ハンドル', wheelL: 'ハンドル左', wheelR: 'ハンドル右', engine: 'エンジン', navi: 'ナビ', lookout: '見張り', order: '接客' }
const ROLE_DO = {
  wheel: '左右に曲がる。行き先はナビに聞く',
  wheelL: '左に曲がるボタンだけ持っている。右は相棒',
  wheelR: '右に曲がるボタンだけ持っている。左は相棒',
  engine: 'アクセルとブレーキ。止まってからブレーキを押し続けるとバック',
  navi: '地図と行き先が見えるのはあなただけ。道を指示する',
  lookout: '暗い夜道で、障害物が遠くまで見えるのはあなただけ',
  order: 'お客さんの注文が分かるのはあなただけ。なだめて機嫌を保つ'
}
const KEY_OF = { wheel: ['left', 'right'], wheelL: ['left'], wheelR: ['right'], engine: ['brake', 'accel'] }
const CALLS_OF = { navi: ['left', 'right', 'straight', 'uturn', 'here'], lookout: ['danger', 'stop', 'clear'], order: ['slow', 'hurry'] }
const CALL_TEXT = { left: '次を左', right: '次を右', straight: 'まっすぐ', uturn: 'Uターン', here: 'ここで止めて', danger: 'あぶない', stop: '止まれ', clear: '行ける', slow: 'ゆっくり', hurry: '急いで' }
const KEY_TEXT = { left: '左', right: '右', accel: 'アクセル', brake: 'ブレーキ' }
const KIND_TIP = { hurry: '急いでいる。時間内に着けば上乗せ', gentle: 'スピードを出すと怒る', queasy: '急に曲がると気分が悪くなる', tour: '途中で指定の場所の前を通ると上乗せ', vip: 'ぶつけると大きく怒る。チップは2倍' }
const DRIVE = ['wheel', 'wheelL', 'wheelR', 'engine']
const ZONE_R = 1.4

// ---- 小さなアイコン（SVG）
const svg = path => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`
const ICON = {
  left: svg('<path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  right: svg('<path d="m9 4 8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  straight: svg('<path d="M12 20V5M5 11l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
  uturn: svg('<path d="M8 20V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  here: svg('<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="9" r="2.6" fill="currentColor"/>'),
  danger: svg('<path d="M12 3 2 21h20L12 3z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/>'),
  stop: svg('<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M7 12h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'),
  clear: svg('<path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  slow: svg('<path d="M3 17a9 9 0 0 1 18 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="m12 17-5-4" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'),
  hurry: svg('<path d="M3 17a9 9 0 0 1 18 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="m12 17 5-5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'),
  accel: svg('<path d="M7 3h10l-1 18H8z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M9.5 8h5M9.5 12h5M9.5 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  brake: svg('<rect x="3" y="7" width="18" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M7 12.5h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  sound: svg('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  mute: svg('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  calm: svg('<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>')
}
const STAR = on => `<svg class="star${on ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>`
const stars = n => `<span class="tx-stars" aria-label="星${n}つ">${Array.from({ length: 5 }, (_, i) => STAR(i < n)).join('')}</span>`
const yen = n => n.toLocaleString('ja-JP') + '円'
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ---- 音（ファイルなし。WebAudio で鳴らす）
const audio = { ctx: null, muted: false }
try { audio.muted = localStorage.getItem('taxi-mute') === '1' } catch {}
function ensureAudio() {
  try {
    if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {})
  } catch {}
}
function tone(freq, dur = 0.12, type = 'square', vol = 0.06, when = 0) {
  const c = audio.ctx; if (!c || audio.muted) return
  const t = c.currentTime + when
  const o = c.createOscillator(), g = c.createGain()
  o.type = type; o.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02)
}
function thud(power = 1) {
  const c = audio.ctx; if (!c || audio.muted) return
  const len = Math.floor(c.sampleRate * 0.25), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
  f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = Math.min(0.5, 0.12 + power * 0.06)
  s.buffer = buf; s.connect(f).connect(g).connect(c.destination); s.start()
}
const SFX = {
  deliver: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, i * 0.09)),
  board: () => [520, 780].forEach((f, i) => tone(f, 0.14, 'triangle', 0.07, i * 0.08)),
  angry: () => [300, 220].forEach((f, i) => tone(f, 0.22, 'sawtooth', 0.05, i * 0.15)),
  call: () => tone(980, 0.08, 'square', 0.04),
  cat: () => { tone(900, 0.2, 'sawtooth', 0.04); thud(2) },
  count: go => tone(go ? 1040 : 520, go ? 0.3 : 0.12, 'square', 0.05)
}

// ---- 地図は1回だけ描いておく（毎フレーム描き直さない）
const PX = 32
const ROAD_PAIRS = [1, 6, 11, 16, 21] // 2マス幅の道の1マス目
let mapImg = null
function buildMap() {
  const c = document.createElement('canvas')
  c.width = W * PX; c.height = H * PX
  const g = c.getContext('2d')
  const T = (x, y) => TILES[y]?.[x]
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = T(x, y), X = x * PX, Y = y * PX
    if (t === '#') { g.fillStyle = '#0b0d12'; g.fillRect(X, Y, PX, PX) }
    else if (t === 'B') {
      g.fillStyle = '#3a3550'; g.fillRect(X, Y, PX, PX)
      g.fillStyle = '#463f61'; g.fillRect(X + 3, Y + 3, PX - 6, PX - 6)
      for (let i = 0; i < 4; i++) { // 窓のあかり（場所で決まる模様）
        const on = ((x * 7 + y * 13 + i * 5) % 9) < 4
        g.fillStyle = on ? '#ffd56a' : '#2c2840'
        g.fillRect(X + 7 + (i % 2) * 12, Y + 7 + Math.floor(i / 2) * 12, 6, 6)
      }
    } else if (t === 'g') {
      g.fillStyle = '#1f4a2e'; g.fillRect(X, Y, PX, PX)
      if ((x + y) % 2 === 0) { g.fillStyle = '#2d6b40'; g.beginPath(); g.arc(X + 16, Y + 16, 9, 0, Math.PI * 2); g.fill() }
    } else { g.fillStyle = '#2b2f3a'; g.fillRect(X, Y, PX, PX) }
  }
  // 歩道のふち
  g.strokeStyle = '#596075'; g.lineWidth = 2
  const solid = (a, b) => { const t = T(a, b); return t === 'B' || t === '#' }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (T(x, y) !== '.') continue
    const X = x * PX, Y = y * PX
    g.beginPath()
    if (solid(x, y - 1)) { g.moveTo(X, Y + 1); g.lineTo(X + PX, Y + 1) }
    if (solid(x, y + 1)) { g.moveTo(X, Y + PX - 1); g.lineTo(X + PX, Y + PX - 1) }
    if (solid(x - 1, y)) { g.moveTo(X + 1, Y); g.lineTo(X + 1, Y + PX) }
    if (solid(x + 1, y)) { g.moveTo(X + PX - 1, Y); g.lineTo(X + PX - 1, Y + PX) }
    g.stroke()
  }
  // 中央線（交差点の中には引かない）
  g.strokeStyle = '#c9b45a'; g.lineWidth = 2; g.setLineDash([8, 10])
  for (const p of ROAD_PAIRS) for (let i = 1; i < W - 1; i++) {
    if (T(i, p) === '.' && T(i, p + 1) === '.' && !(T(i, p - 1) === '.' && T(i, p + 2) === '.')) { g.beginPath(); g.moveTo(i * PX, (p + 1) * PX); g.lineTo((i + 1) * PX, (p + 1) * PX); g.stroke() }
    if (T(p, i) === '.' && T(p + 1, i) === '.' && !(T(p - 1, i) === '.' && T(p + 2, i) === '.')) { g.beginPath(); g.moveTo((p + 1) * PX, i * PX); g.lineTo((p + 1) * PX, (i + 1) * PX); g.stroke() }
  }
  g.setLineDash([])
  // 乗り降りの場所（白い枠）
  g.strokeStyle = '#8f96a8'; g.lineWidth = 2
  for (const p of PLACES) g.strokeRect((p.x - 0.42) * PX, (p.y - 0.42) * PX, 0.84 * PX, 0.84 * PX)
  return c
}

// 街灯（交差点の中央）と看板
const LAMPS = []
for (const x of [2, 7, 12, 17, 22]) for (const y of [2, 7, 12, 17, 22]) if (TILES[y]?.[x] === '.' && TILES[y - 1]?.[x - 1] === '.') LAMPS.push([x, y])
const LABELS = []
{
  const seen = new Set()
  for (const p of PLACES) { const k = p.bx + ',' + p.by; if (seen.has(k)) continue; seen.add(k); const [x, y] = blockCenter(p.bx, p.by); LABELS.push({ name: p.name, x, y }) }
  LABELS.push({ name: PARK.name, x: PARK.x, y: PARK.y })
}

// ---- 状態
let built = null           // 組み立て済みの画面のキー（ラウンドと自分の担当）
let sendFn = null
let last = null            // 最新の state.game
const snaps = []           // 補間用 { t, car, obs }
const seenEv = new Set(), seenCall = new Set()
let callUntil = 0
let shake = 0
let camA = null
const pressedKeys = new Map() // key -> Set(pointerId)
let keepalive = null
let lastCd = -1
let lastCallSent = 0
let cv, ctx, dark, dctx
let raf = 0

const inGame = () => document.body.dataset.screen === 'game'
function myKeys(me) { const s = new Set(); for (const r of me) for (const k of KEY_OF[r] || []) s.add(k); return s }
function mapMode(me) { return me.includes('navi') && !me.some(r => DRIVE.includes(r)) && !me.includes('order') }

function setKey(k, on) {
  document.querySelectorAll(`[data-key="${k}"]`).forEach(b => b.classList.toggle('on', on))
  if (sendFn && inGame()) sendFn({ type: 'hold', key: k, on })
}
function press(k, pid) {
  ensureAudio()
  let s = pressedKeys.get(k); if (!s) pressedKeys.set(k, (s = new Set()))
  const was = s.size > 0; s.add(pid)
  if (!was) setKey(k, true)
}
function release(k, pid) {
  const s = pressedKeys.get(k); if (!s) return
  if (pid === '*') s.clear(); else s.delete(pid)
  if (s.size === 0) { pressedKeys.delete(k); setKey(k, false) }
}
function releaseAll() { for (const k of [...pressedKeys.keys()]) release(k, '*') }
function sendCall(what) {
  const t = performance.now()
  if (t - lastCallSent < 450) return // サーバーの連打制限より少し長く空ける
  lastCallSent = t; ensureAudio(); sendFn && sendFn({ type: 'call', what })
}
function sendCalm() { if (last?.order && !last.order.waiting && last.order.calm === 0) { ensureAudio(); sendFn({ type: 'calm' }) } }

function build(state) {
  const g = state.game, me = g.me
  const keys = myKeys(me)
  const root = $('#stage')
  releaseAll()
  const roleLine = me.length >= 5 ? '全部の担当（1人）' : me.map(r => ROLE_NAME[r]).join('・') || 'なし'
  const callBtns = g.solo ? [] : me.flatMap(r => (CALLS_OF[r] || []).map(w => ({ r, w })))
  const driveKeys = ['left', 'right', 'brake', 'accel'].filter(k => keys.has(k))
  root.innerHTML = `
    <div class="tx-hud">
      <div class="tx-chip tx-time"><b id="t-time">0</b><small>秒</small></div>
      <div class="tx-chip tx-score"><b id="t-score">0</b><small id="t-target"></small></div>
      <div class="tx-chip tx-dmg"><span class="tx-dmgbar"><i id="t-dmgbar"></i></span><small id="t-dmg">車 0%</small></div>
      <canvas id="t-face" class="tx-face" width="72" height="72" role="img" aria-label="お客さんの機嫌"></canvas>
      <button id="t-mute" class="tx-mute" aria-label="音のオンオフ">${audio.muted ? ICON.mute : ICON.sound}</button>
    </div>
    <div class="tx-sub">
      <span class="tx-me">あなた <b>${roleLine}</b></span>
      <span class="tx-lamps">${['left', 'right', 'accel', 'brake'].map(k => `<span class="tx-lamp" id="l-${k}">${KEY_TEXT[k]}</span>`).join('')}</span>
    </div>
    <div class="tx-view" id="t-view">
      <canvas id="t-cv"></canvas>
      <div class="tx-status" id="t-status"></div>
      <div class="tx-call" id="t-call" hidden></div>
      <div class="tx-pops" id="t-pops"></div>
      <div class="tx-ready" id="t-ready" hidden></div>
    </div>
    <div class="tx-panel" id="t-panel">
      ${me.includes('order') ? `<div class="tx-order" id="t-order"></div>` : ''}
      ${callBtns.length ? `<div class="tx-calls n${callBtns.length}">${callBtns.map((c, i) => `<button class="tx-callbtn r-${c.r}" data-call="${c.w}">${ICON[c.w]}<span>${CALL_TEXT[c.w]}</span><kbd>${i + 1}</kbd></button>`).join('')}</div>` : ''}
      ${me.includes('order') ? `<button class="tx-calm" id="t-calm">${ICON.calm}<span id="t-calmtxt">なだめる</span><kbd>C</kbd></button>` : ''}
      ${driveKeys.length ? `<div class="tx-drive n${driveKeys.length}">${driveKeys.map(k => `<button class="tx-key k-${k}" data-key="${k}" aria-label="${KEY_TEXT[k]}">${ICON[k]}<span>${KEY_TEXT[k]}</span></button>`).join('')}</div>` : ''}
    </div>`
  root.dataset.mode = mapMode(me) ? 'map' : 'chase'
  root.dataset.drive = String(driveKeys.length)

  for (const b of root.querySelectorAll('[data-key]')) {
    const k = b.dataset.key
    b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId) } catch {} press(k, e.pointerId) })
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, e => release(k, e.pointerId))
    b.addEventListener('contextmenu', e => e.preventDefault())
  }
  for (const b of root.querySelectorAll('[data-call]')) b.addEventListener('pointerdown', e => { e.preventDefault(); sendCall(b.dataset.call) })
  const calm = $('#t-calm')
  if (calm) calm.addEventListener('pointerdown', e => { e.preventDefault(); sendCalm() })
  $('#t-mute').addEventListener('click', () => {
    ensureAudio(); audio.muted = !audio.muted
    try { localStorage.setItem('taxi-mute', audio.muted ? '1' : '0') } catch {}
    $('#t-mute').innerHTML = audio.muted ? ICON.mute : ICON.sound
  })
  cv = $('#t-cv'); ctx = cv.getContext('2d')
  dark = document.createElement('canvas'); dctx = dark.getContext('2d')
  if (!mapImg) mapImg = buildMap()
  snaps.length = 0; camA = null; lastCd = -1
  built = keyOf(state)
}
const keyOf = state => state.round + ':' + state.game.me.join(',') + ':' + (state.game.solo ? 1 : 0)

// キーボード（PC）: 矢印 / WASD / スペース=ブレーキ / 数字=掛け声 / C=なだめる
const KB = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'accel', KeyW: 'accel', ArrowDown: 'brake', KeyS: 'brake', Space: 'brake' }
addEventListener('keydown', e => {
  if (!inGame() || !last || e.target?.tagName === 'INPUT') return
  const k = KB[e.code]
  if (k && myKeys(last.me).has(k)) { e.preventDefault(); if (!e.repeat) press(k, 'kb'); return }
  if (e.repeat) return
  const n = Number(e.key)
  if (n >= 1 && n <= 9) { const b = document.querySelectorAll('[data-call]')[n - 1]; if (b) sendCall(b.dataset.call) }
  if (e.code === 'KeyC' && last.me.includes('order')) sendCalm()
})
addEventListener('keyup', e => { const k = KB[e.code]; if (k) release(k, 'kb') })
addEventListener('blur', releaseAll)
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll() })

export function render(state, { send }) {
  sendFn = send
  const g = state.game
  if (built !== keyOf(state) || !$('#t-cv')) build(state)
  last = g
  window.__taxi = g // e2e が自分の画面の状態を読むため（自分の view だけなので他人の秘密は入っていない）
  snaps.push({ t: performance.now(), car: g.car, obs: g.obs })
  if (snaps.length > 4) snaps.shift()
  // 押しっぱなしを定期的に伝え直す（届かなくなったらサーバー側で自動的に離す）
  if (!keepalive) keepalive = setInterval(() => {
    if (!inGame()) { releaseAll(); return }
    for (const k of pressedKeys.keys()) sendFn && sendFn({ type: 'hold', key: k, on: true })
  }, 400)
  hud(g)
  for (const e of g.ev) if (!seenEv.has(e.id)) { seenEv.add(e.id); onEvent(e) }
  for (const c of g.calls) if (!seenCall.has(c.id)) { seenCall.add(c.id); onCall(c) }
  if (!raf) raf = requestAnimationFrame(frame)
}

function hud(g) {
  $('#t-time').textContent = g.time
  $('#t-time').parentElement.classList.toggle('warn', g.time <= 20)
  $('#t-score').textContent = g.score.toLocaleString('ja-JP')
  $('#t-target').textContent = `/${g.target.toLocaleString('ja-JP')}円`
  $('#t-dmg').textContent = `車 ${g.dmg}%`
  $('#t-dmgbar').style.width = g.dmg + '%'
  $('#t-dmgbar').closest('.tx-dmg').classList.toggle('warn', g.dmg >= 70)
  for (const k of ['left', 'right', 'accel', 'brake']) $('#l-' + k).classList.toggle('on', !!g.inp[k])
  drawFace(g.face)
  let st
  if (g.stage === 'pickup') st = g.nav ? `迎えに行く: ${g.nav.name}` : '迎えに行く。場所はナビに聞く'
  else st = g.nav ? `行き先: ${g.nav.name}` : '乗車中。行き先はナビに聞く'
  if (g.near) st = g.near.k === 'pickup' ? '乗り場が近い。輪の中で止まる' : '降ろす場所が近い。輪の中で止まる'
  $('#t-status').textContent = st
  $('#t-status').classList.toggle('near', !!g.near)
  // 接客係のカード
  const o = $('#t-order')
  if (o && g.order) {
    if (g.order.waiting) o.innerHTML = `<p class="tx-o-line">次のお客さんが<b>${esc(g.order.waiting)}</b>で待っている</p>`
    else {
      const od = g.order
      o.innerHTML = `<p class="tx-o-line"><b>${esc(od.name)}</b>「${esc(od.line)}」</p>
        <p class="tx-o-tip">${KIND_TIP[od.kind]}${od.via ? `（${esc(od.via)}: ${od.viaDone ? '通った' : 'まだ'}）` : ''}</p>
        <div class="tx-mood"><span class="tx-moodbar"><i style="width:${od.mood}%"></i></span><b>機嫌 ${od.mood}</b><small>${od.late ? '時間オーバー' : `目安あと${od.left}秒`}</small></div>`
    }
    const c = $('#t-calm')
    if (c) {
      c.disabled = !!g.order.waiting || g.order.calm > 0
      $('#t-calmtxt').textContent = !g.order.waiting && g.order.calm ? `なだめる ${g.order.calm}` : 'なだめる'
    }
  }
  // 開始前の説明（担当カード）
  const r = $('#t-ready')
  if (g.st === 'ready') {
    r.hidden = false
    if (g.cd !== lastCd) {
      lastCd = g.cd; SFX.count(false)
      r.innerHTML = `<div class="tx-cd">${g.cd}</div>
        <div class="tx-card"><p class="tx-card-h">あなたの担当</p><p class="tx-card-role">${g.me.map(x => ROLE_NAME[x]).join('・')}</p>
        <ul>${g.me.map(x => `<li>${ROLE_DO[x]}</li>`).join('')}</ul>
        ${g.solo ? '' : `<p class="tx-card-h">みんなの担当</p><ul class="tx-crew">${g.roles.map(p => `<li><b>${esc(p.name)}</b> ${p.roles.map(x => ROLE_NAME[x]).join('・')}</li>`).join('')}</ul>`}</div>`
    }
  } else if (!r.hidden) { r.hidden = true; SFX.count(true) }
}

function pop(html, cls = '') {
  const box = $('#t-pops'); if (!box) return
  const d = document.createElement('div')
  d.className = 'tx-pop ' + cls; d.innerHTML = html
  box.prepend(d)
  while (box.children.length > 3) box.lastChild.remove()
  setTimeout(() => d.remove(), 2600)
}

function onEvent(e) {
  if (e.k === 'deliver') { SFX.deliver(); pop(`${stars(e.stars)}<b>+${yen(e.yen)}</b><small>${esc(e.name)}${e.note ? '・' + esc(e.note) : ''}</small>`, 'good') }
  else if (e.k === 'board') { SFX.board(); pop(`<b>${esc(e.name)}が乗った</b>`, 'info') }
  else if (e.k === 'angry') { SFX.angry(); shake = 0.5; pop(`<b>${esc(e.name)}が怒って降りた</b><small>運賃なし</small>`, 'bad') }
  else if (e.k === 'via') { SFX.board(); pop(`<b>${esc(e.name)}の前を通った</b>`, 'info') }
  else if (e.k === 'calm') pop(`<b>${esc(e.by)}がなだめた</b>`, 'info')
  else if (e.k === 'leave') pop(`<b>${esc(e.name)}が抜けた</b><small>担当を引き継いだ</small>`, 'info')
  else if (e.k === 'crash') {
    const label = { wall: 'ドン', cone: 'コーンを倒した', cat: '猫が飛び出した', car: '車とぶつかった' }[e.what] || 'ドン'
    if (e.what === 'cat') SFX.cat(); else thud(e.p)
    shake = Math.min(0.6, 0.12 + e.p * 0.08)
    try { navigator.vibrate && navigator.vibrate(40) } catch {}
    pop(`<b>${label}</b>`, 'bad')
  }
}

function onCall(c) {
  SFX.call()
  callUntil = performance.now() + 2200
  const el = $('#t-call')
  el.hidden = false
  el.className = 'tx-call r-' + c.r
  el.innerHTML = `${ICON[c.w]}<b>${CALL_TEXT[c.w]}</b><small>${ROLE_NAME[c.r]} ${esc(c.by)}</small>`
}

function drawFace(f) {
  const c = $('#t-face'); if (!c) return
  const g = c.getContext('2d')
  g.clearRect(0, 0, 72, 72)
  if (f < 0) {
    g.strokeStyle = '#5b6273'; g.lineWidth = 4; g.setLineDash([6, 6]); g.beginPath(); g.arc(36, 36, 28, 0, 7); g.stroke(); g.setLineDash([])
    g.fillStyle = '#9aa3b2'; g.font = '700 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('空車', 36, 37)
    c.setAttribute('aria-label', '空車'); return
  }
  const col = ['#ff5a5a', '#ff8a4a', '#ffcf3a', '#9be36a', '#3ddc97'][f]
  g.fillStyle = col; g.beginPath(); g.arc(36, 36, 30, 0, 7); g.fill()
  g.fillStyle = '#1a1400'
  g.beginPath(); g.arc(25, 30, 4, 0, 7); g.fill(); g.beginPath(); g.arc(47, 30, 4, 0, 7); g.fill()
  g.strokeStyle = '#1a1400'; g.lineWidth = 4; g.lineCap = 'round'
  const curve = [-12, -6, 0, 7, 12][f]
  g.beginPath(); g.moveTo(22, 48 - curve / 3); g.quadraticCurveTo(36, 48 + curve, 50, 48 - curve / 3); g.stroke()
  if (f === 0) { g.beginPath(); g.moveTo(18, 19); g.lineTo(30, 24); g.moveTo(54, 19); g.lineTo(42, 24); g.stroke() }
  c.setAttribute('aria-label', 'お客さんの機嫌: ' + ['激怒', '不機嫌', 'ふつう', 'ごきげん', '大満足'][f])
}

// ---- 描画ループ
const lerp = (a, b, f) => a + (b - a) * f
const angLerp = (a, b, f) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f
const DELAY = 110 // 補間のために少し過去を描く（ms）。送信間隔 67ms より長く

function sample() {
  if (!snaps.length) return null
  const t = performance.now() - DELAY
  let a = snaps[snaps.length - 1], b = a
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= t && snaps[i + 1].t >= t) { a = snaps[i]; b = snaps[i + 1]; break }
  if (t < snaps[0].t) a = b = snaps[0]
  const f = a === b ? 1 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)))
  const car = { x: lerp(a.car.x, b.car.x, f), y: lerp(a.car.y, b.car.y, f), a: angLerp(a.car.a, b.car.a, f), v: b.car.v, s: b.car.s }
  const prev = new Map(a.obs.map(o => [o[0], o]))
  const obs = b.obs.map(o => { const p = prev.get(o[0]); return p ? [o[0], o[1], lerp(p[2], o[2], f), lerp(p[3], o[3], f), angLerp(p[4], o[4], f)] : o })
  return { car, obs }
}

let lastFrame = performance.now()
function frame(now) {
  raf = 0
  if (!inGame() || !cv || !cv.isConnected || !last) return
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now
  const view = cv.parentElement
  const dpr = Math.min(2, devicePixelRatio || 1)
  const cw = Math.max(1, Math.round(view.clientWidth * dpr)), ch = Math.max(1, Math.round(view.clientHeight * dpr))
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; dark.width = cw; dark.height = ch }
  const s = sample(); if (!s) return
  if (callUntil && now > callUntil) { callUntil = 0; $('#t-call').hidden = true }
  shake = Math.max(0, shake - dt)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, cw, ch)
  if (mapMode(last.me)) drawMapView(s, cw, ch, dpr)
  else drawChase(s, cw, ch, dpr, dt)
}

const toScreen = (m, x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f })
const FONT = '"Hiragino Sans","Noto Sans JP",system-ui,sans-serif'

function drawChase(s, cw, ch, dpr, dt) {
  const g = last, car = s.car
  if (camA == null) camA = car.a
  camA = angLerp(camA, car.a, Math.min(1, dt * 5))
  const sc = Math.min(cw, ch * 0.95) / 8.5
  const sx = shake ? (Math.random() - 0.5) * shake * 30 * dpr : 0, sy = shake ? (Math.random() - 0.5) * shake * 30 * dpr : 0
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.translate(cw / 2 + sx, ch * 0.64 + sy)
  ctx.rotate(-camA - Math.PI / 2) // 車の前が画面の上
  ctx.scale(sc, sc)
  ctx.translate(-car.x, -car.y)
  const m = ctx.getTransform()
  ctx.drawImage(mapImg, 0, 0, W, H)
  if (g.near) drawZone(g.near, performance.now())
  const look = g.me.includes('lookout')
  for (const o of s.obs) drawObstacle(o, look)
  drawTaxi(car, g.inp)
  // 夜の暗さ（ヘッドライトと街灯の所だけ明るい）。見張りは暗視で少し明るい
  dctx.setTransform(1, 0, 0, 1, 0, 0)
  dctx.globalCompositeOperation = 'source-over'
  dctx.clearRect(0, 0, cw, ch)
  dctx.fillStyle = look ? 'rgba(4,10,8,0.4)' : 'rgba(4,6,16,0.8)'
  dctx.fillRect(0, 0, cw, ch)
  dctx.globalCompositeOperation = 'destination-out'
  dctx.setTransform(m)
  const hole = (x, y, r, a) => { const gr = dctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); dctx.fillStyle = gr; dctx.beginPath(); dctx.arc(x, y, r, 0, 7); dctx.fill() }
  for (const [x, y] of LAMPS) if (Math.abs(x - car.x) < 9 && Math.abs(y - car.y) < 9) hole(x, y, 1.7, 0.55)
  hole(car.x, car.y, 1.9, 1)
  const L = 4.4, A = 0.55
  const gr = dctx.createRadialGradient(car.x, car.y, 0.3, car.x, car.y, L)
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.75, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
  dctx.fillStyle = gr
  dctx.beginPath(); dctx.moveTo(car.x, car.y); dctx.arc(car.x, car.y, L, car.a - A, car.a + A); dctx.closePath(); dctx.fill()
  if (g.near) hole(g.near.x, g.near.y, 1.7, 0.9)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(dark, 0, 0)
  if (look) { ctx.fillStyle = 'rgba(60,255,150,0.05)'; ctx.fillRect(0, 0, cw, ch) }
  // 看板（文字は画面に対してまっすぐ）
  ctx.font = `700 ${Math.round(13 * dpr)}px ${FONT}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const l of LABELS) {
    if (Math.abs(l.x - car.x) > 9 || Math.abs(l.y - car.y) > 9) continue
    const p = toScreen(m, l.x, l.y)
    labelBox(l.name, p.x, p.y, dpr)
  }
  if (g.near) { const p = toScreen(m, g.near.x, g.near.y); labelBox(g.near.k === 'pickup' ? '乗り場' : '降ろす', p.x, p.y - 30 * dpr, dpr, g.near.k === 'pickup' ? '#5ad1ff' : '#3ddc97') }
  // スピード
  const kmh = Math.round(car.v * 12)
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.font = `800 ${Math.round(24 * dpr)}px ${FONT}`
  ctx.fillStyle = kmh > 60 ? '#ff8a4a' : '#f2f3f5'
  ctx.fillText(String(kmh), 12 * dpr, ch - 12 * dpr)
  const w = ctx.measureText(String(kmh)).width
  ctx.font = `600 ${Math.round(12 * dpr)}px ${FONT}`; ctx.fillStyle = '#b4bccb'
  ctx.fillText('km/h', 16 * dpr + w, ch - 13 * dpr)
  if (g.nav) drawMini(s, cw, ch, dpr)
}

function labelBox(text, x, y, dpr, color) {
  const w = ctx.measureText(text).width + 12 * dpr, h = 20 * dpr
  ctx.fillStyle = color || 'rgba(10,12,20,0.78)'
  ctx.beginPath(); rrect(ctx, x - w / 2, y - h / 2, w, h, 6 * dpr); ctx.fill()
  ctx.fillStyle = color ? '#0b0d12' : '#ece6ff'
  ctx.fillText(text, x, y + 1)
}
function rrect(c, x, y, w, h, r) { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath() }

function drawZone(z, now) {
  const pulse = 0.85 + 0.15 * Math.sin(now / 160)
  const col = z.k === 'pickup' ? '90,209,255' : '61,220,151'
  ctx.fillStyle = `rgba(${col},0.18)`
  ctx.beginPath(); ctx.arc(z.x, z.y, ZONE_R * pulse, 0, 7); ctx.fill()
  ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 0.08; ctx.setLineDash([0.25, 0.18])
  ctx.beginPath(); ctx.arc(z.x, z.y, ZONE_R * pulse, 0, 7); ctx.stroke(); ctx.setLineDash([])
  if (z.k === 'pickup') drawPerson(z.x, z.y)
}
function drawPerson(x, y) {
  ctx.fillStyle = '#f2f3f5'
  ctx.beginPath(); ctx.arc(x, y - 0.22, 0.12, 0, 7); ctx.fill()
  ctx.fillRect(x - 0.1, y - 0.08, 0.2, 0.3)
  ctx.strokeStyle = '#f2f3f5'; ctx.lineWidth = 0.06
  ctx.beginPath(); ctx.moveTo(x + 0.1, y - 0.02); ctx.lineTo(x + 0.28, y - 0.3); ctx.stroke() // 手を挙げている
}

function drawTaxi(c, inp) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a)
  const L = 0.8, Wd = 0.5
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-L / 2 + 0.05, -Wd / 2 + 0.06, L, Wd)
  ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); rrect(ctx, -L / 2, -Wd / 2, L, Wd, 0.1); ctx.fill()
  ctx.fillStyle = '#1b2230'; ctx.beginPath(); rrect(ctx, -0.14, -0.19, 0.34, 0.38, 0.05); ctx.fill() // 窓
  ctx.fillStyle = '#fff7d6'; ctx.fillRect(-0.02, -0.12, 0.12, 0.24) // 屋根の行灯
  ctx.fillStyle = '#1a1400'; ctx.fillRect(-0.02, -0.03, 0.12, 0.06)
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#1a1400' : '#fff7d6'; ctx.fillRect(-0.36 + i * 0.04, -Wd / 2, 0.04, 0.05); ctx.fillRect(-0.36 + i * 0.04, Wd / 2 - 0.05, 0.04, 0.05) } // 市松の帯
  ctx.fillStyle = '#fffbe0'; ctx.fillRect(L / 2 - 0.05, -0.2, 0.05, 0.1); ctx.fillRect(L / 2 - 0.05, 0.1, 0.05, 0.1)
  ctx.fillStyle = inp && inp.brake ? '#ff3030' : '#6b1a1a'; ctx.fillRect(-L / 2, -0.2, 0.05, 0.1); ctx.fillRect(-L / 2, 0.1, 0.05, 0.1)
  // ウインカー（ハンドル担当が押している向きを全員が見られる）
  if (c.s && Math.floor(performance.now() / 250) % 2 === 0) {
    ctx.fillStyle = '#ff9a1a'; const yy = c.s < 0 ? -Wd / 2 - 0.03 : Wd / 2 - 0.05
    ctx.fillRect(L / 2 - 0.14, yy, 0.12, 0.08); ctx.fillRect(-L / 2 + 0.02, yy, 0.12, 0.08)
  }
  ctx.restore()
}

function drawObstacle(o, mark) {
  const [, t, x, y, a] = o
  ctx.save(); ctx.translate(x, y)
  if (t === 'c') {
    // 真上から見たコーン（オレンジの輪と白い帯）
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, 7); ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(0, 0, 0.13, 0, 7); ctx.stroke()
    ctx.fillStyle = '#ffb27a'; ctx.beginPath(); ctx.arc(0, 0, 0.05, 0, 7); ctx.fill()
  } else if (t === 'k') {
    ctx.rotate(a)
    ctx.fillStyle = '#e9e3d4'; ctx.beginPath(); ctx.ellipse(0, 0, 0.22, 0.13, 0, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.arc(0.22, 0, 0.1, 0, 7); ctx.fill()
    ctx.strokeStyle = '#e9e3d4'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(-0.2, 0); ctx.quadraticCurveTo(-0.34, -0.15, -0.3, -0.25); ctx.stroke()
    ctx.fillStyle = '#7cff6a'; ctx.beginPath(); ctx.arc(0.26, -0.04, 0.025, 0, 7); ctx.arc(0.26, 0.04, 0.025, 0, 7); ctx.fill()
  } else {
    ctx.rotate(a)
    ctx.fillStyle = '#4a7dff'; ctx.beginPath(); rrect(ctx, -0.38, -0.23, 0.76, 0.46, 0.08); ctx.fill()
    ctx.fillStyle = '#132040'; ctx.fillRect(-0.1, -0.17, 0.28, 0.34)
    ctx.fillStyle = '#fffbe0'; ctx.fillRect(0.33, -0.19, 0.05, 0.1); ctx.fillRect(0.33, 0.09, 0.05, 0.1)
  }
  ctx.restore()
  if (mark) { ctx.strokeStyle = 'rgba(255,90,90,0.95)'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(x, y, 0.48, 0, 7); ctx.stroke() }
}

// ナビの全体地図（北が上）
function drawMapView(s, cw, ch, dpr) {
  const g = last
  const pad = 6 * dpr
  const sc = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H)
  ctx.setTransform(sc, 0, 0, sc, (cw - W * sc) / 2, (ch - H * sc) / 2)
  ctx.drawImage(mapImg, 0, 0, W, H)
  for (const o of s.obs) drawObstacle(o, true)
  if (g.nav) drawNavMark(g.nav, performance.now())
  drawTaxi(s.car, g.inp)
  ctx.save(); ctx.translate(s.car.x, s.car.y); ctx.rotate(s.car.a) // 向きの矢印（左右を言う手がかり）
  ctx.fillStyle = 'rgba(255,207,58,0.95)'; ctx.beginPath(); ctx.moveTo(1.1, 0); ctx.lineTo(0.62, -0.3); ctx.lineTo(0.62, 0.3); ctx.closePath(); ctx.fill()
  ctx.restore()
  const m = ctx.getTransform()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.font = `700 ${Math.round(Math.max(10, Math.min(14, sc / dpr * 0.6)) * dpr)}px ${FONT}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const l of LABELS) { const p = toScreen(m, l.x, l.y); labelBox(l.name, p.x, p.y, dpr, g.nav && l.name === g.nav.name ? '#ffcf3a' : null) }
}
function drawNavMark(n, now) {
  const col = n.k === 'pickup' ? '#5ad1ff' : '#3ddc97'
  const r = 0.8 + 0.2 * Math.sin(now / 200)
  ctx.strokeStyle = col; ctx.lineWidth = 0.2
  ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.stroke()
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(n.x, n.y, 0.3, 0, 7); ctx.fill()
}
function drawMini(s, cw, ch, dpr) { // ナビを兼ねている人の右上の小さな地図
  const size = Math.min(cw, ch) * 0.36, pad = 8 * dpr
  const x0 = cw - size - pad, y0 = pad
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x0 - 3, y0 - 3, size + 6, size + 6)
  const sc = size / W
  ctx.setTransform(sc, 0, 0, sc, x0, y0)
  ctx.drawImage(mapImg, 0, 0, W, H)
  drawNavMark(last.nav, performance.now())
  ctx.fillStyle = '#ffcf3a'
  ctx.save(); ctx.translate(s.car.x, s.car.y); ctx.rotate(s.car.a)
  ctx.beginPath(); ctx.moveTo(0.9, 0); ctx.lineTo(-0.6, -0.6); ctx.lineTo(-0.6, 0.6); ctx.closePath(); ctx.fill()
  ctx.restore()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

// ---- 結果画面
export function renderResult(state) {
  releaseAll()
  const r = state.result
  const d = document.createElement('div')
  d.className = 'tx-res'
  const shown = r.trips.slice(-4)
  const more = r.trips.length - shown.length
  const why = r.reason === 'wreck' ? 'ぶつけすぎて車が動かなくなった' : r.reason === 'empty' ? 'だれもいなくなった' : r.win ? '目標の売上に届いた' : '目標の売上に届かなかった'
  d.innerHTML = `
    <div class="tx-res-top">
      <div class="tx-rank" data-r="${r.rank}"><small>ランク</small>${r.rank === '-' ? '×' : r.rank}</div>
      <div><p class="tx-res-score">${yen(r.score)}</p><p class="muted">目標 ${yen(r.target)}・${why}</p></div>
    </div>
    <ul class="tx-trips">${shown.map(t => `<li><span class="tx-t-name">${esc(t.name)}<small>${esc(t.dest)}へ</small></span>${stars(t.stars)}<b>${yen(t.yen)}</b>${t.note ? `<small class="tx-t-note">${esc(t.note)}</small>` : ''}</li>`).join('') || '<li class="muted">だれも運べなかった</li>'}</ul>
    ${more > 0 ? `<p class="muted">ほか ${more}件</p>` : ''}
    <p class="muted">運んだ ${r.trips.filter(t => t.yen > 0).length}人・ぶつけた ${r.crashes}回・車のダメージ ${r.dmg}%</p>
    <p class="tx-crewline">${r.crew.map(c => `<span><b>${esc(c.name)}</b> ${c.roles.map(x => ROLE_NAME[x]).join('・')}</span>`).join('')}</p>`
  return d
}
