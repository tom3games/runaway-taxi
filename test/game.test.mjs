// 暴走タクシーのルールの単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, assignRoles, PLAN, ROLE_KEYS, READY_SEC, TIME_LIMIT, TARGET, CONES, CALM_CD, roadDist, meta } from '../lib/game.mjs'
import { TILES, PLACES, isSolid, tileAt, START } from '../public/map.js'

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length] }
const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
function game(n = 1, opts = {}) {
  const g = createGame(players(n), { rng: seq(0.1, 0.5, 0.9, 0.3, 0.7), ...opts })
  return g
}
const run = (g, sec) => { for (let t = 0; t < sec; t += 1 / 15) g.tick(1 / 15) }
// 押しっぱなし: 0.4秒ごとに押し直しながら進める（画面と同じ）
function drive(g, id, keys, sec) {
  for (let t = 0; t < sec; t += 0.2) { for (const k of keys) g.input(id, { type: 'hold', key: k, on: true }); run(g, 0.2) }
  for (const k of keys) g.input(id, { type: 'hold', key: k, on: false })
}
const owner = (g, key) => Object.entries(g._debug.roles).find(([, rs]) => rs.some(r => ROLE_KEYS[r].includes(key)))[0]
const speed = c => Math.hypot(c.vx, c.vy)

test('地図: 乗り降りの場所とコーンは道路の上で、全部の場所に道でつながっている', () => {
  for (const p of PLACES) {
    assert.equal(tileAt(p.x, p.y), '.', p.name)
    assert.ok(roadDist(START, p) > 0, p.name + ' に行ける')
  }
  for (const [x, y] of CONES) assert.equal(tileAt(x, y), '.', `cone ${x},${y}`)
  assert.equal(tileAt(START.x, START.y), '.')
  assert.ok(TILES.every(r => r.length === TILES.length))
})

test('役の割り振り: 1〜6人の全員に役があり、4つの操作キーがどれも誰かの手にある', () => {
  for (let n = meta.minPlayers; n <= meta.maxPlayers; n++) {
    const roles = assignRoles(players(n), seq(0.4, 0.2, 0.8))
    assert.equal(Object.keys(roles).length, n)
    for (const id in roles) assert.ok(roles[id].length >= 1, `${n}人: ${id} に役がある`)
    const keys = new Set(Object.values(roles).flat().flatMap(r => ROLE_KEYS[r]))
    for (const k of ['left', 'right', 'accel', 'brake']) assert.ok(keys.has(k), `${n}人: ${k}`)
    const all = Object.values(roles).flat()
    for (const r of ['navi', 'lookout', 'order']) assert.ok(all.includes(r), `${n}人: ${r}`)
    assert.equal(all.length, new Set(all).size, '役が重複しない')
  }
  const six = Object.values(assignRoles(players(6))).flat()
  assert.ok(six.includes('wheelL') && six.includes('wheelR') && !six.includes('wheel'), '6人ではハンドルを左右に分ける')
  assert.deepEqual(PLAN[1][0].length, 5, '1人なら全部を持つ')
})

test('開始前の3秒は車が動かない。そのあとアクセルで前に進み、ブレーキで止まる', () => {
  const g = game(1)
  const c = g._debug.car
  drive(g, 'p0', ['accel'], READY_SEC - 0.5)
  assert.equal(c.x, START.x)
  assert.equal(g.view('p0').st, 'ready')
  run(g, 0.6)
  drive(g, 'p0', ['accel'], 1.5)
  assert.equal(g.view('p0').st, 'drive')
  assert.ok(c.x > START.x + 1, '東向きに進む')
  assert.ok(speed(c) > 5)
  drive(g, 'p0', ['brake'], 0.3)
  assert.ok(speed(c) < 2.5, 'ブレーキで減速')
  drive(g, 'p0', ['brake'], 0.5)
  assert.ok(Math.abs(c.vx) < 0.4, '止まる')
  const x = c.x
  drive(g, 'p0', ['brake'], 1.5)
  assert.ok(c.x < x - 0.3, '止まってからブレーキを押し続けるとバック')
})

test('押しっぱなしの合図が途切れると（切断など）、1.5秒後に自動で離したことになる', () => {
  const g = game(1)
  run(g, READY_SEC + 0.1)
  g.input('p0', { type: 'hold', key: 'accel', on: true })
  run(g, 1.0)
  const v1 = speed(g._debug.car)
  assert.ok(v1 > 3)
  run(g, 2.0)
  assert.equal(g.view('p0').inp.accel, false)
  assert.ok(speed(g._debug.car) < v1 + 0.5)
})

test('速すぎると曲がりきれない: 同じだけハンドルを切っても、速いほうが大回りになる', () => {
  const turnRadius = v0 => {
    const g = game(1)
    run(g, READY_SEC + 0.1)
    const c = g._debug.car
    // 広い場所で測る（壁に当たらないよう、地図の判定を避けて上の大通りの外の値は使わない）
    c.x = 2; c.y = 11.5; c.a = 0; c.vx = v0; c.vy = 0
    const keyHolds = () => { g.input('p0', { type: 'hold', key: 'right', on: true }); g.input('p0', { type: 'hold', key: 'accel', on: true }) }
    let a0 = c.a, moved = 0, px = c.x, py = c.y
    for (let t = 0; t < 0.5; t += 1 / 15) { keyHolds(); g.tick(1 / 15); moved += Math.hypot(c.x - px, c.y - py); px = c.x; py = c.y }
    return moved / Math.max(1e-6, Math.abs(c.a - a0)) // 進んだ距離 / 曲がった角度 ≒ 回転半径
  }
  const slow = turnRadius(2.5), fast = turnRadius(7)
  assert.ok(fast > slow * 2, `slow=${slow.toFixed(2)} fast=${fast.toFixed(2)}`)
})

test('建物にぶつかると通り抜けず、ダメージとお客さんの機嫌が減る', () => {
  const g = game(1)
  run(g, READY_SEC + 0.1)
  const c = g._debug.car
  // 北向きに建物（x=4, y=8..10 は建物）へ全速で突っ込む
  c.x = 4.5; c.y = 12; c.a = -Math.PI / 2
  const mood0 = g._debug.job.mood
  drive(g, 'p0', ['accel'], 2)
  assert.ok(!isSolid(tileAt(c.x, c.y)), '建物の中に入らない')
  assert.ok(c.y > 10.5, '建物の手前で止まる')
  assert.ok(g._debug.dmg > 0, 'ダメージ')
  assert.ok(g._debug.job.mood < mood0, '機嫌が減る')
  assert.ok(g.view('p0').ev.some(e => e.k === 'crash'), 'ぶつかった合図が出る')
})

test('目的地の輪の中で止まると降ろせて、星と売上が付く。次は迎えに行き、乗り場で止まると乗る', () => {
  const g = game(1)
  run(g, READY_SEC + 0.1)
  const d = g._debug, c = d.car
  const dest = d.job.dest
  c.x = dest.x; c.y = dest.y; c.vx = 0; c.vy = 0
  run(g, 0.6)
  assert.equal(d.trips.length, 1)
  assert.ok(d.trips[0].stars >= 1 && d.trips[0].yen > 400)
  assert.equal(g.view('p0').score, d.trips[0].yen)
  assert.equal(d.job.stage, 'pickup')
  assert.ok(g.view('p0').ev.some(e => e.k === 'deliver'))
  const at = d.job.at
  c.x = at.x; c.y = at.y
  run(g, 0.6)
  assert.equal(d.job.stage, 'ride')
  assert.ok(g.view('p0').ev.some(e => e.k === 'board'))
})

test('輪の中でも速いまま通り過ぎたら降ろせない', () => {
  const g = game(1)
  run(g, READY_SEC + 0.1)
  const d = g._debug, c = d.car
  c.x = d.job.dest.x; c.y = d.job.dest.y; c.vx = 0; c.vy = 0
  for (let i = 0; i < 6; i++) { c.vx = 3; c.x = d.job.dest.x; g.tick(1 / 15) }
  assert.equal(d.trips.length, 0)
})

test('機嫌が0になるとお客さんは怒って降り、運賃は入らない', () => {
  const g = game(1)
  run(g, READY_SEC + 0.1)
  g._debug.setMood(0.5)
  run(g, g._debug.job.par + 1) // 目安の時間を過ぎると機嫌が下がり始める
  assert.equal(g._debug.trips[0].yen, 0)
  assert.equal(g._debug.job.stage, 'pickup')
  assert.equal(g.view('p0').score, 0)
})

test('時間切れで終わる。目標に届けば勝ち、届かなければ負け', () => {
  const lose = game(2)
  run(lose, READY_SEC + TIME_LIMIT + 0.2)
  assert.equal(lose.isOver(), true)
  assert.equal(lose.result().win, false)
  assert.equal(lose.result().title, '売上不足')

  process.env.TAXI_TIME_LIMIT = '20'
  const win = game(3)
  delete process.env.TAXI_TIME_LIMIT
  assert.equal(win.view('p0').limit, 20)
  run(win, READY_SEC + 0.1)
  const d = win._debug
  while (d.score < TARGET) { // 届けては迎えに行くのを繰り返す
    const t = d.job.stage === 'ride' ? d.job.dest : d.job.at
    d.car.x = t.x; d.car.y = t.y; d.car.vx = d.car.vy = 0
    run(win, 0.6)
  }
  run(win, 25)
  assert.equal(win.isOver(), true)
  const r = win.result()
  assert.equal(r.win, true)
  assert.equal(r.title, '営業成功')
  assert.ok(r.score >= TARGET && r.trips.length >= 3)
  assert.equal(r.crew.length, 3)
})

test('ぶつけすぎると廃車で即終了（負け）', () => {
  const g = game(1)
  run(g, READY_SEC + 0.1)
  const c = g._debug.car
  for (let i = 0; i < 40 && !g.isOver(); i++) {
    c.x = 4.5; c.y = 11.6; c.a = -Math.PI / 2; c.vx = 0; c.vy = -7
    run(g, 0.5)
  }
  assert.equal(g.isOver(), true)
  assert.equal(g.result().reason, 'wreck')
  assert.equal(g.result().win, false)
  assert.equal(g.result().title, '廃車')
})

test('担当でない操作は弾かれ、状態は変わらない', () => {
  const g = game(5)
  run(g, READY_SEC + 0.1)
  const accel = owner(g, 'accel'), wheel = owner(g, 'left')
  assert.notEqual(accel, wheel)
  const before = JSON.stringify(g.view(wheel))
  assert.equal(g.input(wheel, { type: 'hold', key: 'accel', on: true }).error, 'not_your_role')
  assert.equal(g.input(accel, { type: 'hold', key: 'left', on: true }).error, 'not_your_role')
  assert.equal(g.input(accel, { type: 'hold', key: 'accel', on: 'yes' }).error, 'bad_input')
  assert.equal(g.input(accel, { type: 'hold', key: '__proto__', on: true }).error, 'bad_input')
  assert.equal(g.input(accel, 'accel').error, 'bad_input')
  assert.equal(g.input(accel, { type: 'teleport', x: 1 }).error, 'bad_input')
  assert.equal(g.input('stranger', { type: 'hold', key: 'accel', on: true }).error, 'not_player')
  assert.equal(g.input(wheel, { type: 'call', what: 'danger' }).error, 'not_your_role')
  assert.equal(g.input(wheel, { type: 'calm' }).error, 'not_your_role')
  assert.equal(JSON.stringify(g.view(wheel)), before)
  run(g, 1)
  assert.equal(g._debug.car.x, START.x, 'ハンドル担当がアクセルを送っても進まない')
})

test('掛け声: 担当の掛け声だけ送れて、全員に見える。連打は弾く', () => {
  const g = game(5)
  run(g, READY_SEC + 0.1)
  const navi = Object.entries(g._debug.roles).find(([, r]) => r.includes('navi'))[0]
  const look = Object.entries(g._debug.roles).find(([, r]) => r.includes('lookout'))[0]
  assert.equal(g.input(navi, { type: 'call', what: 'right' }).ok, true)
  assert.equal(g.input(navi, { type: 'call', what: 'left' }).error, 'too_fast')
  assert.equal(g.input(navi, { type: 'call', what: 'danger' }).error, 'not_your_role')
  assert.equal(g.input(look, { type: 'call', what: 'stop' }).ok, true)
  for (const p of players(5)) {
    const calls = g.view(p.id).calls
    assert.deepEqual(calls.map(c => c.w), ['right', 'stop'])
  }
  run(g, 3)
  assert.equal(g.view(navi).calls.length, 0, '時間がたつと消える')
})

test('秘密: 行き先はナビだけ、注文は接客だけ、遠くの障害物は見張りだけに届く', () => {
  const g = game(5)
  run(g, READY_SEC + 0.1)
  const roles = g._debug.roles
  const who = r => Object.entries(roles).find(([, rs]) => rs.includes(r))[0]
  const navi = who('navi'), order = who('order'), look = who('lookout'), wheel = who('wheel'), engine = who('engine')
  const dest = g._debug.job.dest.name
  for (const id of Object.keys(roles)) {
    const v = g.view(id), json = JSON.stringify(v)
    assert.equal('nav' in v, id === navi, 'nav は ナビだけ')
    assert.equal('order' in v, id === order, 'order は接客だけ')
    if (id !== navi && id !== order) assert.ok(!json.includes(dest), `${roles[id]} の画面に行き先の名前が無い`)
    if (id !== order) assert.ok(!json.includes(g._debug.job.type.name), `${roles[id]} の画面にお客さんの種類が無い`)
  }
  assert.equal(g.view(navi).nav.name, dest)
  assert.ok(g.view(order).order.line.includes(dest))
  // 見張りの方が遠くまで見える
  const c = g._debug.car
  const far = g._debug.cones.find(o => o.x === 21.5 && o.y === 9.5)
  c.x = 17.5; c.y = 9.5; c.a = Math.PI // 西向き。背後 4マスにコーン(21.5,9.5)
  const ids = id => g.view(id).obs.map(o => o[0])
  assert.ok(ids(look).includes(far.id), '見張りには後ろのコーンも見える')
  assert.ok(!ids(wheel).includes(far.id), 'ハンドルには後ろのコーンは見えない')
  assert.ok(!ids(engine).includes(far.id))
  assert.equal(g.view(navi).obs.length, 0, 'ナビには障害物が来ない')
})

test('接客がなだめると機嫌が上がり、8秒は使えない', () => {
  const g = game(5)
  run(g, READY_SEC + 0.1)
  const order = Object.entries(g._debug.roles).find(([, r]) => r.includes('order'))[0]
  g._debug.setMood(30)
  assert.equal(g.input(order, { type: 'calm' }).ok, true)
  assert.ok(g._debug.job.mood >= 44)
  assert.equal(g.input(order, { type: 'calm' }).error, 'cooldown')
  assert.ok(g.view(order).order.calm > 0)
  run(g, CALM_CD + 0.2)
  assert.equal(g.input(order, { type: 'calm' }).ok, true)
})

test('途中で抜けた人の役は残った人に渡り、全員抜けたら終わる', () => {
  const g = game(6)
  run(g, READY_SEC + 0.1)
  const roles = g._debug.roles
  const wl = Object.entries(roles).find(([, r]) => r.includes('wheelL'))[0]
  const wr = Object.entries(roles).find(([, r]) => r.includes('wheelR'))[0]
  g.removePlayer(wl)
  assert.ok(!(wl in roles))
  const all = Object.values(roles).flat()
  const keys = new Set(all.flatMap(r => ROLE_KEYS[r]))
  for (const k of ['left', 'right', 'accel', 'brake']) assert.ok(keys.has(k), k + ' が残っている')
  assert.equal(g.input(wl, { type: 'hold', key: 'left', on: true }).error, 'not_player')
  assert.ok(roles[wr].includes('wheelR') || roles[wr].includes('wheel'), '右ハンドルの人は残っている')
  for (const id of Object.keys(roles)) g.removePlayer(id)
  assert.equal(g.isOver(), true)
  assert.equal(g.result().reason, 'empty')
  assert.equal(g.result().win, false)
})

test('1人でも全部の役を持って最後まで遊べる', () => {
  const g = game(1)
  const v = g.view('p0')
  assert.equal(v.me.length, 5)
  assert.equal(v.solo, true)
  assert.ok(v.nav && v.order)
  run(g, READY_SEC + 0.1)
  drive(g, 'p0', ['accel', 'right'], 1)
  assert.ok(g._debug.car.x > START.x)
})

test('毎 tick の送信量が小さい（1人あたり1.5KB未満）', () => {
  const g = game(6)
  run(g, READY_SEC + 5)
  for (const p of players(6)) assert.ok(JSON.stringify(g.view(p.id)).length < 1500, p.id + ' ' + JSON.stringify(g.view(p.id)).length)
})

test('ブラウザから届く opts（start のおまけ）では制限時間も乱数も変えられず、落ちない', () => {
  const g = createGame(players(2), { rng: { evil: 1 }, timeLimit: 99999, round: 1 })
  assert.equal(g.view('p0').limit, TIME_LIMIT)
  run(g, READY_SEC + 1)
  assert.equal(g.isOver(), false)
})
