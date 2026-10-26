// 3D の fps を測る（GPU を使う設定の headless Chromium）。スマホ相当（390x844・画素比3・タッチ）と横持ちで、3つの街を数秒ずつ走らせる。
// 比べる基準として、何も描かない空のページの fps も先に測る（電池駆動の Mac は空でも 30 前後に落ちる）
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
import { MAP_IDS } from '../public/map.js'
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
{
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await p.setContent('<body></body>')
  const fps = await p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)) }; requestAnimationFrame(f) }))
  console.log(`空のページ fps ${fps.toFixed(1)}`)
  await p.context().close()
}
for (const [w, h] of [[390, 844], [844, 390]]) {
  for (const id of MAP_IDS) {
    const mk = async () => (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ja-JP' })).newPage()
    const hp = await mk()
    await hp.goto(base); await hp.fill('#name', 'A'); await hp.click('#createBtn'); await hp.waitForSelector('#lobby:not([hidden])')
    for (let i = 0; i < 4 && await hp.getAttribute('#mapPick .pk-body', 'data-id') !== id; i++) await hp.click('#mapPick .pk-btn[data-d="1"]')
    await hp.click('#startBtn')
    await hp.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 10000 })
    await hp.locator('[data-key="accel"]').dispatchEvent('pointerdown')
    // 左右を少しずつ切りながら走る（街の中をいろいろな向きで描く）
    const t0 = Date.now()
    let k = 0
    while (Date.now() - t0 < 7000) {
      const key = ++k % 3 === 0 ? 'left' : 'right'
      await hp.locator(`[data-key="${key}"]`).dispatchEvent('pointerdown')
      await hp.waitForTimeout(250)
      await hp.locator(`[data-key="${key}"]`).dispatchEvent('pointerup')
      await hp.waitForTimeout(450)
    }
    const r = await hp.evaluate(() => ({ fps: window.__tx.fps(), tier: window.__tx.tier() }))
    console.log(`${w}x${h} 画素比3 ${id.padEnd(10)} fps ${r.fps.toFixed(1)} 画質 ${r.tier}（2=高 1=中 0=低）`)
    await hp.context().close()
  }
}
await b.close(); await srv.close()
