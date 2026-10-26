// 暴走タクシー: みんなで1台のタクシーを動かして、お客さんを目的地へ運ぶ。
// 操作は担当ごとに分かれている（ハンドル / エンジン / ナビ / 見張り / 接客）。
// 状態はここだけが持つ。物理は固定 1/60 秒のステップで進め、画面へは tickHz 回/秒で送る。
// 1回の営業は3幕。幕が進むと車が増え、工事で道がふさがり、最後は雨で滑る（運賃は1.3倍）。
//
// rooms.mjs との約束: meta / createGame → tick, input, view, isOver, result, removePlayer

import { W, H, getMap, tileOf, isSolid, lightAt, inLight, inRect, PHASES, MAPS, DEFAULT_MAP } from '../public/map.js'

export const meta = {
  id: 'runaway-taxi',
  title: '暴走タクシー',
  minPlayers: 1,
  maxPlayers: 6,
  tickHz: 15 // 送信は15回/秒。画面側で補間する
}

export const TIME_LIMIT = 150
export const TARGET = 3000
export const READY_SEC = 3
export const LINGER = 2.2 // 終わってから結果画面までの余韻（秒）
const STEP = 1 / 60

// 車の性質（単位: マス, 秒）
export const CAR = {
  r: 0.32, max: 7, acc: 5, brake: 11, revAcc: 3, revMax: 2.2, drag: 0.3, roll: 0.8,
  turn: 3.2, grassMax: 3, restitution: 0.25
}
const HOLD_TTL = 1.5        // 押しっぱなしの合図がこの秒数途切れたら離したとみなす（切断対策）
const CALL_GAP = 0.4        // 掛け声の連打間隔
export const CALM_CD = 8    // なだめるの待ち時間
const ZONE_R = 1.4          // 乗り降りの範囲
const STOP_V = 1.0          // これ以下の速さで止まれば乗り降りできる
const STOP_HOLD = 0.4
const DMG_MAX = 100
export const RED_FINE = 150   // 信号無視の罰金
export const NIGHT_RATE = 1.3 // 第3幕の深夜料金

export const ROLE_KEYS = {
  wheel: ['left', 'right'], wheelL: ['left'], wheelR: ['right'],
  engine: ['accel', 'brake'], navi: [], lookout: [], order: []
}
export const CALLS = {
  navi: ['left', 'right', 'straight', 'uturn', 'here'],
  lookout: ['danger', 'stop', 'clear'],
  order: ['slow', 'hurry']
}
const KEYS = ['left', 'right', 'accel', 'brake']
const ALL = ['wheel', 'engine', 'navi', 'lookout', 'order']

// 人数ごとの役の割り振り（少ないときは1人が複数を持つ。6人ではハンドルを左右に分ける）
export const PLAN = {
  1: [ALL],
  2: [['wheel', 'lookout'], ['engine', 'navi', 'order']],
  3: [['wheel'], ['engine', 'order'], ['navi', 'lookout']],
  4: [['wheel'], ['engine'], ['navi'], ['lookout', 'order']],
  5: [['wheel'], ['engine'], ['navi'], ['lookout'], ['order']],
  6: [['wheelL'], ['wheelR'], ['engine'], ['navi'], ['lookout'], ['order']]
}

// お客さん。ph の幕から乗ってくる（あとの幕ほど種類が増える）
export const PAX_TYPES = [
  { kind: 'hurry', name: '受験生', ph: 0, line: '{d}まで！試験に遅れそうなんです' },
  { kind: 'gentle', name: 'おばあちゃん', ph: 0, line: '{d}までお願いね。スピードは怖いのよ' },
  { kind: 'tour', name: '観光客', ph: 0, line: '{d}まで。途中で{v}の前を通ってほしい' },
  { kind: 'kid', name: 'ちびっこ', ph: 0, line: '{d}まで！もっと飛ばして！' },
  { kind: 'queasy', name: '酔っぱらい', ph: 1, line: '{d}まで…うっぷ…急に曲がらないで' },
  { kind: 'vip', name: '社長', ph: 1, line: '{d}だ。ぶつけたら払わんぞ' },
  { kind: 'mama', name: '妊婦さん', ph: 1, line: '{d}まで。急いで、でも揺らさないで' },
  { kind: 'ghost', name: '幽霊', ph: 2, line: '…{d}まで…（足が無い）' }
]

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const r2 = n => Math.round(n * 100) / 100

// 道路の上の距離（マス）。BFS で求める（工事は数えない）
const distCache = new Map()
export function roadDist(a, b, map = MAPS[DEFAULT_MAP]) {
  const sx = Math.floor(a.x), sy = Math.floor(a.y)
  const key = `${map.id}:${sx},${sy}`
  let d = distCache.get(key)
  if (!d) {
    d = new Int16Array(W * H).fill(-1)
    const q = [[sx, sy]]
    d[sy * W + sx] = 0
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || isSolid(map.tiles[ny][nx]) || d[ny * W + nx] >= 0) continue
        d[ny * W + nx] = d[y * W + x] + 1
        q.push([nx, ny])
      }
    }
    distCache.set(key, d)
  }
  return d[Math.floor(b.y) * W + Math.floor(b.x)]
}

export function assignRoles(players, rng = Math.random) {
  const order = players.map(p => p.id)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[order[i], order[j]] = [order[j], order[i]] }
  const plan = PLAN[Math.min(order.length, 6)] || PLAN[1]
  const roles = {}
  order.forEach((id, i) => { roles[id] = plan[i] ? [...plan[i]] : [] })
  return roles
}

export function createGame(players, opts = {}) {
  // opts はブラウザの start メッセージからそのまま届くので信用しない。乱数は関数のときだけ使う（テスト用）
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random
  const map = getMap(opts.map) // 知らない名前なら下町
  // 制限時間は環境変数でだけ短くできる（e2e 用）
  const envLimit = Number(process.env.TAXI_TIME_LIMIT)
  const timeLimit = envLimit > 0 && envLimit <= 600 ? envLimit : TIME_LIMIT
  const names = Object.fromEntries(players.map(p => [p.id, p.name]))
  const roles = assignRoles(players, rng)
  const held = Object.fromEntries(players.map(p => [p.id, {}])) // key -> 最後に「押している」と届いた時刻
  const lastCall = {}
  const solo = players.length === 1

  let clock = 0          // 経過時間（準備中も含む）
  let acc = 0
  let ended = false, endAt = 0, endReason = ''
  let score = 0, dmg = 0, crashes = 0
  let evId = 0, callId = 0
  let phase = 0
  const events = [], calls = []
  const trips = []
  let calmReady = 0
  // 称号のための記録
  const stats = { wall: 0, water: 0, cone: 0, cat: 0, car: 0, red: 0, five: 0, angry: 0, maxV: 0, late: 0, ghost: 0, kid: 0, calls: 0, calm: 0, grass: 0 }

  const S0 = map.start
  const car = { x: S0.x, y: S0.y, a: S0.a, vx: 0, vy: 0, spin: 0, steer: 0, stopT: 0, yaw: 0, crashCd: 0, inp: null }
  const cones = map.cones.map(([x, y], i) => ({ id: 'c' + i, t: 'c', x, y, r: 0.22, off: 0 }))
  const cats = map.cats.map((c, i) => ({ id: 'k' + i, t: 'k', ...c, r: 0.25, off: 0, cx: c.x, cy: c.y }))
  const npcs = map.loops.map((l, i) => ({ id: 'n' + i, t: 'n', loop: l, s: l.off, x: 0, y: 0, a: 0, r: 0.38, pause: 0, cd: 0, on: l.from === 0 }))
  for (const n of npcs) placeNpc(n)
  const works = map.works.map(([x0, y0, x1, y1, from], i) => ({ i, r: [x0, y0, x1, y1], from, on: false }))
  const redCd = map.lights.map(() => 0)

  // 仕事（stage: 'ride' お客さんを乗せている / 'pickup' 迎えに行く）
  let job = null
  newRide(null, { x: car.x, y: car.y }) // 最初のお客さんは乗った状態で始まる

  const playing = () => clock >= READY_SEC
  const elapsed = () => Math.max(0, clock - READY_SEC)
  const timeLeft = () => Math.max(0, timeLimit - elapsed())
  // 終わってから LINGER 秒は画面で余韻を見せる（全員抜けたときはすぐ終わる）
  const isOver = () => ended && (endReason === 'empty' || clock - endAt >= LINGER)

  function randPlace(exclude, minDist, from) {
    const cands = map.places.filter(p => p !== exclude && roadDist(from, p, map) >= minDist)
    const list = cands.length ? cands : map.places.filter(p => p !== exclude)
    return list[Math.floor(rng() * list.length)]
  }

  function newRide(from, origin) {
    const pool = PAX_TYPES.filter(t => t.ph <= phase)
    if (phase >= 2) pool.push(PAX_TYPES.find(t => t.kind === 'ghost')) // 深夜は幽霊が乗りやすい
    const type = pool[Math.floor(rng() * pool.length)]
    const dest = randPlace(from, 9, origin)
    const via = type.kind === 'tour' ? randPlace(dest, 4, origin) : null
    const dist = roadDist(origin, dest, map)
    const par = Math.round(dist / 3 + 4) * (type.kind === 'hurry' ? 0.85 : type.kind === 'mama' ? 0.9 : 1)
    job = { stage: 'ride', type, dest, via, viaDone: false, mood: 75, par, rideT: 0, stopT: 0, crashes: 0, ph: phase }
  }

  function startPickup() {
    const at = randPlace(job?.dest, 6, { x: car.x, y: car.y })
    job = { stage: 'pickup', at, stopT: 0 }
  }

  function pushEvent(e) { events.push({ id: ++evId, at: clock, ...e }); if (events.length > 10) events.shift() }

  function owns(id, key) { return (roles[id] || []).some(r => ROLE_KEYS[r].includes(key)) }
  function pressed(key) {
    for (const id in held) if (owns(id, key) && held[id][key] != null && clock - held[id][key] <= HOLD_TTL) return true
    return false
  }

  function hurtMood(v) {
    if (job.stage !== 'ride') return
    job.mood = clamp(job.mood - v, 0, 100)
  }

  function end(reason) {
    if (ended) return
    ended = true; endAt = clock; endReason = reason
    pushEvent({ k: 'end', why: reason })
  }

  function crash(power, kind) {
    crashes++
    stats[kind] = (stats[kind] || 0) + 1
    if (job.stage === 'ride') job.crashes++
    const kindP = job.type?.kind
    const mult = kindP === 'vip' ? 2.5 : kindP === 'mama' ? 3 : kindP === 'queasy' ? 2 : 1
    hurtMood(power * 4 * mult)
    dmg = Math.min(DMG_MAX, dmg + power * 3)
    pushEvent({ k: 'crash', what: kind, p: r2(power) })
    if (dmg >= DMG_MAX) end('wreck')
  }

  // 建物・水・工事の柵はぶつかる
  function solidAt(tx, ty) {
    if (isSolid(tileOf(map, tx + 0.5, ty + 0.5))) return true
    for (const w of works) if (w.on && inRect(w.r, tx, ty)) return true
    return false
  }

  function placeNpc(n) {
    const pts = n.loop.pts
    const lens = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]))
    const total = lens.reduce((a, b) => a + b, 0)
    let s = ((n.s % total) + total) % total
    for (let i = 0; i < pts.length; i++) {
      if (s <= lens[i]) {
        const a = pts[i], b = pts[(i + 1) % pts.length], f = s / lens[i]
        n.x = a[0] + (b[0] - a[0]) * f; n.y = a[1] + (b[1] - a[1]) * f
        n.a = Math.atan2(b[1] - a[1], b[0] - a[0])
        return
      }
      s -= lens[i]
    }
  }

  // 幕が変わる: 車が増える・工事が始まる・雨が降る
  function updatePhase() {
    const L = timeLimit, t = elapsed()
    const ph = t >= L * 2 / 3 ? 2 : t >= L / 3 ? 1 : 0
    if (ph === phase) return
    phase = ph
    for (const n of npcs) if (!n.on && n.loop.from <= phase) n.on = true
    pushEvent({ k: 'phase', ph, works: works.filter(w => w.from === ph).length })
  }

  function updateWorks() {
    for (const w of works) {
      if (w.on || w.from > phase) continue
      // 車が柵の場所にいるときは、出るまで待ってから置く（閉じ込めない）
      const [x0, y0, x1, y1] = w.r
      const m = CAR.r + 0.2
      if (car.x > x0 - m && car.x < x1 + 1 + m && car.y > y0 - m && car.y < y1 + 1 + m) continue
      w.on = true
    }
  }

  const catPeriod = () => phase >= 2 ? 3.6 : 5.2 // 深夜は猫がすばしこい

  function moveObstacles(dt) {
    const t = elapsed()
    for (const c of cones) if (c.off && clock > c.off) c.off = 0
    for (const k of cats) {
      if (k.off && clock > k.off) k.off = 0
      // 端で待つ → 横切る → 反対の端で待つ → 戻る
      const T = catPeriod(), q = T / 4, u = ((clock + k.phase * 1.7) % T + T) % T
      let f
      if (u < q) f = 0; else if (u < 2 * q) f = (u - q) / q; else if (u < 3 * q) f = 1; else f = 1 - (u - 3 * q) / q
      const span = 0.9
      if (k.axis === 'x') { k.x = k.cx - span + 2 * span * f; k.y = k.cy } else { k.x = k.cx; k.y = k.cy - span + 2 * span * f }
      k.a = k.axis === 'x' ? 0 : Math.PI / 2
    }
    for (const n of npcs) {
      if (!n.on) continue
      // 前にタクシーがいたら待つ（止まっているタクシーに突っ込まない）
      const dx = car.x - n.x, dy = car.y - n.y, d = Math.hypot(dx, dy)
      const ahead = d < 1.6 && (dx * Math.cos(n.a) + dy * Math.sin(n.a)) > 0.2
      // 赤信号の手前で止まる（交差点に入る直前だけ見る）
      let red = false
      const nx = n.x + Math.cos(n.a) * 0.7, ny = n.y + Math.sin(n.a) * 0.7
      for (const l of map.lights) {
        if (inLight(l, nx, ny) && !inLight(l, n.x, n.y) && lightAt(l, t)[Math.abs(Math.cos(n.a)) > 0.5 ? 'x' : 'y'] !== 'g') red = true
      }
      if (n.pause > 0) n.pause -= dt
      else if (!ahead && !red) { n.s += n.loop.v * (phase >= 1 ? 1.15 : 1) * dt; placeNpc(n) }
    }
  }

  function collideTiles() {
    const r = CAR.r
    let imp = 0, water = false
    for (let ty = Math.floor(car.y - r); ty <= Math.floor(car.y + r); ty++) {
      for (let tx = Math.floor(car.x - r); tx <= Math.floor(car.x + r); tx++) {
        if (!solidAt(tx, ty)) continue
        const cx = clamp(car.x, tx, tx + 1), cy = clamp(car.y, ty, ty + 1)
        let dx = car.x - cx, dy = car.y - cy
        let d = Math.hypot(dx, dy)
        if (d >= r) continue
        if (d < 1e-6) { dx = -car.vx; dy = -car.vy; d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; d = 0 } else { dx /= d; dy /= d }
        car.x += dx * (r - d); car.y += dy * (r - d)
        const vn = car.vx * dx + car.vy * dy
        if (vn < 0) {
          if (-vn > imp) { imp = -vn; water = tileOf(map, tx + 0.5, ty + 0.5) === 'w' }
          car.vx -= (1 + CAR.restitution) * vn * dx; car.vy -= (1 + CAR.restitution) * vn * dy
          car.vx *= 0.85; car.vy *= 0.85
        }
      }
    }
    return { imp, water }
  }

  function collideObstacles() {
    const hit = o => Math.hypot(o.x - car.x, o.y - car.y) < o.r + CAR.r
    for (const c of cones) {
      if (c.off || !hit(c)) continue
      c.off = clock + 15
      car.vx *= 0.75; car.vy *= 0.75
      crash(0.8, 'cone')
    }
    for (const k of cats) {
      if (k.off || !hit(k)) continue
      k.off = clock + 10 // 跳びのいて逃げていく
      car.vx *= 0.2; car.vy *= 0.2
      car.spin += (rng() < 0.5 ? -1 : 1) * 3
      crash(2.5, 'cat')
    }
    for (const n of npcs) {
      if (!n.on || n.cd > clock || !hit(n)) continue
      n.cd = clock + 1.5; n.pause = 1.5
      const dx = car.x - n.x, dy = car.y - n.y, d = Math.hypot(dx, dy) || 1
      const sp = Math.hypot(car.vx, car.vy)
      car.vx = dx / d * (1 + sp * 0.4); car.vy = dy / d * (1 + sp * 0.4)
      if (sp < 1.2) continue // ゆっくり触れただけなら押し返すだけ
      car.spin += (rng() < 0.5 ? -1 : 1) * 4
      crash(1.5 + sp * 0.5, 'car')
    }
  }

  // 信号無視: 赤のときに交差点へ入った
  function checkLights(px, py) {
    const t = elapsed()
    const sp = Math.hypot(car.vx, car.vy)
    map.lights.forEach((l, i) => {
      if (!inLight(l, car.x, car.y) || inLight(l, px, py) || sp < 1.2 || clock < redCd[i]) return
      const axis = Math.abs(car.vx) >= Math.abs(car.vy) ? 'x' : 'y'
      if (lightAt(l, t)[axis] !== 'r') return
      redCd[i] = clock + 3
      stats.red++
      score = Math.max(0, score - RED_FINE)
      hurtMood(8)
      pushEvent({ k: 'red', fine: RED_FINE })
    })
  }

  function physics(dt) {
    const inp = { left: pressed('left'), right: pressed('right'), accel: pressed('accel'), brake: pressed('brake') }
    car.inp = inp
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
    car.steer = steer
    const ca = Math.cos(car.a), sa = Math.sin(car.a)
    let vf = car.vx * ca + car.vy * sa
    let vl = -car.vx * sa + car.vy * ca
    const grass = tileOf(map, car.x, car.y) === 'g'
    const rain = phase >= 2
    if (inp.brake) {
      if (vf > 0.15) { vf = Math.max(0, vf - CAR.brake * (rain ? 0.75 : 1) * dt); car.stopT = 0 }
      else { car.stopT += dt; if (car.stopT > 0.6) vf = Math.max(-CAR.revMax, vf - CAR.revAcc * dt) } // 止まってからも押し続けるとバック
    } else {
      car.stopT = 0
      if (inp.accel) vf += (vf < 0 ? CAR.brake : CAR.acc) * dt
      else vf -= Math.sign(vf) * Math.min(Math.abs(vf), CAR.roll * dt)
    }
    vf -= vf * (grass ? 1.5 : CAR.drag) * dt
    vf = clamp(vf, -CAR.revMax, CAR.max)
    if (grass && vf > CAR.grassMax) vf -= (vf - CAR.grassMax) * 3 * dt
    const sp = Math.abs(vf)
    // 速いほどタイヤが滑り、曲がりにくい（＝スピードを落とさないと曲がりきれない）。雨だとさらに滑る
    const grip = (grass ? 3 : 12 - 9.5 * clamp(sp / CAR.max, 0, 1)) * (rain ? 0.45 : 1)
    vl *= Math.exp(-grip * dt)
    const yaw = steer * CAR.turn * clamp(vf / 1.2, -1, 1) / (1 + 0.6 * (sp / 4) ** 2)
    car.yaw = yaw
    car.spin *= Math.exp(-3 * dt)
    car.a += (yaw + car.spin) * dt
    car.a = Math.atan2(Math.sin(car.a), Math.cos(car.a))
    // 速度は向きを変える前の軸で組み直す（向きだけ先に回り、速度が遅れてついてくる＝滑る）
    car.vx = vf * ca - vl * sa; car.vy = vf * sa + vl * ca
    const px = car.x, py = car.y
    car.x += car.vx * dt; car.y += car.vy * dt
    const { imp, water } = collideTiles()
    if (imp > 1.6 && clock > car.crashCd) { car.crashCd = clock + 0.4; crash(imp - 1.2, water ? 'water' : 'wall') }
    collideObstacles()
    if (ended) return
    checkLights(px, py)
    const v = Math.hypot(car.vx, car.vy)
    if (v > stats.maxV) stats.maxV = v
    if (grass && v > 1) stats.grass += dt

    // お客さんの気分
    if (job.stage === 'ride') {
      job.rideT += dt
      const kind = job.type.kind
      let drop = 0
      if (job.rideT > job.par) drop += kind === 'hurry' || kind === 'mama' ? 4 : 1.5
      if (grass && sp > 0.5) drop += 4
      if (kind === 'gentle' && sp > 3.5) drop += 10
      if (kind === 'queasy' && Math.abs(yaw) * sp > 5) drop += 12
      if (kind === 'mama' && Math.abs(yaw) * sp > 6) drop += 8
      if (kind === 'kid') drop += sp > 5 ? -4 : sp < 1.5 && job.rideT > 3 ? 3 : 0 // 速いと喜ぶ、遅いと退屈する
      if (kind === 'ghost') drop += 1 // じわじわ冷えていく
      hurtMood(drop * dt)
      if (job.via && !job.viaDone && Math.hypot(car.x - job.via.x, car.y - job.via.y) < 1.8) {
        job.viaDone = true; pushEvent({ k: 'via', name: job.via.name })
      }
      if (job.mood <= 0) {
        trips.push({ name: job.type.name, kind, dest: job.dest.name, stars: 0, yen: 0, note: '怒って降りた' })
        stats.angry++
        pushEvent({ k: 'angry', name: job.type.name, kind })
        startPickup()
        return
      }
    }
    // 乗り降り: 範囲の中で止まる
    const target = job.stage === 'ride' ? job.dest : job.at
    const inZone = Math.hypot(car.x - target.x, car.y - target.y) < ZONE_R && Math.hypot(car.vx, car.vy) < STOP_V
    job.stopT = inZone ? job.stopT + dt : 0
    if (job.stopT >= STOP_HOLD) {
      if (job.stage === 'pickup') { newRide(job.at, job.at); pushEvent({ k: 'board', name: job.type.name, kind: job.type.kind }) }
      else deliver()
    }
  }

  function deliver() {
    const m = job.mood, kind = job.type.kind
    const stars = m >= 80 ? 5 : m >= 60 ? 4 : m >= 40 ? 3 : m >= 20 ? 2 : 1
    let fare = 400 + Math.round(job.par) * 40
    if (kind === 'ghost') fare *= 2
    let tip = [0, 0, 100, 250, 500][stars - 1]
    if (kind === 'vip') tip *= 2
    let bonus = 0
    const notes = []
    const onTime = job.rideT <= job.par
    if (kind === 'hurry' && onTime) { bonus += 300; notes.push('間に合った') }
    if (kind === 'mama' && onTime && job.crashes === 0) { bonus += 500; notes.push('無事に間に合った') }
    if (kind === 'tour' && job.viaDone) { bonus += 400; notes.push('寄り道できた') }
    if (kind === 'tour' && !job.viaDone) notes.push(`${job.via.name}を通らなかった`)
    if (kind === 'ghost') { notes.push('振り向いたら消えていた'); stats.ghost++ }
    if (kind === 'kid' && stars >= 4) stats.kid++
    if (!onTime && (kind === 'hurry' || kind === 'mama')) stats.late++
    if (job.crashes === 0) notes.push('無事故')
    let yen = fare + tip + bonus
    if (phase >= 2) { yen = Math.round(yen * NIGHT_RATE / 10) * 10; notes.push('深夜料金') }
    if (stars === 5) stats.five++
    score += yen
    trips.push({ name: job.type.name, kind, dest: job.dest.name, stars, yen, note: notes.join('・') })
    pushEvent({ k: 'deliver', name: job.type.name, kind, stars, yen, note: notes.join('・') })
    startPickup()
  }

  function visibleObstacles(id) {
    const my = roles[id] || []
    const look = my.includes('lookout')
    const drive = my.some(r => r !== 'navi' && r !== 'lookout')
    if (!look && !drive) return []
    const out = []
    const beam = phase >= 2 ? 3.6 : 4.2 // 雨の夜はライトが届きにくい
    for (const o of [...cones, ...cats, ...npcs]) {
      if (o.off || o.on === false) continue
      const dx = o.x - car.x, dy = o.y - car.y, d = Math.hypot(dx, dy)
      let see = look && d < 8
      if (!see && drive) {
        // 夜なのでヘッドライトの届く範囲だけ見える。対向車は自分のライトで少し遠くから見える
        const ang = Math.atan2(dy, dx) - car.a
        const off = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)))
        see = d < 1.8 || (d < beam && off < 0.55) || (o.t === 'n' && d < 3.2)
      }
      if (see) out.push([o.id, o.t, r2(o.x), r2(o.y), r2(o.a || 0)])
    }
    return out
  }

  return {
    tick(dt) {
      if (isOver()) return
      dt = Math.min(Math.max(0, dt || 0), 0.25)
      acc += dt
      while (acc >= STEP) {
        acc -= STEP
        clock += STEP
        if (!playing() || ended) continue
        updatePhase()
        updateWorks()
        moveObstacles(STEP)
        physics(STEP)
        if (!ended && timeLeft() <= 0) end('time')
      }
      while (calls.length && clock - calls[0].at > 3) calls.shift()
    },

    input(id, data) {
      if (ended) return { error: 'over' }
      if (!(id in roles)) return { error: 'not_player' }
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return { error: 'bad_input' }
      if (data.type === 'hold') {
        if (!KEYS.includes(data.key) || typeof data.on !== 'boolean') return { error: 'bad_input' }
        if (!owns(id, data.key)) return { error: 'not_your_role' }
        if (data.on) held[id][data.key] = clock; else delete held[id][data.key]
        return { ok: true }
      }
      if (data.type === 'call') {
        const role = roles[id].find(r => CALLS[r] && CALLS[r].includes(data.what))
        if (!role) return { error: 'not_your_role' }
        if (lastCall[id] != null && clock - lastCall[id] < CALL_GAP) return { error: 'too_fast' }
        lastCall[id] = clock
        stats.calls++
        calls.push({ id: ++callId, at: clock, by: names[id], r: role, w: data.what })
        if (calls.length > 6) calls.shift()
        return { ok: true }
      }
      if (data.type === 'calm') {
        if (!roles[id].includes('order')) return { error: 'not_your_role' }
        if (job.stage !== 'ride') return { error: 'no_passenger' }
        if (clock < calmReady) return { error: 'cooldown' }
        calmReady = clock + CALM_CD
        job.mood = clamp(job.mood + 15, 0, 100)
        stats.calm++
        pushEvent({ k: 'calm', by: names[id] })
        return { ok: true }
      }
      return { error: 'bad_input' }
    },

    view(id) {
      const my = roles[id] || []
      const ride = job.stage === 'ride'
      const target = ride ? job.dest : job.at
      const v = {
        map: map.id,
        st: ended ? 'end' : playing() ? 'drive' : 'ready',
        cd: playing() ? 0 : Math.ceil(READY_SEC - clock - 1e-9),
        time: Math.ceil(timeLeft() - 1e-9),
        limit: timeLimit,
        lt: r2(elapsed()), // 信号の色を画面で計算するための時刻
        ph: phase,
        cl: works.filter(w => w.on).map(w => w.i),
        score, target: TARGET, dmg: Math.round(dmg),
        car: { x: r2(car.x), y: r2(car.y), a: r2(car.a), v: r2(Math.hypot(car.vx, car.vy)), s: car.steer },
        inp: car.inp || { left: false, right: false, accel: false, brake: false },
        me: my,
        solo,
        roles: Object.entries(roles).map(([pid, rs]) => ({ id: pid, name: names[pid], roles: rs })),
        stage: job.stage,
        face: ride ? Math.min(4, Math.floor(job.mood / 20)) : -1,
        // 乗っているお客さんの見た目（全員に見える）。注文の中身と行き先は接客とナビだけ
        pax: ride ? job.type.kind : null,
        obs: visibleObstacles(id),
        calls: calls.filter(c => clock - c.at < 2.5).map(c => ({ id: c.id, by: c.by, r: c.r, w: c.w })),
        ev: events.filter(e => clock - e.at < 3.5).map(({ at, ...rest }) => rest)
      }
      if (ended) v.end = endReason
      // 着く直前は全員に乗り場が見える（止まる合図のため）
      if (Math.hypot(car.x - target.x, car.y - target.y) < 3.5) v.near = { x: target.x, y: target.y, k: job.stage }
      // ナビだけが行き先の場所を知っている
      if (my.includes('navi')) {
        v.nav = { x: target.x, y: target.y, k: job.stage, name: target.name }
        if (ride && job.via && !job.viaDone) v.nav.via = { x: job.via.x, y: job.via.y, name: job.via.name }
      }
      // 接客係だけがお客さんの注文を知っている
      if (my.includes('order')) {
        v.order = ride
          ? {
            name: job.type.name, kind: job.type.kind,
            line: job.type.line.replace('{d}', job.dest.name).replace('{v}', job.via ? job.via.name : ''),
            dest: job.dest.name, via: job.via ? job.via.name : null, viaDone: job.viaDone,
            mood: Math.round(job.mood), late: job.rideT > job.par, left: Math.max(0, Math.ceil(job.par - job.rideT)),
            calm: Math.max(0, Math.ceil(calmReady - clock))
          }
          : { waiting: job.at.name }
      }
      return v
    },

    isOver,

    result() {
      const win = endReason === 'time' && score >= TARGET
      const rank = endReason === 'wreck' || endReason === 'empty' ? '-' : score >= 6000 ? 'S' : score >= 4500 ? 'A' : score >= TARGET ? 'B' : 'C'
      const title = endReason === 'wreck' ? '廃車' : endReason === 'empty' ? '全員降りた' : win ? '営業成功' : '売上不足'
      return {
        win, title, reason: endReason, score, target: TARGET, rank, map: map.id, phase,
        trips, crashes, dmg: Math.round(dmg),
        stats: { ...stats, maxV: undefined, maxKmh: Math.round(stats.maxV * 12), grass: Math.round(stats.grass) },
        crew: Object.entries(roles).map(([pid, rs]) => ({ name: names[pid], roles: rs }))
      }
    },

    removePlayer(id) {
      const mine = roles[id]
      if (!mine) return
      delete roles[id]; delete held[id]
      const rest = Object.keys(roles)
      if (!rest.length) { end('empty'); return }
      // 抜けた人の役を、役が一番少ない人に渡す
      for (const r of mine) {
        rest.sort((a, b) => roles[a].length - roles[b].length)
        roles[rest[0]].push(r)
      }
      // 左右ハンドルが1人に集まったら普通のハンドルにまとめる
      for (const pid of rest) {
        const rs = roles[pid]
        if (rs.includes('wheelL') && rs.includes('wheelR')) roles[pid] = ['wheel', ...rs.filter(r => r !== 'wheelL' && r !== 'wheelR')]
      }
      pushEvent({ k: 'leave', name: names[id] })
    },

    // テスト用の裏口（rooms.mjs からは使わない）
    _debug: {
      car, roles, cones, cats, npcs, trips, works, map, stats,
      get job() { return job },
      get score() { return score }, get dmg() { return dmg }, get clock() { return clock }, get phase() { return phase },
      setMood: m => { job.mood = m },
      startPickup
    }
  }
}

// 以前の書き方との互換（下町のコーン）
export const CONES = MAPS[DEFAULT_MAP].cones
export { PHASES }
