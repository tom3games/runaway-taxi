// 実ブラウザ（chromium と webkit）で3人つないで、作成→招待URLで参加→開始→担当ごとの操作→結果→再戦 を通す。
// 画面が一画面に収まるか（390x844 / 360x640 / 844x390）とコンソールエラーも数える。スクショは tools/shots/
// 使い方: node tools/e2e.mjs   （サーバーは自前で立てる。制限時間は短くしてある）
process.env.TAXI_TIME_LIMIT = process.env.TAXI_TIME_LIMIT || '18'
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'
import * as play from './e2e-play.mjs'

const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const SIZES = [[390, 844], [360, 640], [844, 390]]

// 一画面に収まるか: 縦スクロールが無く、見えているボタンが全部画面の中にある
async function fits(page, label, shotName) {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const H = innerHeight, W = innerWidth
      const out = []
      for (const b of document.querySelectorAll('button, input, summary')) {
        const rc = b.getBoundingClientRect()
        if (!rc.width || !rc.height || b.closest('[hidden]')) continue
        if (rc.bottom > H + 1 || rc.right > W + 1 || rc.top < -1 || rc.left < -1) out.push((b.id || b.textContent.trim().slice(0, 8)) + `@${Math.round(rc.top)}-${Math.round(rc.bottom)}`)
        if (rc.height < 36 && !b.matches('summary')) out.push('small:' + (b.id || b.textContent.trim().slice(0, 8)) + ':' + Math.round(rc.height))
      }
      return { sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, H, W, out }
    })
    if (w > h && shotName) await page.screenshot({ path: `${SHOTS}${shotName}-landscape.png` })
    check(r.sh <= r.H + 1 && r.sw <= r.W + 1 && r.out.length === 0, `${label} ${w}x${h} 一画面に収まる（scroll ${r.sw}x${r.sh}）${r.out.join(' ')}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(150)
}

for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch()
  const errors = []
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: bname === 'chromium', deviceScaleFactor: 2 })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    p.on('requestfailed', r => errors.push('requestfailed ' + r.url()))
    return p
  }
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}${bname}-${name}.png` })
  const host = await mk(), g1 = await mk(), g2 = await mk()
  await host.goto(base)
  await host.waitForSelector('#home:not([hidden])')
  await shot(host, 'home')
  await fits(host, `${bname}: ホーム`, `${bname}-home`)
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URLが出る ${invite}`)
  for (const [p, n] of [[g1, 'ゲスト1'], [g2, 'ゲスト2']]) {
    await p.goto(invite)
    check((await p.inputValue('#code')).length === 4, `${bname}: 招待URLを開くと参加コードが入っている`)
    await p.fill('#name', n)
    await p.click('#joinBtn')
    await p.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(true, `${bname}: 3人がロビーにそろう`)
  await shot(host, 'lobby')
  await fits(host, `${bname}: ロビー`, `${bname}-lobby`)
  await host.click('#startBtn')
  for (const p of [host, g1, g2]) await p.waitForSelector('#game:not([hidden])')
  check(true, `${bname}: ゲームが始まる`)
  await play.playToEnd([host, g1, g2], (ok, l) => check(ok, `${bname}: ${l}`), shot)
  for (const p of [host, g1, g2]) { const me = (await p.evaluate(() => window.__taxi.me)).join('+'); await fits(p, `${bname}: ゲーム中（${me}）`, `${bname}-game-${me}`) }
  // 描けているか（真っ黒でない）を数値で見る
  const lum = await host.evaluate(() => {
    const c = document.querySelector('#t-cv'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data
    let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { const l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += l; s2 += l * l; n++ }
    const m = s / n; return { mean: Math.round(m), sd: Math.round(Math.sqrt(s2 / n - m * m)) }
  })
  check(lum.sd > 8, `${bname}: 地図が描けている（明るさ 平均${lum.mean} ばらつき${lum.sd}）`)
  await g1.waitForSelector('#result:not([hidden])', { timeout: 60000 })
  check(true, `${bname}: 結果画面が出る（${await g1.textContent('#resultTitle')}）`)
  await shot(g1, 'result')
  await host.waitForSelector('#result:not([hidden])')
  await fits(host, `${bname}: 結果`, `${bname}-result`)
  await shot(host, 'result-host')
  await host.click('#rematchBtn')
  for (const p of [g1, g2]) await p.waitForSelector('#game:not([hidden])')
  await g1.waitForFunction(() => window.__taxi && window.__taxi.st === 'ready')
  check(true, `${bname}: 再戦できる`)
  check(errors.length === 0, `${bname}: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}

// 1人で遊ぶ（全部の担当を1人が持つ）
{
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await p.goto(base); await p.fill('#name', 'ソロ'); await p.click('#createBtn'); await p.waitForSelector('#lobby:not([hidden])')
  await p.click('#startBtn')
  await p.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 8000 })
  check((await p.locator('[data-key]').count()) === 4, 'ソロ: 4つの操作ボタンが全部出る')
  check((await p.locator('[data-call]').count()) === 0, 'ソロ: 掛け声ボタンは出ない')
  // キーボードでも動く
  await p.keyboard.down('ArrowUp'); await p.waitForTimeout(1000); await p.keyboard.up('ArrowUp')
  await p.waitForTimeout(300)
  check((await p.evaluate(() => window.__taxi.car.x)) > 7.5, 'ソロ: キーボードの上矢印で進む')
  await p.screenshot({ path: `${SHOTS}solo-game.png` })
  await fits(p, 'ソロ: ゲーム中')
  check(errors.length === 0, `ソロ: コンソールエラー0件 ${errors.join(' / ')}`)
  await browser.close()
}
// 6人（最大）: ハンドルが左右に分かれ、全員の画面が一画面に収まる
{
  const browser = await chromium.launch()
  const errors = []
  const pages = []
  for (let i = 0; i < 6; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    pages.push(p)
  }
  await pages[0].goto(base); await pages[0].fill('#name', 'P1'); await pages[0].click('#createBtn'); await pages[0].waitForSelector('#lobby:not([hidden])')
  const invite = await pages[0].inputValue('#invite')
  for (let i = 1; i < 6; i++) { await pages[i].goto(invite); await pages[i].fill('#name', 'P' + (i + 1)); await pages[i].click('#joinBtn'); await pages[i].waitForSelector('#lobby:not([hidden])') }
  await pages[0].waitForFunction(() => document.querySelectorAll('#players li').length === 6)
  await pages[0].screenshot({ path: `${SHOTS}six-lobby.png` })
  await fits(pages[0], '6人: ロビー')
  await pages[0].click('#startBtn')
  for (const p of pages) await p.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 8000 })
  const roles = await Promise.all(pages.map(p => p.evaluate(() => window.__taxi.me.join('+'))))
  check(roles.includes('wheelL') && roles.includes('wheelR') && roles.every(r => !r.includes('+')), `6人: 1人1役でハンドルは左右に分かれる ${roles.join(' / ')}`)
  const L = pages[roles.indexOf('wheelL')], E = pages[roles.indexOf('engine')]
  check((await L.locator('[data-key]').count()) === 1 && (await L.locator('[data-key="left"]').count()) === 1, '6人: ハンドル左は左ボタンだけ')
  for (let i = 0; i < 6; i++) { await pages[i].screenshot({ path: `${SHOTS}six-${roles[i]}.png` }); await fits(pages[i], `6人: ${roles[i]}`) }
  void E
  check(errors.length === 0, `6人: コンソールエラー0件 ${errors.join(' / ')}`)
  await browser.close()
}
await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)
