// ゲーム中の画面を人数・担当ごとに撮る（見た目の確認用）。tools/shots/game-*.png
// 使い方: node tools/shot-game.mjs [人数...]   例: node tools/shot-game.mjs 1 2 3
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const errs = []
const ns = process.argv.slice(2).map(Number).filter(Boolean)
const MAP = process.env.MAP || 'shitamachi'
for (const n of ns.length ? ns : [1, 2, 3]) {
  const pages = []
  for (let i = 0; i < n; i++) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
    pages.push(p)
  }
  const [h] = pages
  await h.goto(base); await h.fill('#name', 'たろう'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
  for (let i = 0; i < 4 && await h.getAttribute('#mapPick .pk-body', 'data-id') !== MAP; i++) await h.click('#mapPick .pk-btn[data-d="1"]')
  const inv = await h.inputValue('#invite')
  for (let i = 1; i < n; i++) { await pages[i].goto(inv); await pages[i].fill('#name', 'なかま' + i); await pages[i].click('#joinBtn'); await pages[i].waitForSelector('#lobby:not([hidden])') }
  await h.click('#startBtn')
  await h.waitForFunction(() => window.__taxi && window.__taxi.st === 'ready')
  await h.waitForTimeout(500)
  await h.screenshot({ path: `${SHOTS}game-${n}p-ready.png` })
  await h.waitForFunction(() => window.__taxi.st === 'drive', null, { timeout: 8000 })
  const roles = await Promise.all(pages.map(p => p.evaluate(() => window.__taxi.me.join('+'))))
  const eng = pages[roles.findIndex(r => r.includes('engine'))]
  await eng.locator('[data-key="accel"]').dispatchEvent('pointerdown')
  await h.waitForTimeout(1500)
  for (let i = 0; i < n; i++) {
    for (const [w, hh] of (process.env.SIZES ? JSON.parse(process.env.SIZES) : [[390, 844], [568, 320]])) {
      await pages[i].setViewportSize({ width: w, height: hh }); await pages[i].waitForTimeout(400)
      await pages[i].screenshot({ path: `${SHOTS}game-${n}p-${roles[i]}-${w}x${hh}.png` })
    }
    const v = await pages[i].evaluate(() => ({ mode: window.__tx.mode(), v: window.__tx.variance() }))
    console.log(n, roles[i], v.mode, Math.round(v.v))
  }
  for (const p of pages) await p.context().close()
}
console.log('errors', errs.length, errs.slice(0, 3))
await b.close(); await srv.close()
