// 出来事の演出（届けた・怒って降りた・猫・信号無視・幕の切り替わり・嵐の深夜）を 3D で撮る（見た目の確認用）。tools/shots/fx-*.png
// 演出だけを画面で流す（window.__tx.fx）。サーバーの状態は変えない。嵐は制限時間を縮めて本当に第3幕まで待つ
process.env.TAXI_TIME_LIMIT = '15'
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const errs = []
const map = process.env.MAP || 'neon'
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage()
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
await p.goto(base); await p.fill('#name', 'たろう'); await p.click('#createBtn'); await p.waitForSelector('#lobby:not([hidden])')
for (let i = 0; i < 4 && await p.getAttribute('#mapPick .pk-body', 'data-id') !== map; i++) await p.click('#mapPick .pk-btn[data-d="1"]')
await p.click('#startBtn')
await p.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 8000 })
const fx = async (name, e, wait = 450) => { await p.evaluate(e => window.__tx.fx(e), e); await p.waitForTimeout(wait); await p.screenshot({ path: `${SHOTS}fx-${name}.png` }) }
await fx('deliver', { k: 'deliver', name: '受験生', kind: 'hurry', stars: 5, yen: 1340, note: '間に合った' })
await fx('angry', { k: 'angry', name: '社長', kind: 'vip' }, 600)
await fx('cat', { k: 'crash', what: 'cat', p: 2.5 }, 300)
await fx('red', { k: 'red', fine: 150 })
await p.waitForFunction(() => window.__taxi.ph === 2, null, { timeout: 20000 })
await p.waitForTimeout(1200)
await p.screenshot({ path: `${SHOTS}fx-storm.png` })
await p.waitForFunction(() => window.__taxi.st === 'end', null, { timeout: 20000 })
await p.waitForTimeout(600)
await p.screenshot({ path: `${SHOTS}fx-end.png` })
console.log('errors', errs.length, errs.slice(0, 3))
await b.close(); await srv.close()
