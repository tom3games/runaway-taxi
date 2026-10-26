// 結果画面を、中身が多いとき（6人・称号3つ・届けた客多数・勝ち／廃車）で撮る。サーバーの結果をそのまま作って画面に流す（見た目の確認用）
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch()
const errs = []
const crew = ['たろう', 'はなこ', 'とても長い名前のひと', 'けんた', 'みお', 'じろう'].map((name, i) => ({ name, roles: [['wheelL'], ['wheelR'], ['engine'], ['navi'], ['lookout'], ['order']][i] }))
const trips = [
  { name: '受験生', kind: 'hurry', dest: '病院', stars: 5, yen: 1340, note: '間に合った・無事故' },
  { name: 'おばあちゃん', kind: 'gentle', dest: '温泉', stars: 4, yen: 980, note: '' },
  { name: '酔っぱらい', kind: 'queasy', dest: '寿司屋', stars: 0, yen: 0, note: '怒って降りた' },
  { name: '幽霊', kind: 'ghost', dest: '神社', stars: 5, yen: 3120, note: '振り向いたら消えていた・深夜料金' }
]
const stats = { wall: 9, water: 0, cone: 2, cat: 1, car: 1, red: 3, five: 3, angry: 1, maxKmh: 84, late: 0, ghost: 1, kid: 0, calls: 41, calm: 2, grass: 2 }
const cases = {
  win: { win: true, title: '営業成功', reason: 'time', score: 6440, target: 3000, rank: 'S', map: 'neon', phase: 2, trips, crashes: 14, dmg: 72, stats, crew },
  wreck: { win: false, title: '廃車', reason: 'wreck', score: 1240, target: 3000, rank: '-', map: 'minato', phase: 1, trips: trips.slice(0, 2), crashes: 31, dmg: 100, stats: { ...stats, water: 2 }, crew: crew.slice(0, 3) }
}
for (const [name, r] of Object.entries(cases)) for (const [w, h] of [[390, 844], [360, 640], [844, 390], [568, 320]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', deviceScaleFactor: 2 })).newPage()
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  await p.goto(base); await p.waitForSelector('#home:not([hidden])')
  await p.evaluate(async r => {
    const v = await import('/game-view.js')
    for (const s of ['home', 'lobby', 'game', 'result']) document.getElementById(s).hidden = s !== 'result'
    document.body.dataset.screen = 'result'
    const t = document.getElementById('resultTitle'); t.textContent = r.title; t.dataset.win = r.win ? '1' : '0'; t.dataset.reason = r.reason
    document.getElementById('resultBody').replaceChildren(v.renderResult({ code: 'TEST', round: 1, result: r }))
    document.getElementById('rematchBtn').hidden = false; document.getElementById('lobbyBtn').hidden = false
  }, r)
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500)
  const fit = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, over: [...document.querySelectorAll('#result button')].some(b => b.getBoundingClientRect().bottom > innerHeight) }))
  console.log(name, `${w}x${h}`, fit.sh <= fit.ih && !fit.over ? 'OK' : 'NG', JSON.stringify(fit))
  await p.screenshot({ path: `${SHOTS}result-${name}-${w}x${h}.png` })
  await p.context().close()
}
console.log('errors', errs.length, errs.slice(0, 3))
await b.close(); await srv.close()
