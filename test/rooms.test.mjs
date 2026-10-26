// ルーム管理の単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomManager, LIMITS, cleanName } from '../lib/rooms.mjs'
import * as gameDef from '../lib/game.mjs'

function setup() {
  let t = 0
  const sent = []
  const m = new RoomManager(gameDef, { send: (id, msg) => sent.push([id, msg]), now: () => t })
  const s = () => m.newSession().id
  return { m, s, sent, advance: ms => { t += ms; m.tick(ms) } }
}

test('部屋を作るとコードが出て、作った人がホストになる', () => {
  const { m, s } = setup()
  const a = s()
  const r = m.create(a, 'たろう')
  assert.match(r.code, /^[A-Z2-9]{4}$/)
  assert.equal(m.rooms.get(r.code).hostId, a)
})

test('参加コードで入れる。小文字でも入れる', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  assert.deepEqual(m.join(b, code.toLowerCase(), 'B'), { code })
  assert.equal(m.rooms.get(code).players.length, 2)
})

test('入れないときは理由を返す（無い・満員・開始後・名前なし）', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  assert.equal(m.join(s(), 'ZZZZ', 'x').error, 'not_found')
  assert.equal(m.join(s(), code, '   ').error, 'bad_name')
  for (let i = 1; i < gameDef.meta.maxPlayers; i++) m.join(s(), code, 'p' + i)
  assert.equal(m.join(s(), code, 'over').error, 'full')
  const { code: c2 } = m.create(s(), 'H')
  const host = m.rooms.get(c2).hostId
  m.start(host)
  assert.equal(m.join(s(), c2, 'late').error, 'started')
})

test('名前は12文字まで・制御文字と<>は消す・同じ名前には番号がつく', () => {
  assert.equal(cleanName('<b>abcdefghijklmnop'), 'babcdefghijk')
  const { m, s } = setup()
  const { code } = m.create(s(), 'A')
  m.join(s(), code, 'A')
  assert.deepEqual(m.rooms.get(code).players.map(p => p.name), ['A', 'A2'])
})

test('ホスト以外はスタートできない。人数が足りないと始まらない', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  assert.equal(m.start(b).error, 'not_host')
  assert.equal(m.start(a).ok, true)
  assert.equal(m.rooms.get(code).phase, 'playing')
})

test('ゲームが終わると結果になり、ホストが再戦できる', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  const room = m.rooms.get(code)
  for (let i = 0; i < (gameDef.TIME_LIMIT + gameDef.READY_SEC + gameDef.LINGER + 1) * 10; i++) m.tick(100)
  assert.equal(room.phase, 'result')
  assert.equal(room.result.reason, 'time')
  assert.equal(m.rematch(a).ok, true)
  assert.equal(room.phase, 'playing')
  assert.equal(room.round, 2)
})

test('不正な入力は状態を変えない', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  const before = JSON.stringify(m.rooms.get(code).game.view(a))
  assert.equal(m.input(a, { type: 'hack', n: 999 }).error, 'bad_input')
  assert.equal(m.input(a, null).error, 'bad_input')
  assert.equal(m.input(a, { type: 'hold', key: 'nitro', on: true }).error, 'bad_input')
  assert.equal(JSON.stringify(m.rooms.get(code).game.view(a)), before)
  assert.equal(m.input(s(), { type: 'hold', key: 'accel', on: true }).error, 'not_playing') // 部屋にいない人
})

test('時間切れで負けになる', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.start(a)
  for (let i = 0; i < (gameDef.TIME_LIMIT + gameDef.READY_SEC + gameDef.LINGER + 1) * 10; i++) advance(100)
  assert.equal(m.rooms.get(code).phase, 'result')
  assert.equal(m.rooms.get(code).result.win, false)
})

test('ホストが切れたままだと次の人がホストになる。戻れば同じ席', () => {
  const { m, s, advance } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  m.disconnect(a)
  advance(LIMITS.hostGraceMs + 100)
  assert.equal(m.rooms.get(code).hostId, b)
  assert.equal(m.reconnect(a), code)
  assert.equal(m.rooms.get(code).players.find(p => p.id === a).connected, true)
})

test('切断が長いと席が消え、誰もいない部屋は消える', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.disconnect(a)
  advance(LIMITS.reconnectGraceMs + 100)
  assert.equal(m.rooms.get(code).players.length, 0)
  advance(LIMITS.emptyRoomMs + 100)
  assert.equal(m.rooms.has(code), false)
})

test('他人の token では席を奪えない', () => {
  const { m } = setup()
  const a = m.newSession()
  assert.equal(m.resume(a.id, 'wrong'), null)
  assert.ok(m.resume(a.id, a.token))
})

test('start の opts は文字・数字・真偽値だけがゲームに渡り、rng は捨てられる', () => {
  let got = null
  const stub = { meta: { minPlayers: 1, maxPlayers: 6 }, createGame: (ps, o) => { got = o; return { tick() {}, input() {}, view: () => ({}), isOver: () => false, result: () => ({}) } } }
  const m = new RoomManager(stub)
  const a = m.newSession().id
  m.create(a, 'A')
  m.start(a, { rng: 'x', n: 3, s: 'y'.repeat(100), b: true, obj: { x: 1 }, fn: [1] })
  assert.equal('rng' in got, false)
  assert.equal(got.n, 3); assert.equal(got.b, true); assert.equal(got.s.length, 40)
  assert.equal('obj' in got, false); assert.equal('fn' in got, false)
  assert.equal(got.round, 1)
})

test('ロビーの設定（街）はホストだけが変えられ、英小文字だけが全員に届く', () => {
  const { m, s, sent } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A'); m.join(b, code, 'B')
  assert.equal(m.setup(b, { map: 'neon' }).error, 'not_host')
  assert.equal(m.setup(a, { map: 'neon', evil: '<script>', __proto__: 'x', n: 5 }).ok, true)
  const last = sent.filter(([id, msg]) => id === b && msg.t === 'state').at(-1)[1]
  assert.deepEqual(last.setup, { map: 'neon' })
  m.start(a, { map: 'neon' })
  assert.equal(m.rooms.get(code).game.view(a).map, 'neon')
})
