// 公開URL（または手元）に2人（chromium と webkit）でつなぎ、街を選んで走り出し、操作と掛け声が相手に届くか、3D で描けているか、
// OGP が取れるか、起動エラーの誤表示が出ないか（20秒待っても #bootErr が隠れたまま）を確かめる。
// 使い方: node tools/live-check.mjs https://xxxx.trycloudflare.com   （URL を省くと手元にサーバーを立てる）
import { chromium, webkit } from 'playwright'
let base = process.argv[2], srv = null
if (!base) { const { startServer } = await import('../server.mjs'); srv = await startServer({ port: 0, quiet: true }); base = `http://localhost:${srv.port}` }
base = base.replace(/\/$/, '')
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const errs = []
const bc = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const bw = await webkit.launch()
const mk = async b => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); return p }
const h = await mk(bc), g = await mk(bw)
const t0 = Date.now()
await h.goto(base); await h.waitForSelector('#home:not([hidden])', { timeout: 30000 })
check(true, `ホームが出る（${Date.now() - t0}ms）`)
await h.fill('#name', 'ホスト'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
for (let i = 0; i < 4 && await h.getAttribute('#mapPick .pk-body', 'data-id') !== 'neon'; i++) await h.click('#mapPick .pk-btn[data-d="1"]')
await g.goto(await h.inputValue('#invite')); await g.fill('#name', 'ゲスト'); await g.click('#joinBtn'); await g.waitForSelector('#lobby:not([hidden])')
await g.waitForFunction(() => document.querySelector('#mapPick .pk-body')?.dataset.id === 'neon', null, { timeout: 8000 }).then(() => check(true, 'ホストが選んだ繁華街がゲスト（webkit）にも見える'), () => check(false, 'ゲストに街が届かない'))
await h.click('#startBtn')
for (const p of [h, g]) await p.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 30000 })
const roles = await Promise.all([h, g].map(p => p.evaluate(() => window.__taxi.me)))
check(roles[0].length + roles[1].length === 5, `2人で5つの担当を分けた（${roles.map(r => r.join('+')).join(' / ')}）`)
const eng = roles[0].includes('engine') ? h : g, other = eng === h ? g : h
const c0 = await other.evaluate(() => window.__taxi.car)
await eng.locator('[data-key="accel"]').dispatchEvent('pointerdown')
await eng.waitForTimeout(1200)
const c1 = await other.evaluate(() => window.__taxi.car)
const moved = Math.hypot(c1.x - c0.x, c1.y - c0.y)
check(moved > 1, `エンジン担当がアクセルを入れると、相手の画面で車が進む（${moved.toFixed(2)}マス）`)
await eng.locator('[data-key="brake"]').dispatchEvent('pointerdown'); await eng.waitForTimeout(400); await eng.locator('[data-key="brake"]').dispatchEvent('pointerup')
const caller = (await h.locator('[data-call]').count()) ? h : g, listener = caller === h ? g : h
await caller.locator('[data-call]').first().dispatchEvent('pointerdown')
await listener.waitForSelector('#t-call:not([hidden])', { timeout: 5000 }).then(() => check(true, '掛け声が相手の画面に出る'), () => check(false, '掛け声が届かない'))
for (const [p, n] of [[h, 'chromium'], [g, 'webkit']]) {
  const r = await p.evaluate(() => ({ mode: window.__tx.mode(), v: window.__tx.variance() }))
  check(r.mode === '3d' && r.v > 200, `${n}: 3D で描けている（${r.mode} 輝度の分散 ${Math.round(r.v)}）`)
  await p.screenshot({ path: `tools/shots/live-${n}.png` })
}
// 起動エラーの誤表示: 新しく開いて20秒待っても #bootErr が出ない
for (const [b, n] of [[bc, 'chromium'], [bw, 'webkit']]) {
  const p = await mk(b)
  await p.goto(base)
  await p.waitForTimeout(21000)
  const shown = await p.evaluate(() => !document.getElementById('bootErr').hidden)
  check(!shown, `${n}: 20秒待っても起動エラーの表示が出ない`)
  await p.context().close()
}
check(errs.length === 0, `コンソールエラー0件 ${errs.slice(0, 3).join(' / ')}`)
// OGP
const op = await (await bc.newContext()).newPage()
await op.goto(base)
const meta = await op.evaluate(() => ({ img: document.querySelector('meta[property="og:image"]')?.content, url: document.querySelector('meta[property="og:url"]')?.content, title: document.querySelector('meta[property="og:title"]')?.content }))
const ir = await op.request.get(meta.img)
const buf = await ir.body()
check(ir.status() === 200 && buf.length > 10000 && /^https?:\/\//.test(meta.img), `OGP 画像が取れる（${ir.status()} ${buf.length}バイト ${meta.img}）`)
check(!!meta.url && meta.url.startsWith(base), `og:url が公開URLになる（${meta.url}）`)
await bc.close(); await bw.close(); if (srv) await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)
