// 暴走タクシーのゲーム画面。サーバーから届いた状態を描くだけ。操作は押した/離したをそのまま送る。
// render(state, { send }) は状態が届くたび（15回/秒）に呼ばれる。描画は requestAnimationFrame で別に回し、届いた位置の間を補間する。
// 3D（view3d.js / Three.js）で描く。WebGL が使えない端末と ?2d を付けたときは、真上から見た 2D で描く。
import { W, H, getMap, lightAt, PHASES, blockCenter, ROAD_PAIRS, MAPS } from './map.js'
import * as snd from './sound.js'

const $ = s => document.querySelector(s)

// 3D は重いので後から読む（読み終わる前にゲームが始まったら、いったん 2D で描いて読み終わったら切り替える）
let V3 = null, v3Failed = false
const want3d = !new URLSearchParams(location.search).has('2d')
const v3Ready = want3d ? import('./view3d.js').then(m => { V3 = m }).catch(e => { v3Failed = true; console.warn('3D を読めないので 2D で描く', e) }) : Promise.resolve()

export const ROLE_NAME = { wheel: 'ハンドル', wheelL: 'ハンドル左', wheelR: 'ハンドル右', engine: 'エンジン', navi: 'ナビ', lookout: '見張り', order: '接客' }
const ROLE_DO = {
  wheel: '左右に曲がる。行き先はナビに聞く',
  wheelL: '左に曲がるボタンだけ持っている。右は相棒',
  wheelR: '右に曲がるボタンだけ持っている。左は相棒',
  engine: 'アクセルは1回押すと入りっぱなし。ブレーキを押すと切れる',
  navi: '地図と行き先が見えるのはあなただけ。道を指示する',
  lookout: '暗い夜道で、障害物が遠くまで見えるのはあなただけ',
  order: 'お客さんの注文が分かるのはあなただけ。なだめて機嫌を保つ'
}
const ROLE_COLOR = { wheel: '#ffcf3a', wheelL: '#ffcf3a', wheelR: '#ffcf3a', engine: '#2fcf7f', navi: '#5ad1ff', lookout: '#ff8ab0', order: '#c79bff' }
const KEY_OF = { wheel: ['left', 'right'], wheelL: ['left'], wheelR: ['right'], engine: ['brake', 'accel'] }
const CALLS_OF = { navi: ['left', 'right', 'straight', 'uturn', 'here'], lookout: ['danger', 'stop', 'clear'], order: ['slow', 'hurry'] }
const CALL_TEXT = { left: '次を左', right: '次を右', straight: 'まっすぐ', uturn: 'Uターン', here: 'ここで止めて', danger: 'あぶない', stop: '止まれ', clear: '行ける', slow: 'ゆっくり', hurry: '急いで' }
const CALL_BTN = { ...CALL_TEXT, here: '止めて' } // ボタンに収まる短い言い方
const KEY_TEXT = { left: '左', right: '右', accel: 'アクセル', brake: 'ブレーキ' }
const KIND_TIP = {
  hurry: '急いでいる。時間内なら上乗せ', gentle: 'スピードを出すと怒る', queasy: '急に曲がると気分が悪くなる', tour: '指定の場所の前を通ると上乗せ',
  vip: 'ぶつけると大激怒。チップ2倍', kid: '速いと喜ぶ。のろいと退屈', mama: '急ぐ。でも揺らすと怒る。無事なら上乗せ', ghost: 'じわじわ冷える。運賃2倍'
}
const PAX_NAME = { hurry: '受験生', gentle: 'おばあちゃん', tour: '観光客', kid: 'ちびっこ', queasy: '酔っぱらい', vip: '社長', mama: '妊婦さん', ghost: '幽霊' }
const DRIVE = ['wheel', 'wheelL', 'wheelR', 'engine']
const ZONE_R = 1.4

// ---- アイコン（SVG）
const svg = (path, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${path}</svg>`
const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"'
export const ICON = {
  left: svg(`<path d="M15 4 7 12l8 8" ${S} stroke-width="3.4"/>`),
  right: svg(`<path d="m9 4 8 8-8 8" ${S} stroke-width="3.4"/>`),
  straight: svg(`<path d="M12 20V5M5 11l7-7 7 7" ${S} stroke-width="3"/>`),
  uturn: svg(`<path d="M8 20V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4" ${S} stroke-width="2.8"/>`),
  here: svg(`<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" ${S} stroke-width="2.6"/><circle cx="12" cy="9" r="2.6" fill="currentColor"/>`),
  danger: svg(`<path d="M12 3 2 21h20L12 3z" ${S} stroke-width="2.6"/><path d="M12 10v5" ${S} stroke-width="2.8"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/>`),
  stop: svg(`<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" ${S} stroke-width="2.6"/><path d="M7 12h10" ${S} stroke-width="3"/>`),
  clear: svg(`<path d="m4 12 5 5L20 6" ${S} stroke-width="3.2"/>`),
  slow: svg(`<path d="M3 17a9 9 0 0 1 18 0" ${S} stroke-width="2.6"/><path d="m12 17-5-4" ${S} stroke-width="2.8"/>`),
  hurry: svg(`<path d="M3 17a9 9 0 0 1 18 0" ${S} stroke-width="2.6"/><path d="m12 17 5-5" ${S} stroke-width="2.8"/>`),
  accel: svg(`<path d="M7 3h10l-1 18H8z" ${S} stroke-width="2.4"/><path d="M9.5 8h5M9.5 12h5M9.5 16h5" ${S} stroke-width="2"/>`),
  brake: svg(`<rect x="3" y="7" width="18" height="11" rx="2.5" ${S} stroke-width="2.4"/><path d="M7 12.5h10" ${S} stroke-width="2.4"/>`),
  sound: svg(`<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" ${S} stroke-width="2"/>`),
  mute: svg(`<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" ${S} stroke-width="2.2"/>`),
  calm: svg(`<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" ${S} stroke-width="2.4"/>`),
  clock: svg(`<circle cx="12" cy="13" r="8" ${S} stroke-width="2.4"/><path d="M12 9v4l3 2M9 2h6" ${S} stroke-width="2.4"/>`),
  yen: svg(`<path d="M6 3l6 8 6-8M12 11v10M7 13h10M7 17h10" ${S} stroke-width="2.4"/>`),
  wrench: svg(`<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2z" ${S} stroke-width="2.2"/>`),
  wheel: svg(`<circle cx="12" cy="12" r="9" ${S} stroke-width="2.4"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M3.5 10.5h6M14.5 10.5h6M12 14.5V21" ${S} stroke-width="2.4"/>`),
  engine: svg(`<path d="M7 3h10l-1 18H8z" ${S} stroke-width="2.4"/><path d="M9.5 8h5M9.5 12h5M9.5 16h5" ${S} stroke-width="2"/>`),
  navi: svg(`<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" ${S} stroke-width="2.2"/><path d="M9 3v15M15 6v15" ${S} stroke-width="2"/>`),
  lookout: svg(`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" ${S} stroke-width="2.2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>`),
  order: svg(`<path d="M4 5h16v11H9l-5 4z" ${S} stroke-width="2.2"/><path d="M8 10h8" ${S} stroke-width="2.2"/>`)
}
ICON.wheelL = ICON.wheel; ICON.wheelR = ICON.wheel
const STAR = on => `<svg class="star${on ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>`
const stars = n => `<span class="stars" aria-label="星${n}つ">${Array.from({ length: 5 }, (_, i) => STAR(i < n)).join('')}</span>`
const yen = n => n.toLocaleString('ja-JP') + '円'
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// お客さんの顔（HUD 用の SVG）。機嫌 0..4、-1 は空車
const FACE_COL = ['#ff5a4a', '#ff9a4a', '#ffd84a', '#a8e66a', '#3ddc97']
function faceSvg(f, kind) {
  if (f < 0) return `<svg viewBox="0 0 64 64" aria-label="空車"><rect x="4" y="16" width="56" height="32" rx="8" fill="#2a2440" stroke="#ffcf3a" stroke-width="3" stroke-dasharray="6 5"/><text x="32" y="38" text-anchor="middle" font-family="Dela Gothic One,sans-serif" font-size="15" fill="#ffcf3a">空車</text></svg>`
  const ghost = kind === 'ghost'
  const skin = ghost ? '#e8f0ff' : FACE_COL[f]
  const mouth = ['M20 46q12-12 24 0', 'M22 44q10-5 20 0', 'M22 42h20', 'M21 39q11 9 22 0', 'M19 37q13 16 26 0z'][f]
  const brow = f === 0 ? '<path d="M14 18l12 6M50 18l-12 6" stroke="#14110c" stroke-width="4" stroke-linecap="round"/>' : ''
  const extra = f === 1 ? '<path d="M52 10q6 9 0 12q-6-3 0-12z" fill="#7fd3ff"/>' : f === 4 ? '<path d="M50 6q4-4 7 0q3 4-7 10q-10-6-7-10q3-4 7 0z" fill="#ff5aa0"/>' : ''
  return `<svg viewBox="0 0 64 64" aria-label="お客さんの機嫌 ${['激怒', '不機嫌', 'ふつう', 'ごきげん', '大満足'][f]}"><circle cx="32" cy="34" r="26" fill="${skin}" stroke="#14110c" stroke-width="3"/>${brow}<circle cx="23" cy="30" r="3.6" fill="#14110c"/><circle cx="41" cy="30" r="3.6" fill="#14110c"/><path d="${mouth}" fill="${f === 4 ? '#7a1d1d' : 'none'}" stroke="#14110c" stroke-width="3.4" stroke-linecap="round"/>${extra}</svg>`
}

// ---- 称号（結果の記録から決まる）。集めた称号は端末に残す
export const TITLES = [
  { id: 'safe', name: '安全運転の鑑', desc: '一度もぶつけずに1人以上届けた', test: r => r.crashes === 0 && r.trips.some(t => t.yen > 0) },
  { id: 'five', name: '五つ星ドライバー', desc: '星5つを3回', test: r => r.stats.five >= 3 },
  { id: 'rich', name: '売上王', desc: '6,000円以上かせいだ', test: r => r.score >= 6000 },
  { id: 'night', name: '嵐を越えた者', desc: '嵐の深夜まで走りきって目標達成', test: r => r.win && r.phase >= 2 },
  { id: 'ghost', name: '霊感タクシー', desc: '幽霊を送り届けた', test: r => r.stats.ghost >= 1 },
  { id: 'kid', name: 'ちびっこのヒーロー', desc: 'ちびっこを星4以上で届けた', test: r => r.stats.kid >= 1 },
  { id: 'calm', name: 'なだめの達人', desc: '1回で5回なだめた', test: r => r.stats.calm >= 5 },
  { id: 'talk', name: 'にぎやかな車内', desc: '掛け声を30回', test: r => r.stats.calls >= 30 },
  { id: 'speed', name: '音速タクシー', desc: '時速80km以上を出した', test: r => r.stats.maxKmh >= 80 },
  { id: 'cat', name: '猫に好かれる', desc: '猫と2回出会った（ぶつかった）', test: r => r.stats.cat >= 2 },
  { id: 'wall', name: '壁ドン職人', desc: '壁に8回ぶつけた', test: r => r.stats.wall >= 8 },
  { id: 'cone', name: 'コーン収集家', desc: 'コーンを4本倒した', test: r => r.stats.cone >= 4 },
  { id: 'water', name: '水陸両用', desc: '川に突っ込んだ', test: r => r.stats.water >= 1 },
  { id: 'red', name: '信号は飾り', desc: '信号無視3回', test: r => r.stats.red >= 3 },
  { id: 'grass', name: '芝刈り機', desc: '芝の上を5秒以上走った', test: r => r.stats.grass >= 5 },
  { id: 'angry', name: '客を怒らせる天才', desc: 'お客さんが2人怒って降りた', test: r => r.stats.angry >= 2 },
  { id: 'late', name: '遅刻の常習犯', desc: '急ぎのお客さんを2回遅らせた', test: r => r.stats.late >= 2 },
  { id: 'wreck', name: '廃車請負人', desc: 'タクシーを壊した', test: r => r.reason === 'wreck' }
]
const REC_KEY = 'taxi-rec'
export function loadRecords() {
  try { const r = JSON.parse(localStorage.getItem(REC_KEY) || 'null'); if (r && typeof r === 'object') return { best: r.best || {}, titles: r.titles || {}, plays: r.plays || 0, trips: r.trips || 0, yen: r.yen || 0 } } catch {}
  return { best: {}, titles: {}, plays: 0, trips: 0, yen: 0 }
}
function saveRecords(rec) { try { localStorage.setItem(REC_KEY, JSON.stringify(rec)) } catch {} }
const RANK_ORDER = { S: 4, A: 3, B: 2, C: 1, '-': 0 }
export function recordsHTML() {
  const rec = loadRecords()
  const got = TITLES.filter(t => rec.titles[t.id])
  const maps = Object.values(MAPS).map(m => {
    const b = rec.best[m.id]
    return `<li><span class="rc-map">${esc(m.name)}</span><b>${b ? yen(b.score) : 'まだ'}</b>${b ? `<i class="rk" data-r="${b.rank}">${b.rank === '-' ? '×' : b.rank}</i>` : ''}</li>`
  }).join('')
  return {
    count: `${got.length} / ${TITLES.length}`,
    html: `<ul class="rc-maps">${maps}</ul>
      <p class="rc-sum">${rec.plays}回営業・${rec.trips}人を運んだ・通算 ${yen(rec.yen)}</p>
      <ul class="rc-titles">${TITLES.map(t => `<li class="${rec.titles[t.id] ? 'got' : ''}">${MEDAL}<b>${rec.titles[t.id] ? esc(t.name) : '？？？'}</b><small>${esc(t.desc)}</small></li>`).join('')}</ul>`
  }
}
const MEDAL = '<svg class="tmedal" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h4l1 6-3 1zM17 2h-4l-1 6 3 1z" fill="#ff5a4a"/><circle cx="12" cy="15" r="7" fill="#ffcf3a" stroke="#14110c" stroke-width="2"/><path d="m12 11 1.2 2.5 2.7.3-2 1.9.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.9 2.7-.3z" fill="#14110c"/></svg>'

// 地図の小さな絵（ロビーの選択欄）
const thumbCache = {}
export function mapThumb(id) {
  if (thumbCache[id]) return thumbCache[id]
  const m = getMap(id)
  const col = { '#': '#0b0a14', B: m.theme === 'neon' ? '#3a2458' : m.theme === 'minato' ? '#7a4a3a' : '#5a4a5a', '.': '#3a3d48', g: '#2f7a40', w: '#2a6aa8' }
  let out = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" shape-rendering="crispEdges">`
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = m.tiles[y][x]; if (t !== '.') out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col[t]}"/>` }
  for (const l of m.lights) out += `<rect x="${l.x}" y="${l.y}" width="2" height="2" fill="#ff5a4a" opacity=".55"/>`
  out += `<circle cx="${m.start.x}" cy="${m.start.y}" r=".9" fill="#ffcf3a" stroke="#14110c" stroke-width=".3"/>`
  out += '</svg>'
  return (thumbCache[id] = `<div class="thumb-bg">${out}</div>`)
}

// ---- 状態
let ui = null              // いま組み立ててある画面
let sendFn = null
let last = null            // 最新の state.game
const snaps = []           // 補間用 { t, car, obs }
const seenEv = new Set(), seenCall = new Set()
const pressedKeys = new Map() // key -> Set(押している元)
let accelOn = false        // アクセルのスイッチ
let keepalive = null
let lastCallSent = 0
let raf = 0

const inGame = () => document.body.dataset.screen === 'game'
function myKeys(me) { const s = new Set(); for (const r of me) for (const k of KEY_OF[r] || []) s.add(k); return s }
function mapMode(me) { return me.includes('navi') && !me.some(r => DRIVE.includes(r)) && !me.includes('order') }

function setKey(k, on) {
  document.querySelectorAll(`[data-key="${k}"]`).forEach(b => b.classList.toggle('on', on))
  if (sendFn && inGame()) sendFn({ type: 'hold', key: k, on })
}
function press(k, src) {
  let s = pressedKeys.get(k); if (!s) pressedKeys.set(k, (s = new Set()))
  const was = s.size > 0; s.add(src)
  if (!was) setKey(k, true)
}
function release(k, src) {
  const s = pressedKeys.get(k); if (!s) return
  if (src === '*') s.clear(); else s.delete(src)
  if (s.size === 0) { pressedKeys.delete(k); setKey(k, false) }
}
function setAccel(on) {
  accelOn = on
  if (on) press('accel', 'sw'); else release('accel', 'sw')
  document.querySelectorAll('[data-key="accel"]').forEach(b => b.setAttribute('aria-pressed', on ? 'true' : 'false'))
}
function releaseAll() { accelOn = false; for (const k of [...pressedKeys.keys()]) release(k, '*'); document.querySelectorAll('[data-key="accel"]').forEach(b => b.setAttribute('aria-pressed', 'false')) }
function sendCall(what) {
  const t = performance.now()
  if (t - lastCallSent < 450) return // サーバーの連打制限より少し長く空ける
  lastCallSent = t; sendFn && sendFn({ type: 'call', what })
  const b = document.querySelector(`[data-call="${what}"]`); if (b) { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit') }
}
function sendCalm() { if (last?.order && !last.order.waiting && last.order.calm === 0) sendFn({ type: 'calm' }) }

// ---- 画面の組み立て
function build(state) {
  const g = state.game, me = g.me
  if (ui) teardown()
  releaseAll()
  const keys = myKeys(me)
  const root = $('#stage')
  const solo = g.solo
  const map = getMap(g.map)
  const callBtns = solo ? [] : me.flatMap(r => (CALLS_OF[r] || []).map(w => ({ r, w })))
  const steer = ['left', 'right'].filter(k => keys.has(k)), pedal = ['brake', 'accel'].filter(k => keys.has(k))
  const showMini = !mapMode(me) && me.includes('navi')
  root.innerHTML = `
    <div class="play" id="t-wrap" data-mode="3d" data-cam="${mapMode(me) ? 'map' : 'chase'}" data-look="${me.includes('lookout') ? 1 : 0}">
      <canvas id="t-cv"></canvas>
      <div class="labels" id="t-labels"></div>
      <div class="hud-top">
        <div class="chip time" id="t-timechip">${ICON.clock}<b id="t-time">0</b></div>
        <div class="meter score">${ICON.yen}<div class="m-col"><span class="m-row"><b id="t-score">0</b><small id="t-target"></small></span><span class="bar"><i id="t-scorebar"></i></span></div></div>
        <div class="meter dmg" id="t-dmgbox">${ICON.wrench}<div class="m-col"><span class="m-row"><b id="t-dmg">0%</b></span><span class="bar"><i id="t-dmgbar"></i></span></div></div>
        <button id="t-mute" class="icon-btn" aria-label="音のオンオフ" aria-pressed="${snd.isMuted() ? 'true' : 'false'}">${snd.isMuted() ? ICON.mute : ICON.sound}</button>
      </div>
      <div class="hud-sub">
        <div class="face" id="t-face"></div>
        <div class="sub-col">
          <p class="status" id="t-status"></p>
          <p class="sub-row"><span class="phase" id="t-phase"></span><span class="me-roles">${me.map(r => `<i style="--c:${ROLE_COLOR[r]}" title="${ROLE_NAME[r]}">${ICON[r]}</i>`).join('')}<small>${me.length >= 5 ? '全部' : me.map(r => ROLE_NAME[r]).join('・')}</small></span></p>
        </div>
      </div>
      ${showMini ? '<canvas id="t-mini" class="mini" width="200" height="200"></canvas>' : ''}
      <div class="dash"><div class="speedo"><b id="t-kmh">0</b><small>km/h</small></div><div class="lamps" aria-hidden="true">${['left', 'brake', 'accel', 'right'].map(k => `<i id="l-${k}" class="lamp l-${k}">${ICON[k]}</i>`).join('')}</div></div>
      <div class="callbox" id="t-call" hidden></div>
      <div class="pops" id="t-pops"></div>
      <div class="banner" id="t-banner" hidden></div>
      <div class="ready" id="t-ready" hidden></div>
      <div class="dock" data-steer="${steer.length}" data-pedal="${pedal.length}" data-calls="${callBtns.length}" data-order="${me.includes('order') ? 1 : 0}">
        ${me.includes('order') ? `<div class="order" id="t-order"></div>` : ''}
        ${callBtns.length || me.includes('order') ? `<div class="calls n${callBtns.length + (me.includes('order') ? 1 : 0)}">
          ${callBtns.map((c, i) => `<button class="callbtn" style="--c:${ROLE_COLOR[c.r]}" data-call="${c.w}">${ICON[c.w]}<span>${CALL_BTN[c.w]}</span><kbd>${i + 1}</kbd></button>`).join('')}
          ${me.includes('order') ? `<button class="callbtn calm" id="t-calm" style="--c:#ff8ab0">${ICON.calm}<span id="t-calmtxt">なだめる</span><kbd>C</kbd></button>` : ''}
        </div>` : ''}
        ${steer.length ? `<div class="steer">${steer.map(k => `<button class="key k-${k}" data-key="${k}" aria-label="${KEY_TEXT[k]}">${ICON[k]}</button>`).join('')}</div>` : ''}
        ${pedal.length ? `<div class="pedal">${pedal.map(k => `<button class="key k-${k}" data-key="${k}" aria-label="${KEY_TEXT[k]}"${k === 'accel' ? ' aria-pressed="false"' : ''}>${ICON[k]}<span>${k === 'accel' ? 'アクセル' : 'ブレーキ'}</span></button>`).join('')}</div>` : ''}
      </div>
    </div>`

  for (const b of root.querySelectorAll('[data-key]')) {
    const k = b.dataset.key
    b.addEventListener('contextmenu', e => e.preventDefault())
    if (k === 'accel') {
      // アクセルはスイッチ式: 1回で入りっぱなし、もう1回で切れる
      b.addEventListener('pointerdown', e => { e.preventDefault(); setAccel(!accelOn) })
      continue
    }
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); try { b.setPointerCapture(e.pointerId) } catch {}
      if (k === 'brake' && accelOn) setAccel(false) // ブレーキを踏むとアクセルのスイッチが切れる（クルーズコントロールと同じ）
      press(k, e.pointerId)
    })
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, e => release(k, e.pointerId))
  }
  for (const b of root.querySelectorAll('[data-call]')) b.addEventListener('pointerdown', e => { e.preventDefault(); sendCall(b.dataset.call) })
  const calm = $('#t-calm')
  if (calm) calm.addEventListener('pointerdown', e => { e.preventDefault(); sendCalm() })
  $('#t-mute').addEventListener('click', () => {
    snd.unlock(); snd.setMuted(!snd.isMuted())
    $('#t-mute').innerHTML = snd.isMuted() ? ICON.mute : ICON.sound
    $('#t-mute').setAttribute('aria-pressed', snd.isMuted() ? 'true' : 'false')
  })

  const cv = $('#t-cv')
  const look = me.includes('lookout')
  let v3 = null
  if (want3d && V3) {
    try { v3 = V3.createView3D(cv, { map: g.map, mode: mapMode(me) ? 'map' : 'chase', look }) } catch (e) { console.warn('3D を使えないので 2D で描く', e); v3 = null }
  }
  const pending3d = want3d && !V3 && !v3Failed
  ui = {
    key: keyOf(state), map, v3, cv, ctx: v3 ? null : cv.getContext('2d'), pending3d,
    mini: $('#t-mini'), labels: $('#t-labels'), labelPool: [], shake: 0, camA: null, lastCd: -1, lastPh: -1, lastFace: null, kind: null,
    banner: { until: 0 }, callUntil: 0, endShown: false, wasDrive: false
  }
  $('#t-wrap').dataset.mode = v3 ? '3d' : '2d'
  if (pending3d) v3Ready.then(() => { if (ui && ui.pending3d && V3) ui.key = null }) // 読み終わったら次の状態で作り直す
  snaps.length = 0
  snd.startBgm(g.map)
  window.__tx = {
    mode: () => ui && (ui.v3 ? '3d' : '2d'),
    variance: () => ui && ui.v3 ? ui.v3.variance() : null,
    fps: () => ui && ui.v3 ? ui.v3.fps() : 0,
    tier: () => ui && ui.v3 ? ui.v3.tier : -1,
    fx: e => onEvent(e) // 検証用: 出来事の演出だけを流す（サーバーの状態は変えない）
  }
}
function teardown() {
  if (!ui) return
  try { ui.v3 && ui.v3.dispose() } catch {}
  ui = null
}
const keyOf = state => state.round + ':' + state.game.me.join(',') + ':' + (state.game.solo ? 1 : 0) + ':' + state.game.map

// キーボード（PC）: 矢印 / WASD（押している間）/ スペース=ブレーキ / 数字=掛け声 / C=なだめる
const KB = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'accel', KeyW: 'accel', ArrowDown: 'brake', KeyS: 'brake', Space: 'brake' }
addEventListener('keydown', e => {
  if (!inGame() || !last || e.target?.tagName === 'INPUT') return
  const k = KB[e.code]
  if (k && myKeys(last.me).has(k)) {
    e.preventDefault()
    if (!e.repeat) { if (k === 'brake' && accelOn) setAccel(false); press(k, 'kb') }
    return
  }
  if (e.repeat) return
  const n = Number(e.key)
  if (n >= 1 && n <= 9) { const b = document.querySelectorAll('[data-call]')[n - 1]; if (b) sendCall(b.dataset.call) }
  if (e.code === 'KeyC' && last.me.includes('order')) sendCalm()
})
addEventListener('keyup', e => { const k = KB[e.code]; if (k) release(k, 'kb') })
addEventListener('blur', () => { for (const k of [...pressedKeys.keys()]) if (k !== 'accel') release(k, '*'); release('accel', 'kb') })
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll() })

export function render(state, { send }) {
  sendFn = send
  const g = state.game
  if (!ui || ui.key !== keyOf(state) || !$('#t-cv')) build(state)
  last = g
  window.__taxi = g // e2e が自分の画面の状態を読むため（自分の view だけなので他人の秘密は入っていない）
  snaps.push({ t: performance.now(), car: g.car, obs: g.obs })
  if (snaps.length > 5) snaps.shift()
  // 押しっぱなし・スイッチを定期的に伝え直す（届かなくなったらサーバー側で自動的に離す）
  if (!keepalive) keepalive = setInterval(() => {
    if (!inGame()) { releaseAll(); return }
    for (const k of pressedKeys.keys()) sendFn && sendFn({ type: 'hold', key: k, on: true })
  }, 400)
  hud(g)
  for (const e of g.ev) if (!seenEv.has(state.round + ':' + e.id)) { seenEv.add(state.round + ':' + e.id); onEvent(e) }
  for (const c of g.calls) if (!seenCall.has(state.round + ':' + c.id)) { seenCall.add(state.round + ':' + c.id); onCall(c) }
  if (!raf) raf = requestAnimationFrame(frame)
}

function hud(g) {
  $('#t-time').textContent = g.time
  $('#t-timechip').dataset.low = g.time <= 20 && g.st === 'drive' ? '1' : '0'
  $('#t-score').textContent = g.score.toLocaleString('ja-JP')
  $('#t-target').textContent = `/${g.target.toLocaleString('ja-JP')}`
  $('#t-scorebar').style.width = Math.min(100, g.score / g.target * 100) + '%'
  $('#t-scorebar').dataset.done = g.score >= g.target ? '1' : '0'
  $('#t-dmg').textContent = `${g.dmg}%`
  $('#t-dmgbar').style.width = g.dmg + '%'
  $('#t-dmgbox').dataset.lv = g.dmg >= 80 ? 'high' : g.dmg >= 50 ? 'mid' : 'low'
  for (const k of ['left', 'right', 'accel', 'brake']) $('#l-' + k).classList.toggle('on', !!g.inp[k])
  // 他の人が切ったとき（ブレーキでアクセルが離れる等）にスイッチの見た目を合わせる: 自分のスイッチは自分だけが持つので、ここでは触らない
  const fk = g.face + ':' + g.pax
  if (fk !== ui.lastFace) { ui.lastFace = fk; $('#t-face').innerHTML = faceSvg(g.face, g.pax); $('#t-face').dataset.f = g.face }
  let st
  if (g.stage === 'pickup') st = g.nav ? `迎えに行く: ${g.nav.name}` : '迎えに行く。場所はナビに聞く'
  else st = g.nav ? `行き先: ${g.nav.name}${g.nav.via ? `（${g.nav.via.name}経由）` : ''}` : `${PAX_NAME[g.pax] || 'お客さん'}を乗せている。行き先はナビに聞く`
  if (g.near) st = g.near.k === 'pickup' ? '乗り場が近い。輪の中で止まる' : '降ろす場所が近い。輪の中で止まる'
  const se = $('#t-status')
  if (se.textContent !== st) se.textContent = st
  se.dataset.near = g.near ? g.near.k : ''
  const phName = `第${g.ph + 1}幕 ${PHASES[g.ph].name}`
  if ($('#t-phase').textContent !== phName) { $('#t-phase').textContent = phName; $('#t-phase').dataset.ph = g.ph }
  // 接客係のカード
  const o = $('#t-order')
  if (o && g.order) {
    if (g.order.waiting) o.innerHTML = `<p class="o-line">次のお客さんが <b>${esc(g.order.waiting)}</b> で待っている</p>`
    else {
      const od = g.order
      o.innerHTML = `<p class="o-line"><b>${esc(od.name)}</b>「${esc(od.line)}」</p>
        <p class="o-tip">${KIND_TIP[od.kind] || ''}${od.via ? `（${esc(od.via)}: ${od.viaDone ? '通った' : 'まだ'}）` : ''}</p>
        <div class="o-mood"><span class="bar"><i style="width:${od.mood}%" data-lv="${od.mood < 30 ? 'low' : od.mood < 60 ? 'mid' : 'ok'}"></i></span><b>機嫌 ${od.mood}</b><small>${od.late ? '時間オーバー' : `目安あと${od.left}秒`}</small></div>`
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
    if (g.cd !== ui.lastCd) {
      ui.lastCd = g.cd; snd.sfx.count(false)
      r.innerHTML = `<div class="ready-card">
          <p class="rd-map">${esc(ui.map.name)}・第1幕 ${PHASES[0].name}</p>
          <div class="rd-roles">${g.me.map(x => `<span class="rd-role" style="--c:${ROLE_COLOR[x]}">${ICON[x]}<b>${ROLE_NAME[x]}</b></span>`).join('')}</div>
          <ul class="rd-do">${g.me.map(x => `<li>${ROLE_DO[x]}</li>`).join('')}</ul>
          ${g.solo ? '' : `<ul class="rd-crew">${g.roles.map(p => `<li><b>${esc(p.name)}</b>${p.roles.map(x => `<i style="--c:${ROLE_COLOR[x]}">${ICON[x]}</i>`).join('')}</li>`).join('')}</ul>`}
          <div class="rd-cd" data-n="${g.cd}">${g.cd}</div>
        </div>`
    }
  } else if (!r.hidden) {
    r.hidden = true; snd.sfx.count(true); showBanner('出発！', 'お客さんを目的地へ', 'go', 1100)
  }
  if (g.st === 'drive' && !ui.wasDrive) ui.wasDrive = true
  const wrap = $('#t-wrap'); if (wrap.dataset.ph !== String(g.ph)) wrap.dataset.ph = g.ph // 嵐の雨すじ（CSS）
}

function showBanner(big, small, kind, ms = 1600) {
  const b = $('#t-banner'); if (!b) return
  b.hidden = false; b.dataset.kind = kind
  b.innerHTML = `<b>${esc(big)}</b>${small ? `<span>${esc(small)}</span>` : ''}`
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''
  ui.banner.until = performance.now() + ms
}

function pop(html, cls = '') {
  const box = $('#t-pops'); if (!box) return
  const d = document.createElement('div')
  d.className = 'pop ' + cls; d.innerHTML = html
  box.prepend(d)
  while (box.children.length > 3) box.lastChild.remove()
  setTimeout(() => d.remove(), 2600)
}

function onEvent(e) {
  const car = sample()?.car || last.car
  if (ui.v3) try { ui.v3.event(e, car) } catch (err) { console.warn(err) }
  if (e.k === 'deliver') { snd.sfx.deliver(); pop(`${stars(e.stars)}<b>+${yen(e.yen)}</b><small>${esc(e.name)}${e.note ? '・' + esc(e.note) : ''}</small>`, 'good') }
  else if (e.k === 'board') { snd.sfx.board(); pop(`<b>${esc(e.name)}が乗った</b>`, 'info') }
  else if (e.k === 'angry') { snd.sfx.angry(); ui.shake = 0.5; pop(`<b>${esc(e.name)}が怒って降りた</b><small>運賃なし</small>`, 'bad') }
  else if (e.k === 'via') { snd.sfx.board(); pop(`<b>${esc(e.name)}の前を通った</b>`, 'info') }
  else if (e.k === 'calm') { snd.sfx.calm(); pop(`<b>${esc(e.by)}がなだめた</b>`, 'info') }
  else if (e.k === 'leave') pop(`<b>${esc(e.name)}が抜けた</b><small>担当を引き継いだ</small>`, 'info')
  else if (e.k === 'red') { snd.sfx.siren(); pop(`<b>信号無視！</b><small>罰金 ${yen(e.fine)}</small>`, 'bad') }
  else if (e.k === 'phase') {
    snd.sfx.phase(); snd.setTempo(1 + e.ph * 0.12)
    if (e.ph === 2) { snd.sfx.thunder(); snd.setRain(true) }
    showBanner(`第${e.ph + 1}幕 ${PHASES[e.ph].name}`, PHASES[e.ph].lead, 'phase', 2400)
  } else if (e.k === 'end') {
    snd.setEngine(0, false); snd.setRain(false)
    if (e.why === 'wreck') { snd.sfx.wreck(); showBanner('廃車！', 'タクシーが動かなくなった', 'lose', 2600) }
    else if (e.why === 'time') { snd.sfx.timeup(); showBanner('営業終了', last.score >= last.target ? '目標達成！' : 'あと少し…', last.score >= last.target ? 'win' : 'lose', 2600) }
  } else if (e.k === 'crash') {
    const label = { wall: 'ドン！', cone: 'コーンを倒した', cat: '猫が飛び出した！', car: '車とぶつかった', water: 'ドボン！' }[e.what] || 'ドン！'
    if (e.what === 'cat') { snd.sfx.meow(); snd.sfx.crash(e.p) } else if (e.what === 'cone') snd.sfx.cone(); else if (e.what === 'water') snd.sfx.splash(); else if (e.what === 'car') { snd.sfx.crash(e.p); snd.sfx.honk() } else snd.sfx.crash(e.p)
    ui.shake = Math.min(0.6, 0.12 + e.p * 0.08)
    try { navigator.vibrate && navigator.vibrate(40) } catch {}
    pop(`<b>${label}</b>`, 'bad')
  }
}

function onCall(c) {
  snd.sfx.call()
  ui.callUntil = performance.now() + 2200
  const el = $('#t-call')
  el.hidden = false
  el.style.setProperty('--c', ROLE_COLOR[c.r])
  el.innerHTML = `<i>${ICON[c.w]}</i><b>${CALL_TEXT[c.w]}</b><small>${ROLE_NAME[c.r]} ${esc(c.by)}</small>`
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in')
}

// ---- 補間
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
  if (!inGame() || !ui || !ui.cv.isConnected || !last) { snd.setEngine(0, false); return }
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now
  const s = sample(); if (!s) return
  if (ui.callUntil && now > ui.callUntil) { ui.callUntil = 0; $('#t-call').hidden = true }
  if (ui.banner.until && now > ui.banner.until) { ui.banner.until = 0; $('#t-banner').hidden = true }
  ui.shake = Math.max(0, ui.shake - dt)
  const kmh = Math.round(Math.abs(s.car.v) * 12)
  const ke = $('#t-kmh'); if (ke.textContent !== String(kmh)) { ke.textContent = kmh; ke.parentElement.dataset.fast = kmh > 60 ? '1' : '0' }
  snd.setEngine(Math.abs(s.car.v), last.st === 'drive')
  const view = ui.cv.parentElement
  const cw = view.clientWidth, ch = view.clientHeight
  let out = null
  if (ui.v3) {
    ui.v3.setSize(cw, ch)
    if (!(ui.bandAt > now)) { ui.bandAt = now + 400; ui.v3.setBand(bandOf()) }
    out = ui.v3.frame({ car: s.car, obs: s.obs, g: last, dt, now, lt: last.lt })
  } else draw2d(s, cw, ch, dt)
  drawLabels(out)
  if (ui.mini && last.nav) drawMini(s)
}

// 3D のうち HUD と操作ボタンに隠れていない縦の帯（px）
function bandOf() {
  const wrap = $('#t-wrap'); if (!wrap) return { top: 0, bottom: 0, left: 0, right: 0, topMap: 0 }
  const r0 = wrap.getBoundingClientRect()
  const sub = wrap.querySelector('.dash') || wrap.querySelector('.hud-sub')
  const top = sub ? sub.getBoundingClientRect().bottom - r0.top : 0
  const hudTop = wrap.querySelector('.hud-top')
  const topMap = hudTop ? hudTop.getBoundingClientRect().bottom - r0.top : 0
  let bottom = r0.height, left = 0, right = r0.width
  for (const el of wrap.querySelectorAll('.dock > *')) {
    const r = el.getBoundingClientRect()
    if (!r.width) continue
    if (r.left < r0.left + r0.width * 0.62 && r.right > r0.left + r0.width * 0.38) bottom = Math.min(bottom, r.top - r0.top) // 真ん中にかかっている物は下から隠す
    else if (r.right < r0.left + r0.width * 0.5) left = Math.max(left, r.right - r0.left) // 左の列（横持ちの掛け声）
    else right = Math.min(right, r.left - r0.left)
  }
  return { top, bottom: Math.max(top, bottom), left, right: Math.max(left, right), topMap }
}

// 3D の上に重ねる文字（地図の区画名・乗り場の札）
function drawLabels(out) {
  const pool = ui.labelPool
  const items = []
  if (out) {
    for (const l of out.labels) items.push({ cls: 'lbl' + (l.hl ? ' hl' : '') + (l.via ? ' via' : ''), text: l.name, x: l.x, y: l.y })
    for (const m of out.marks) items.push({ cls: 'mark ' + m.k, text: m.k === 'pickup' ? '乗り場' : '降ろす', x: m.x, y: m.y })
  }
  while (pool.length < items.length) { const d = document.createElement('span'); ui.labels.append(d); pool.push(d) }
  pool.forEach((d, i) => {
    const it = items[i]
    if (!it) { if (!d.hidden) d.hidden = true; return }
    d.hidden = false
    if (d.className !== it.cls) d.className = it.cls
    if (d.textContent !== it.text) d.textContent = it.text
    d.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%, -50%)`
  })
}

// ---- 2D（WebGL が使えない端末）
const mapImgs = {}
function mapImage(map) {
  if (mapImgs[map.id]) return mapImgs[map.id]
  const PX = 32
  const c = document.createElement('canvas')
  c.width = W * PX; c.height = H * PX
  const g = c.getContext('2d')
  const T = (x, y) => map.tiles[y]?.[x]
  const bcol = map.theme === 'neon' ? ['#2a2140', '#3a2458'] : map.theme === 'minato' ? ['#5a3428', '#7a4a3a'] : ['#3a3550', '#463f61']
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = T(x, y), X = x * PX, Y = y * PX
    if (t === '#') { g.fillStyle = '#0b0d12'; g.fillRect(X, Y, PX, PX) }
    else if (t === 'B') {
      g.fillStyle = bcol[0]; g.fillRect(X, Y, PX, PX)
      g.fillStyle = bcol[1]; g.fillRect(X + 3, Y + 3, PX - 6, PX - 6)
      for (let i = 0; i < 4; i++) { const on = ((x * 7 + y * 13 + i * 5) % 9) < 4; g.fillStyle = on ? '#ffd56a' : '#2c2840'; g.fillRect(X + 7 + (i % 2) * 12, Y + 7 + Math.floor(i / 2) * 12, 6, 6) }
    } else if (t === 'g') {
      g.fillStyle = '#1f4a2e'; g.fillRect(X, Y, PX, PX)
      if ((x + y) % 2 === 0) { g.fillStyle = '#2d6b40'; g.beginPath(); g.arc(X + 16, Y + 16, 9, 0, Math.PI * 2); g.fill() }
    } else if (t === 'w') { g.fillStyle = '#123a5c'; g.fillRect(X, Y, PX, PX); g.strokeStyle = 'rgba(160,210,255,.4)'; g.beginPath(); g.moveTo(X + 4, Y + 12); g.quadraticCurveTo(X + 16, Y + 6, X + 28, Y + 12); g.stroke() }
    else { g.fillStyle = '#2b2f3a'; g.fillRect(X, Y, PX, PX) }
  }
  g.strokeStyle = '#c9b45a'; g.lineWidth = 2; g.setLineDash([8, 10])
  for (const p of ROAD_PAIRS) for (let i = 1; i < W - 1; i++) {
    if (T(i, p) === '.' && T(i, p + 1) === '.' && !(T(i, p - 1) === '.' && T(i, p + 2) === '.')) { g.beginPath(); g.moveTo(i * PX, (p + 1) * PX); g.lineTo((i + 1) * PX, (p + 1) * PX); g.stroke() }
    if (T(p, i) === '.' && T(p + 1, i) === '.' && !(T(p - 1, i) === '.' && T(p + 2, i) === '.')) { g.beginPath(); g.moveTo((p + 1) * PX, i * PX); g.lineTo((p + 1) * PX, (i + 1) * PX); g.stroke() }
  }
  g.setLineDash([])
  g.strokeStyle = '#8f96a8'; g.lineWidth = 2
  for (const p of map.places) g.strokeRect((p.x - 0.42) * PX, (p.y - 0.42) * PX, 0.84 * PX, 0.84 * PX)
  const labels = []
  const seen = new Set()
  for (const p of map.places) { const k = p.bx + ',' + p.by; if (seen.has(k)) continue; seen.add(k); const [x, y] = blockCenter(p.bx, p.by); labels.push({ name: p.name, x, y }) }
  labels.push({ name: map.park.name, x: map.park.x, y: map.park.y })
  return (mapImgs[map.id] = { img: c, labels })
}
const FONT = '"M PLUS Rounded 1c","Hiragino Sans","Noto Sans JP",system-ui,sans-serif'
const toScreen = (m, x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f })

function draw2d(s, cw, ch, dt) {
  const dpr = Math.min(2, devicePixelRatio || 1)
  const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr))
  const cv = ui.cv, ctx = ui.ctx
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
  const mi = mapImage(ui.map), g = last, car = s.car
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, pw, ph)
  const mapView = mapMode(g.me)
  if (mapView) {
    const pad = 6 * dpr, sc = Math.min((pw - pad * 2) / W, (ph - pad * 2) / H)
    ctx.setTransform(sc, 0, 0, sc, (pw - W * sc) / 2, (ph - H * sc) / 2)
  } else {
    if (ui.camA == null) ui.camA = car.a
    ui.camA = angLerp(ui.camA, car.a, Math.min(1, dt * 5))
    const sc = Math.min(pw, ph * 0.95) / 8.5
    const sx = ui.shake ? (Math.random() - 0.5) * ui.shake * 30 * dpr : 0, sy = ui.shake ? (Math.random() - 0.5) * ui.shake * 30 * dpr : 0
    ctx.translate(pw / 2 + sx, ph * 0.6 + sy)
    ctx.rotate(-ui.camA - Math.PI / 2) // 車の前が画面の上
    ctx.scale(sc, sc)
    ctx.translate(-car.x, -car.y)
  }
  const m = ctx.getTransform()
  ctx.drawImage(mi.img, 0, 0, W, H)
  // 工事の柵と信号
  for (const i of g.cl || []) { const [x0, y0, x1, y1] = ui.map.works[i]; ctx.fillStyle = '#ffb000'; ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1); ctx.fillStyle = '#14110c'; for (let k = 0; k < 4; k++) ctx.fillRect(x0 + k * 0.25 * (x1 - x0 + 1), y0, 0.12 * (x1 - x0 + 1), y1 - y0 + 1) }
  for (const l of ui.map.lights) { const st = lightAt(l, g.lt); const c = { g: '#2fcf7f', y: '#ffc020', r: '#ff3a2a' }; ctx.fillStyle = c[st.x]; ctx.fillRect(l.x - 0.15, l.y + 0.2, 0.12, 1.6); ctx.fillRect(l.x + 2.03, l.y + 0.2, 0.12, 1.6); ctx.fillStyle = c[st.y]; ctx.fillRect(l.x + 0.2, l.y - 0.15, 1.6, 0.12); ctx.fillRect(l.x + 0.2, l.y + 2.03, 1.6, 0.12) }
  const zone = mapView ? g.nav : g.near
  if (zone) drawZone(ctx, zone, performance.now())
  const look = g.me.includes('lookout')
  for (const o of s.obs) drawObstacle(ctx, o, look)
  drawTaxi(ctx, car, g.inp)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (!mapView) {
    // 夜の暗さ（ヘッドライトの届く所だけ明るい）
    const grd = ctx.createRadialGradient(pw / 2, ph * 0.45, ph * 0.15, pw / 2, ph * 0.5, ph * 0.7)
    grd.addColorStop(0, 'rgba(4,6,16,0)'); grd.addColorStop(1, look ? 'rgba(4,10,8,.5)' : 'rgba(4,6,16,.85)')
    ctx.fillStyle = grd; ctx.fillRect(0, 0, pw, ph)
  }
  ctx.font = `800 ${Math.round(12 * dpr)}px ${FONT}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const l of mi.labels) {
    if (!mapView && (Math.abs(l.x - car.x) > 9 || Math.abs(l.y - car.y) > 9)) continue
    const p = toScreen(m, l.x, l.y)
    labelBox(ctx, l.name, p.x, p.y, dpr, g.nav && l.name === g.nav.name ? '#ffcf3a' : null)
  }
}
function labelBox(ctx, text, x, y, dpr, color) {
  const w = ctx.measureText(text).width + 12 * dpr, h = 20 * dpr
  ctx.fillStyle = color || 'rgba(10,12,20,0.78)'
  ctx.fillRect(x - w / 2, y - h / 2, w, h)
  ctx.fillStyle = color ? '#0b0d12' : '#ece6ff'
  ctx.fillText(text, x, y + 1)
}
function drawZone(ctx, z, now) {
  const pulse = 0.85 + 0.15 * Math.sin(now / 160)
  const col = z.k === 'pickup' ? '90,209,255' : '61,220,151'
  ctx.fillStyle = `rgba(${col},0.25)`
  ctx.beginPath(); ctx.arc(z.x, z.y, ZONE_R * pulse, 0, 7); ctx.fill()
  ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 0.1
  ctx.beginPath(); ctx.arc(z.x, z.y, ZONE_R * pulse, 0, 7); ctx.stroke()
}
function drawTaxi(ctx, c, inp) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a)
  const L = 0.8, Wd = 0.5
  ctx.fillStyle = '#ffcf3a'; ctx.fillRect(-L / 2, -Wd / 2, L, Wd)
  ctx.fillStyle = '#1b2230'; ctx.fillRect(-0.14, -0.19, 0.34, 0.38)
  ctx.fillStyle = '#fff7d6'; ctx.fillRect(-0.02, -0.12, 0.12, 0.24)
  ctx.fillStyle = '#fffbe0'; ctx.fillRect(L / 2 - 0.05, -0.2, 0.05, 0.1); ctx.fillRect(L / 2 - 0.05, 0.1, 0.05, 0.1)
  ctx.fillStyle = inp && inp.brake ? '#ff3030' : '#6b1a1a'; ctx.fillRect(-L / 2, -0.2, 0.05, 0.1); ctx.fillRect(-L / 2, 0.1, 0.05, 0.1)
  if (c.s && Math.floor(performance.now() / 250) % 2 === 0) { ctx.fillStyle = '#ff9a1a'; const yy = c.s < 0 ? -Wd / 2 - 0.03 : Wd / 2 - 0.05; ctx.fillRect(L / 2 - 0.14, yy, 0.12, 0.08); ctx.fillRect(-L / 2 + 0.02, yy, 0.12, 0.08) }
  ctx.restore()
}
function drawObstacle(ctx, o, mark) {
  const [, t, x, y, a] = o
  ctx.save(); ctx.translate(x, y); ctx.rotate(a)
  if (t === 'c') { ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(0, 0, 0.13, 0, 7); ctx.stroke() }
  else if (t === 'k') { ctx.fillStyle = '#e9e3d4'; ctx.beginPath(); ctx.ellipse(0, 0, 0.22, 0.13, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(0.22, 0, 0.1, 0, 7); ctx.fill() }
  else { ctx.fillStyle = '#4a7dff'; ctx.fillRect(-0.38, -0.23, 0.76, 0.46); ctx.fillStyle = '#132040'; ctx.fillRect(-0.1, -0.17, 0.28, 0.34) }
  ctx.restore()
  if (mark) { ctx.strokeStyle = 'rgba(255,90,90,0.95)'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(x, y, 0.48, 0, 7); ctx.stroke() }
}
// ナビを兼ねている人の右上の小さな地図（北が上）
function drawMini(s) {
  const c = ui.mini, g = c.getContext('2d')
  const size = c.width, sc = size / W
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, size, size)
  g.setTransform(sc, 0, 0, sc, 0, 0)
  g.drawImage(mapImage(ui.map).img, 0, 0, W, H)
  const n = last.nav, col = n.k === 'pickup' ? '#5ad1ff' : '#3ddc97'
  const r = 0.9 + 0.25 * Math.sin(performance.now() / 200)
  g.strokeStyle = col; g.lineWidth = 0.35; g.beginPath(); g.arc(n.x, n.y, r, 0, 7); g.stroke()
  g.fillStyle = col; g.beginPath(); g.arc(n.x, n.y, 0.4, 0, 7); g.fill()
  if (n.via) { g.fillStyle = '#b07aff'; g.beginPath(); g.arc(n.via.x, n.via.y, 0.45, 0, 7); g.fill() }
  g.fillStyle = '#ffcf3a'; g.strokeStyle = '#14110c'; g.lineWidth = 0.2
  g.save(); g.translate(s.car.x, s.car.y); g.rotate(s.car.a)
  g.beginPath(); g.moveTo(1.1, 0); g.lineTo(-0.7, -0.75); g.lineTo(-0.7, 0.75); g.closePath(); g.fill(); g.stroke()
  g.restore()
}

// ---- 結果画面
let recordedRound = null
export function renderResult(state) {
  releaseAll()
  snd.stopBgm()
  const r = state.result
  const map = getMap(r.map)
  const rk = state.code + ':' + state.round
  // 記録と称号（1回の結果で1度だけ）
  const rec = loadRecords()
  const earned = TITLES.filter(t => { try { return t.test(r) } catch { return false } })
  let newBest = false, newTitles = []
  if (recordedRound !== rk) {
    recordedRound = rk
    const prev = rec.best[map.id]
    if (!prev || r.score > prev.score) { newBest = !!prev || r.score > 0; rec.best[map.id] = { score: r.score, rank: r.rank } }
    newTitles = earned.filter(t => !rec.titles[t.id])
    for (const t of earned) rec.titles[t.id] = (rec.titles[t.id] || 0) + 1
    rec.plays++; rec.trips += r.trips.filter(t => t.yen > 0).length; rec.yen += r.score
    saveRecords(rec)
    renderResult.cache = { newBest, newTitles: newTitles.map(t => t.id) }
    if (r.win) snd.sfx.fanfare(); else if (r.reason === 'wreck') snd.sfx.wreck(); else snd.sfx.sad()
    setTimeout(() => snd.sfx.stamp(), 450)
  } else {
    const c = renderResult.cache || {}
    newBest = !!c.newBest
    newTitles = TITLES.filter(t => (c.newTitles || []).includes(t.id))
  }
  const d = document.createElement('div')
  d.className = 'res'
  d.dataset.win = r.win ? '1' : '0'
  const shown = r.trips.slice(-3)
  const more = r.trips.length - shown.length
  const why = r.reason === 'wreck' ? 'ぶつけすぎて車が動かなくなった' : r.reason === 'empty' ? 'だれもいなくなった' : r.win ? '目標の売上に届いた' : '目標の売上に届かなかった'
  const best = rec.best[map.id]
  // 見せる称号は3つまで: 廃車は必ず先頭、次に初めて取った称号、残りは一覧の順
  const titles = [...earned].sort((a, b) => (b.id === 'wreck') - (a.id === 'wreck') || newTitles.includes(b) - newTitles.includes(a)).slice(0, 3)
  d.innerHTML = `
    ${r.win ? `<div class="confetti">${Array.from({ length: 28 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${['#ffcf3a', '#ff5a4a', '#5ad1ff', '#3ddc97', '#ff8ab0'][i % 5]};animation-delay:${(i % 7) * 0.12}s"></i>`).join('')}</div>` : ''}
    ${r.reason === 'wreck' ? '<div class="smoke"><i></i><i></i><i></i></div>' : ''}
    <div class="res-top">
      <div class="rank" data-r="${r.rank}"><small>ランク</small><b>${r.rank === '-' ? '×' : r.rank}</b></div>
      <div class="res-score"><p class="yen-big" data-to="${r.score}">0円</p><p class="res-reason">${esc(map.name)}・目標 ${yen(r.target)}・${why}</p>
        <p class="res-best" data-new="${newBest ? 1 : 0}">${newBest ? '自己ベスト更新！' : best ? `この街の自己ベスト ${yen(best.score)}` : ''}</p></div>
    </div>
    <div class="res-stats">
      <div><small>運んだ</small><b>${r.trips.filter(t => t.yen > 0).length}人</b></div>
      <div><small>ぶつけた</small><b>${r.crashes}回</b></div>
      <div><small>最高速度</small><b>${r.stats.maxKmh}km</b></div>
      <div><small>ダメージ</small><b>${r.dmg}%</b></div>
    </div>
    ${titles.length ? `<p class="res-head">今回の称号</p><ul class="res-titles">${titles.map(t => `<li class="${newTitles.includes(t) ? 'new' : ''}">${MEDAL}<b>${esc(t.name)}</b>${newTitles.includes(t) ? '<em>NEW</em>' : ''}</li>`).join('')}</ul>` : ''}
    <ul class="trips">${shown.map(t => `<li class="${t.yen ? '' : 'angry'}"><span class="t-name">${esc(t.name)}<small>${esc(t.dest)}へ</small></span>${t.yen ? stars(t.stars) : `<em>${esc(t.note || '運賃なし')}</em>`}<b>${t.yen ? yen(t.yen) : '0円'}</b></li>`).join('') || '<li class="muted">だれも運べなかった</li>'}</ul>
    ${more > 0 ? `<p class="muted center">ほか ${more}件</p>` : ''}
    <p class="crew">${r.crew.map(c => `<span><b>${esc(c.name)}</b>${c.roles.map(x => `<i style="--c:${ROLE_COLOR[x]}">${ICON[x]}</i>`).join('')}</span>`).join('')}</p>`
  // 金額を数え上げる
  const el = d.querySelector('.yen-big'), to = r.score, t0 = performance.now()
  const step = () => { const f = Math.min(1, (performance.now() - t0) / 900); el.textContent = yen(Math.round(to * (1 - (1 - f) ** 3))); if (f < 1 && el.isConnected) requestAnimationFrame(step) }
  requestAnimationFrame(step)
  setTimeout(() => { if (!el.isConnected || el.textContent !== yen(to)) el.textContent = yen(to) }, 1200)
  return d
}
