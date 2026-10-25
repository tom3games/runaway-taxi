// 暴走タクシー: みんなで1台のタクシーを動かして、お客さんを目的地へ運ぶ。
// 操作は担当ごとに分かれている（ハンドル / エンジン / ナビ / 見張り / 接客）。
// 状態はここだけが持つ。物理は固定 1/60 秒のステップで進め、画面へは tickHz 回/秒で送る。
//
// rooms.mjs との約束: meta / createGame → tick, input, view, isOver, result, removePlayer

import { W, H, TILES, tileAt, isSolid, PLACES, START } from '../public/map.js'

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

export const PAX_TYPES = [
  { kind: 'hurry', name: '受験生', line: '{d}まで！試験に遅れそうなんです' },
  { kind: 'gentle', name: 'おばあちゃん', line: '{d}までお願いね。スピードは怖いのよ' },
  { kind: 'queasy', name: '酔っぱらい', line: '{d}まで…うっぷ…急に曲がらないで' },
  { kind: 'tour', name: '観光客', line: '{d}まで。途中で{v}の前を通ってほしい' },
  { kind: 'vip', name: '社長', line: '{d}だ。ぶつけたら払わんぞ' }
]

// 障害物。コーン（止まっている）、猫（道を横切る）、対向車（決まった道を回る）
export const CONES = [[9.5, 1.5], [14.5, 6.5], [21.5, 9.5], [1.5, 14.5], [9.5, 16.5], [19.5, 21.5], [7.5, 19.5], [17.5, 12.5], [12.5, 2.5], [2.5, 8.5]]
const CATS = [ // 道を横切る: 中心 (x,y)、動く向き axis。幅2マスの道を端から端へ
  { x: 7, y: 16.5, axis: 'x', phase: 0 },
  { x: 17.5, y: 2, axis: 'y', phase: 1.3 },
  { x: 22, y: 5.5, axis: 'x', phase: 2.1 },
  { x: 9.5, y: 22, axis: 'y', phase: 0.7 },
  { x: 17, y: 19.5, axis: 'x', phase: 3.0 }
]
const LOOPS = [ // 対向車の周回路（四角の角）
  { pts: [[1.5, 1.5], [22.5, 1.5], [22.5, 22.5], [1.5, 22.5]], v: 2.4, off: 0 },
  { pts: [[16.5, 16.5], [6.5, 16.5], [6.5, 6.5], [16.5, 6.5]], v: 2.0, off: 10 }
]

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const r2 = n => Math.round(n * 100) / 100

// 道路の上の距離（マス）。BFS で求める
const distCache = new Map()
export function roadDist(a, b) {
  const sx = Math.floor(a.x), sy = Math.floor(a.y)
  const key = `${sx},${sy}`
  let d = distCache.get(key)
  if (!d) {
    d = new Int16Array(W * H).fill(-1)
    const q = [[sx, sy]]
    d[sy * W + sx] = 0
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || isSolid(TILES[ny][nx]) || d[ny * W + nx] >= 0) continue
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
  let over = false, endReason = ''
  let score = 0, dmg = 0, crashes = 0
  let evId = 0, callId = 0
  const events = [], calls = []
  const trips = []
  let calmReady = 0

  const car = { x: START.x, y: START.y, a: START.a, vx: 0, vy: 0, spin: 0, steer: 0, stopT: 0, yaw: 0, crashCd: 0, inp: null }
  const cones = CONES.map(([x, y], i) => ({ id: 'c' + i, t: 'c', x, y, r: 0.22, off: 0 }))
  const cats = CATS.map((c, i) => ({ id: 'k' + i, t: 'k', ...c, r: 0.25, off: 0, cx: c.x, cy: c.y }))
  const npcs = LOOPS.map((l, i) => ({ id: 'n' + i, t: 'n', loop: l, s: l.off, x: 0, y: 0, a: 0, r: 0.38, pause: 0, cd: 0 }))
  for (const n of npcs) placeNpc(n)

  // 仕事（stage: 'ride' お客さんを乗せている / 'pickup' 迎えに行く）
  let job = null
  newRide(null, { x: car.x, y: car.y }) // 最初のお客さんは乗った状態で始まる

  const playing = () => clock >= READY_SEC
  const timeLeft = () => Math.max(0, timeLimit - Math.max(0, clock - READY_SEC))

  function randPlace(exclude, minDist, from) {
    const cands = PLACES.filter(p => p !== exclude && roadDist(from, p) >= minDist)
    const list = cands.length ? cands : PLACES.filter(p => p !== exclude)
    return list[Math.floor(rng() * list.length)]
  }

  function newRide(from, origin) {
    const type = PAX_TYPES[Math.floor(rng() * PAX_TYPES.length)]
    const dest = randPlace(from, 9, origin)
    const via = type.kind === 'tour' ? randPlace(dest, 4, origin) : null
    const dist = roadDist(origin, dest)
    const par = Math.round(dist / 3 + 4) * (type.kind === 'hurry' ? 0.85 : 1)
    job = { stage: 'ride', type, dest, via, viaDone: false, mood: 75, par, rideT: 0, stopT: 0, crashes: 0 }
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

  function crash(power, kind) {
    crashes++
    if (job.stage === 'ride') job.crashes++
    const kindP = job.type?.kind
    const mult = kindP === 'vip' ? 2.5 : kindP === 'queasy' ? 2 : 1
    hurtMood(power * 4 * mult)
    dmg = Math.min(DMG_MAX, dmg + power * 3)
    pushEvent({ k: 'crash', what: kind, p: r2(power) })
    if (dmg >= DMG_MAX) { over = true; endReason = 'wreck' }
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

  function moveObstacles(dt) {
    for (const c of cones) if (c.off && clock > c.off) c.off = 0
    for (const k of cats) {
      if (k.off && clock > k.off) k.off = 0
      // 5.2秒周期: 端で待つ → 1.3秒で横切る → 反対の端で待つ → 戻る
      const T = 5.2, t = ((clock + k.phase * 1.7) % T + T) % T
      let f
      if (t < 1.3) f = 0; else if (t < 2.6) f = (t - 1.3) / 1.3; else if (t < 3.9) f = 1; else f = 1 - (t - 3.9) / 1.3
      const span = 0.9
      if (k.axis === 'x') { k.x = k.cx - span + 2 * span * f; k.y = k.cy } else { k.x = k.cx; k.y = k.cy - span + 2 * span * f }
      k.a = k.axis === 'x' ? 0 : Math.PI / 2
    }
    for (const n of npcs) {
      // 前にタクシーがいたら待つ（止まっているタクシーに突っ込まない）
      const dx = car.x - n.x, dy = car.y - n.y, d = Math.hypot(dx, dy)
      const ahead = d < 1.6 && (dx * Math.cos(n.a) + dy * Math.sin(n.a)) > 0.2
      if (n.pause > 0) n.pause -= dt
      else if (!ahead) { n.s += n.loop.v * dt; placeNpc(n) }
    }
  }

  function collideTiles() {
    const r = CAR.r
    let maxImpact = 0
    for (let ty = Math.floor(car.y - r); ty <= Math.floor(car.y + r); ty++) {
      for (let tx = Math.floor(car.x - r); tx <= Math.floor(car.x + r); tx++) {
        if (!isSolid(tileAt(tx + 0.5, ty + 0.5))) continue
        const cx = clamp(car.x, tx, tx + 1), cy = clamp(car.y, ty, ty + 1)
        let dx = car.x - cx, dy = car.y - cy
        let d = Math.hypot(dx, dy)
        if (d >= r) continue
        if (d < 1e-6) { dx = -car.vx; dy = -car.vy; d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; d = 0 } else { dx /= d; dy /= d }
        car.x += dx * (r - d); car.y += dy * (r - d)
        const vn = car.vx * dx + car.vy * dy
        if (vn < 0) {
          maxImpact = Math.max(maxImpact, -vn)
          car.vx -= (1 + CAR.restitution) * vn * dx; car.vy -= (1 + CAR.restitution) * vn * dy
          car.vx *= 0.85; car.vy *= 0.85
        }
      }
    }
    return maxImpact
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
      k.off = clock + 10 // 逃げていく
      car.vx *= 0.2; car.vy *= 0.2
      car.spin += (rng() < 0.5 ? -1 : 1) * 3
      crash(2.5, 'cat')
    }
    for (const n of npcs) {
      if (n.cd > clock || !hit(n)) continue
      n.cd = clock + 1.5; n.pause = 1.5
      const dx = car.x - n.x, dy = car.y - n.y, d = Math.hypot(dx, dy) || 1
      const sp = Math.hypot(car.vx, car.vy)
      car.vx = dx / d * (1 + sp * 0.4); car.vy = dy / d * (1 + sp * 0.4)
      if (sp < 1.2) continue // ゆっくり触れただけなら押し返すだけ
      car.spin += (rng() < 0.5 ? -1 : 1) * 4
      crash(1.5 + sp * 0.5, 'car')
    }
  }

  function physics(dt) {
    const inp = { left: pressed('left'), right: pressed('right'), accel: pressed('accel'), brake: pressed('brake') }
    car.inp = inp
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
    car.steer = steer
    const ca = Math.cos(car.a), sa = Math.sin(car.a)
    let vf = car.vx * ca + car.vy * sa
    let vl = -car.vx * sa + car.vy * ca
    const grass = tileAt(car.x, car.y) === 'g'
    if (inp.brake) {
      if (vf > 0.15) { vf = Math.max(0, vf - CAR.brake * dt); car.stopT = 0 }
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
    // 速いほどタイヤが滑り、曲がりにくい（＝スピードを落とさないと曲がりきれない）
    const grip = grass ? 3 : 12 - 9.5 * clamp(sp / CAR.max, 0, 1)
    vl *= Math.exp(-grip * dt)
    const yaw = steer * CAR.turn * clamp(vf / 1.2, -1, 1) / (1 + 0.6 * (sp / 4) ** 2)
    car.yaw = yaw
    car.spin *= Math.exp(-3 * dt)
    car.a += (yaw + car.spin) * dt
    car.a = Math.atan2(Math.sin(car.a), Math.cos(car.a))
    // 速度は向きを変える前の軸で組み直す（向きだけ先に回り、速度が遅れてついてくる＝滑る）
    car.vx = vf * ca - vl * sa; car.vy = vf * sa + vl * ca
    car.x += car.vx * dt; car.y += car.vy * dt
    const imp = collideTiles()
    if (imp > 1.6 && clock > car.crashCd) { car.crashCd = clock + 0.4; crash(imp - 1.2, 'wall') }
    collideObstacles()
    if (over) return

    // お客さんの気分
    if (job.stage === 'ride') {
      job.rideT += dt
      const kind = job.type.kind
      let drop = 0
      if (job.rideT > job.par) drop += kind === 'hurry' ? 4 : 1.5
      if (grass && sp > 0.5) drop += 4
      if (kind === 'gentle' && sp > 3.5) drop += 10
      if (kind === 'queasy' && Math.abs(yaw) * sp > 5) drop += 12
      hurtMood(drop * dt)
      if (job.via && !job.viaDone && Math.hypot(car.x - job.via.x, car.y - job.via.y) < 1.8) {
        job.viaDone = true; pushEvent({ k: 'via', name: job.via.name })
      }
      if (job.mood <= 0) {
        trips.push({ name: job.type.name, dest: job.dest.name, stars: 0, yen: 0, note: '怒って降りた' })
        pushEvent({ k: 'angry', name: job.type.name })
        startPickup()
        return
      }
    }
    // 乗り降り: 範囲の中で止まる
    const target = job.stage === 'ride' ? job.dest : job.at
    const inZone = Math.hypot(car.x - target.x, car.y - target.y) < ZONE_R && Math.hypot(car.vx, car.vy) < STOP_V
    job.stopT = inZone ? job.stopT + dt : 0
    if (job.stopT >= STOP_HOLD) {
      if (job.stage === 'pickup') { newRide(job.at, job.at); pushEvent({ k: 'board', name: job.type.name }) }
      else deliver()
    }
  }

  function deliver() {
    const m = job.mood
    const stars = m >= 80 ? 5 : m >= 60 ? 4 : m >= 40 ? 3 : m >= 20 ? 2 : 1
    const fare = 400 + Math.round(job.par) * 40
    let tip = [0, 0, 100, 250, 500][stars - 1]
    if (job.type.kind === 'vip') tip *= 2
    let bonus = 0
    const notes = []
    if (job.type.kind === 'hurry' && job.rideT <= job.par) { bonus += 300; notes.push('間に合った') }
    if (job.type.kind === 'tour' && job.viaDone) { bonus += 400; notes.push('寄り道できた') }
    if (job.type.kind === 'tour' && !job.viaDone) notes.push(`${job.via.name}を通らなかった`)
    if (job.crashes === 0) notes.push('無事故')
    const yen = fare + tip + bonus
    score += yen
    trips.push({ name: job.type.name, dest: job.dest.name, stars, yen, note: notes.join('・') })
    pushEvent({ k: 'deliver', name: job.type.name, stars, yen, note: notes.join('・') })
    startPickup()
  }

  function visibleObstacles(id) {
    const my = roles[id] || []
    const look = my.includes('lookout')
    const drive = my.some(r => r !== 'navi' && r !== 'lookout')
    if (!look && !drive) return []
    const out = []
    for (const o of [...cones, ...cats, ...npcs]) {
      if (o.off) continue
      const dx = o.x - car.x, dy = o.y - car.y, d = Math.hypot(dx, dy)
      let see = look && d < 8
      if (!see && drive) {
        // 夜なのでヘッドライトの届く範囲だけ見える。対向車は自分のライトで少し遠くから見える
        const ang = Math.atan2(dy, dx) - car.a
        const off = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)))
        see = d < 1.8 || (d < 4.2 && off < 0.55) || (o.t === 'n' && d < 3.2)
      }
      if (see) out.push([o.id, o.t, r2(o.x), r2(o.y), r2(o.a || 0)])
    }
    return out
  }

  return {
    tick(dt) {
      if (over) return
      dt = Math.min(Math.max(0, dt || 0), 0.25)
      acc += dt
      while (acc >= STEP && !over) {
        acc -= STEP
        clock += STEP
        if (!playing()) continue
        moveObstacles(STEP)
        physics(STEP)
        if (!over && timeLeft() <= 0) { over = true; endReason = 'time' }
      }
      while (calls.length && clock - calls[0].at > 3) calls.shift()
    },

    input(id, data) {
      if (over) return { error: 'over' }
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
        st: playing() ? 'drive' : 'ready',
        cd: playing() ? 0 : Math.ceil(READY_SEC - clock - 1e-9),
        time: Math.ceil(timeLeft() - 1e-9),
        limit: timeLimit,
        score, target: TARGET, dmg: Math.round(dmg),
        car: { x: r2(car.x), y: r2(car.y), a: r2(car.a), v: r2(Math.hypot(car.vx, car.vy)), s: car.steer },
        inp: car.inp || { left: false, right: false, accel: false, brake: false },
        me: my,
        solo,
        roles: Object.entries(roles).map(([pid, rs]) => ({ id: pid, name: names[pid], roles: rs })),
        stage: job.stage,
        face: ride ? Math.min(4, Math.floor(job.mood / 20)) : -1,
        obs: visibleObstacles(id),
        calls: calls.filter(c => clock - c.at < 2.5).map(c => ({ id: c.id, by: c.by, r: c.r, w: c.w })),
        ev: events.filter(e => clock - e.at < 3.5).map(({ at, ...rest }) => rest)
      }
      // 着く直前は全員に乗り場が見える（止まる合図のため）
      if (Math.hypot(car.x - target.x, car.y - target.y) < 3.5) v.near = { x: target.x, y: target.y, k: job.stage }
      // ナビだけが行き先の場所を知っている
      if (my.includes('navi')) v.nav = { x: target.x, y: target.y, k: job.stage, name: target.name }
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

    isOver: () => over,

    result() {
      const win = endReason === 'time' && score >= TARGET
      const rank = endReason === 'wreck' || endReason === 'empty' ? '-' : score >= 6000 ? 'S' : score >= 4500 ? 'A' : score >= TARGET ? 'B' : 'C'
      const title = endReason === 'wreck' ? '廃車' : endReason === 'empty' ? '全員降りた' : win ? '営業成功' : '売上不足'
      return {
        win, title, reason: endReason, score, target: TARGET, rank,
        trips, crashes, dmg: Math.round(dmg),
        crew: Object.entries(roles).map(([pid, rs]) => ({ name: names[pid], roles: rs }))
      }
    },

    removePlayer(id) {
      const mine = roles[id]
      if (!mine) return
      delete roles[id]; delete held[id]
      const rest = Object.keys(roles)
      if (!rest.length) { over = true; endReason = 'empty'; return }
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
      car, roles, cones, cats, npcs, trips,
      get job() { return job },
      get score() { return score }, get dmg() { return dmg }, get clock() { return clock },
      setMood: m => { job.mood = m },
      startPickup
    }
  }
}
