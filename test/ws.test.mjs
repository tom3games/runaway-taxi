// 本物のサーバーを立てて、WebSocket で複数人がつなぐ統合テスト
import test from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
process.env.TAXI_TIME_LIMIT = '2' // 統合テストは2秒で終わらせる
import { startServer } from '../server.mjs'
import * as gameDef from '../lib/game.mjs'

function client(port, saved) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const c = { ws, msgs: [], id: null, token: null, state: null }
  ws.on('message', d => {
    const m = JSON.parse(d)
    c.msgs.push(m)
    if (m.t === 'session') { c.id = m.id; c.token = m.token }
    if (m.t === 'state') c.state = m
  })
  c.ready = new Promise(r => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ...(saved || {}) })); r() }))
  c.send = m => ws.send(JSON.stringify(m))
  c.wait = (pred, ms = 3000) => new Promise((res, rej) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      const hit = c.msgs.find(pred)
      if (hit) { clearInterval(iv); res(hit) } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')) }
    }, 10)
  })
  return c
}

test('2人がつないで、作成・参加・開始・操作・終了・再戦まで通る', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port), b = client(srv.port)
    await a.ready; await b.ready
    await a.wait(m => m.t === 'welcome'); await b.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    b.send({ t: 'join', code, name: 'B' })
    await b.wait(m => m.t === 'joined')
    await a.wait(m => m.t === 'state' && m.players.length === 2)
    b.send({ t: 'start' })
    await b.wait(m => m.t === 'error' && m.code === 'not_host')
    a.send({ t: 'start' })
    await b.wait(m => m.t === 'state' && m.phase === 'playing')
    // 2人ならエンジンを持っている方がアクセルを踏むと車が進む
    const st = await a.wait(m => m.t === 'state' && m.phase === 'playing')
    const engineHolder = st.game.roles.find(r => r.roles.includes('engine')).id === a.id ? a : b
    const x0 = st.game.car.x
    const press = setInterval(() => engineHolder.send({ t: 'input', data: { type: 'hold', key: 'accel', on: true } }), 300)
    const moved = await a.wait(m => m.t === 'state' && m.phase === 'playing' && m.game.car.x > x0 + 0.5, 6000)
    assert.ok(moved.game.car.x > x0)
    const end = await b.wait(m => m.t === 'state' && m.phase === 'result', 8000)
    clearInterval(press)
    assert.equal(end.result.reason, 'time')
    assert.equal(end.result.win, false) // 2秒では目標に届かない
    assert.ok(end.result.crew.length === 2)
    a.send({ t: 'rematch' })
    await b.wait(m => m.t === 'state' && m.phase === 'playing' && m.round === 2)
    a.ws.close(); b.ws.close()
  } finally { await srv.close() }
})

test('切れても id と token で同じ席に戻れる。token が違うと別人になる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'session')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    const saved = { id: a.id, token: a.token }
    a.ws.close()
    await new Promise(r => setTimeout(r, 100))
    const a2 = client(srv.port, saved)
    const w = await a2.wait(m => m.t === 'welcome')
    assert.equal(w.code, code)
    const st = await a2.wait(m => m.t === 'state')
    assert.equal(st.you, saved.id)
    const evil = client(srv.port, { id: saved.id, token: 'x'.repeat(32) })
    const w2 = await evil.wait(m => m.t === 'welcome')
    assert.notEqual(w2.id, saved.id)
    assert.equal(w2.code, null)
    a2.ws.close(); evil.ws.close()
  } finally { await srv.close() }
})

test('操作を送りすぎても、部屋の操作（再戦など）は捨てられない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' }); await a.wait(m => m.t === 'joined')
    a.send({ t: 'start' }); await a.wait(m => m.t === 'state' && m.phase === 'playing')
    for (let i = 0; i < 300; i++) a.send({ t: 'input', data: { type: 'hold', key: 'accel', on: i % 2 === 0 } }) // 一気に送る
    a.send({ t: 'leave' })
    await new Promise(r => setTimeout(r, 200))
    assert.equal(srv.rooms.rooms.get([...srv.rooms.rooms.keys()][0]).players.length, 0)
    a.ws.close()
  } finally { await srv.close() }
})

test('壊れたメッセージを送ってもサーバーは落ちない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready
    a.ws.send('not json')
    a.send({ nope: 1 })
    a.send({ t: 'input', data: { type: 'hold', key: 'accel', on: true } })
    await a.wait(m => m.t === 'error' && m.code === 'bad_json')
    const res = await fetch(`http://localhost:${srv.port}/healthz`)
    assert.equal((await res.json()).ok, true)
    a.ws.close()
  } finally { await srv.close() }
})

test('画面と招待URL（/r/コード）が返る。フォルダの外は読めない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const base = `http://localhost:${srv.port}`
    assert.equal((await fetch(base + '/')).status, 200)
    assert.match(await (await fetch(base + '/r/ABCD')).text(), /<html/)
    assert.equal((await fetch(base + '/app.js')).status, 200)
    const r = await fetch(base + '/..%2fpackage.json')
    assert.notEqual(r.status, 200)
  } finally { await srv.close() }
})

test('start に変な opts（rng など）を付けてもサーバーは落ちず、ゲームは普通に始まる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' }); await a.wait(m => m.t === 'joined')
    a.send({ t: 'start', opts: { rng: 'x', timeLimit: 99999, deep: { x: 1 } } })
    const st = await a.wait(m => m.t === 'state' && m.phase === 'playing')
    assert.equal(st.game.limit, 2) // 環境変数の値のまま（opts では変わらない）
    const res = await fetch(`http://localhost:${srv.port}/healthz`)
    assert.equal((await res.json()).ok, true)
    a.ws.close()
  } finally { await srv.close() }
})

test('index.html の og:image は来たホスト名の絶対URLになる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const html = await (await fetch(`http://localhost:${srv.port}/r/ABCD`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'taxi.example.com' } })).text()
    assert.match(html, /property="og:image" content="https:\/\/taxi\.example\.com\/og\.png"/)
    assert.match(html, /name="twitter:image" content="https:\/\/taxi\.example\.com\/og\.png"/)
    assert.match(html, /property="og:url" content="https:\/\/taxi\.example\.com\/r\/ABCD"/)
    const bad = await (await fetch(`http://localhost:${srv.port}/`, { headers: { 'x-forwarded-host': '"><script>' } })).text()
    assert.ok(!bad.includes('<script>"') && bad.includes('content="/og.png"'), '変なホスト名は入れない')
  } finally { await srv.close() }
})
