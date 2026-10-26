// 実ブラウザ（chromium と webkit）で3人つないで、作成→招待URLで参加→街を選ぶ→開始→担当ごとの操作→時間切れ→結果→再戦 を通す。
// 画面が一画面に収まるか（390x844 / 360x640 / 844x390 / 568x320）、ボタンが44px以上か、コンソールエラー0件、3D が描けているか（輝度の分散）も数える。
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
let fail = 0, total = 0
const check = (ok, label) => { total++; console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const SIZES = [[390, 844], [360, 640], [844, 390], [568, 320]]
// chromium は GPU を使う設定で起動する（既定のソフトウェア描画だと 3D が遅く、操作の確認が間に合わない）
const GPU = { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }

// 一画面に収まるか: 上下左右にスクロールが無く、見えているボタンが全部画面の中にあって 44px 以上
async function fits(page, label, shotName) {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const H = innerHeight, W = innerWidth
      const out = []
      for (const b of document.querySelectorAll('button, input, summary')) {
        const rc = b.getBoundingClientRect()
        if (!rc.width || !rc.height || b.closest('[hidden]') || getComputedStyle(b).visibility === 'hidden') continue
        const name = (b.id || b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 8)
        if (rc.bottom > H + 1 || rc.right > W + 1 || rc.top < -1 || rc.left < -1) out.push(name + `画面外@${Math.round(rc.top)}-${Math.round(rc.bottom)}`)
        else if (rc.height < 43.5 || rc.width < 43.5) out.push(`${name}:${Math.round(rc.width)}x${Math.round(rc.height)}`)
      }
      return { sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, H, W, out }
    })
    if (shotName) await page.screenshot({ path: `${SHOTS}${shotName}-${w}x${h}.png` })
    check(r.sh <= r.H + 1 && r.sw <= r.W + 1 && r.out.length === 0, `${label} ${w}x${h} 一画面に収まりボタンは44px以上（scroll ${r.sw}x${r.sh}）${r.out.join(' ')}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(150)
}
const watch = (p, errors) => {
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  p.on('requestfailed', r => { if (!r.url().includes('fonts.g')) errors.push('requestfailed ' + r.url()) })
  p.on('response', r => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`))
}

for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch(bname === 'chromium' ? GPU : {})
  const errors = []
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: bname === 'chromium', deviceScaleFactor: 2 })
    const p = await ctx.newPage(); watch(p, errors); return p
  }
  const shot = (p, name) => p.screenshot({ path: `${SHOTS}${bname}-${name}.png` })
  const host = await mk(), g1 = await mk(), g2 = await mk()
  await host.goto(base)
  await host.waitForSelector('#home:not([hidden])')
  check((await host.title()).includes('暴走タクシー'), `${bname}: 題名が出る`)
  await fits(host, `${bname}: ホーム`, `${bname}-home`)
  await host.click('#howBtn'); await fits(host, `${bname}: 遊び方`, `${bname}-howto`); await host.click('#howClose')
  await host.click('#recBtn'); await fits(host, `${bname}: 記録と称号`, `${bname}-records`); await host.click('#recClose')
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URLが出る ${invite}`)
  for (const [p, n] of [[g1, 'ゲスト1'], [g2, 'とても長い名前のひと']]) {
    await p.goto(invite)
    check((await p.inputValue('#code')).length === 4, `${bname}: 招待URLを開くと参加コードが入っている`)
    await p.fill('#name', n)
    await p.click('#joinBtn')
    await p.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(true, `${bname}: 3人がロビーにそろう`)
  check(await g1.isHidden('#mapPick .pk-btn'), `${bname}: 街を選べるのはホストだけ`)
  for (let i = 0; i < 4 && await host.getAttribute('#mapPick .pk-body', 'data-id') !== 'minato'; i++) await host.click('#mapPick .pk-btn[data-d="1"]')
  await g1.waitForFunction(() => document.querySelector('#mapPick .pk-body')?.dataset.id === 'minato', null, { timeout: 3000 }).then(() => check(true, `${bname}: ホストが選んだ街（港町）が参加者にも見える`), () => check(false, `${bname}: 参加者に街が届かない`))
  await fits(host, `${bname}: ロビー`, `${bname}-lobby`)
  await fits(g2, `${bname}: ロビー（参加者）`, `${bname}-lobby-guest`)
  await host.click('#startBtn')
  for (const p of [host, g1, g2]) await p.waitForSelector('#game:not([hidden])')
  check(true, `${bname}: ゲームが始まる`)
  check(await g2.evaluate(() => window.__taxi.map) === 'minato', `${bname}: 選んだ街で始まる`)
  const roles = await play.playToEnd([host, g1, g2], (ok, l) => check(ok, `${bname}: ${l}`), shot)
  const mode = await host.evaluate(() => window.__tx.mode())
  check(mode === '3d', `${bname}: 3D で描いている（${mode}）`)
  for (let i = 0; i < 3; i++) {
    const p = [host, g1, g2][i]
    const v = await p.evaluate(() => window.__tx.variance())
    check(v > 200, `${bname}: ${roles[i].join('+')} の 3D が描けている（輝度の分散 ${Math.round(v)}）`)
  }
  console.log(`     ${bname}: fps ${(await host.evaluate(() => window.__tx.fps())).toFixed(1)} 画質 ${await host.evaluate(() => window.__tx.tier())}（headless・3人同時・参考値）`)
  for (let i = 0; i < 3; i++) await fits([host, g1, g2][i], `${bname}: ゲーム中（${roles[i].join('+')}）`, `${bname}-game-${roles[i].join('+')}`)
  await g1.waitForFunction(() => window.__taxi.st === 'end', null, { timeout: 30000 })
  const ban = await g1.evaluate(() => { const b = document.querySelector('#t-banner'); return b && !b.hidden ? b.textContent : '' })
  check(/営業終了|廃車/.test(ban), `${bname}: 終わると帯が出て余韻がある（${ban}）`)
  await shot(g1, 'end')
  await g1.waitForSelector('#result:not([hidden])', { timeout: 30000 })
  const title = await g1.textContent('#resultTitle')
  check(['営業成功', '売上不足', '廃車'].includes(title), `${bname}: 結果画面が出る（${title}）`)
  check(/円/.test(await g1.textContent('.yen-big')) && await g1.locator('.rank').count() === 1, `${bname}: 結果にランクと売上が出る`)
  await g1.waitForTimeout(1300)
  const shown = await g1.textContent('.yen-big'), real = await g1.evaluate(() => window.__lastResult?.score)
  check(shown === real.toLocaleString('ja-JP') + '円', `${bname}: 売上の数え上げが本当の売上で止まる（${shown} / ${real}）`)
  await shot(g1, 'result')
  await host.waitForSelector('#result:not([hidden])')
  await fits(host, `${bname}: 結果`, `${bname}-result`)
  await fits(g2, `${bname}: 結果（参加者）`)
  const rec = await g1.evaluate(() => JSON.parse(localStorage.getItem('taxi-rec')))
  check(rec && rec.plays === 1 && rec.best.minato, `${bname}: 記録が端末に残る（${JSON.stringify(rec && { plays: rec.plays, best: rec.best })}）`)
  check(await g1.isHidden('#rematchBtn'), `${bname}: 再戦ボタンはホストだけ`)
  await host.click('#rematchBtn')
  for (const p of [g1, g2]) await p.waitForSelector('#game:not([hidden])')
  await g1.waitForFunction(() => window.__taxi && window.__taxi.st === 'ready')
  check(true, `${bname}: 再戦できる（新しいカウントダウン）`)
  const rec2 = await g1.evaluate(() => JSON.parse(localStorage.getItem('taxi-rec')))
  check(rec2.plays === 1, `${bname}: 結果画面が何度描き直されても記録は1回だけ（${rec2.plays}回）`)
  check(errors.length === 0, `${bname}: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}

// 1人で遊ぶ（全部の担当を1人が持つ）。キーボードでも動く
{
  const browser = await chromium.launch(GPU)
  const errors = []
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const p = await ctx.newPage(); watch(p, errors)
  await p.goto(base); await p.fill('#name', 'ソロ'); await p.click('#createBtn'); await p.waitForSelector('#lobby:not([hidden])')
  await p.click('#startBtn')
  await p.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 8000 })
  check((await p.locator('[data-key]').count()) === 4, 'ソロ: 4つの操作ボタンが全部出る')
  check((await p.locator('[data-call]').count()) === 0 && (await p.locator('#t-calm').count()) === 1, 'ソロ: 掛け声ボタンは出ず、なだめるは出る')
  check(await p.locator('#t-mini').count() === 1, 'ソロ: ナビを兼ねるので右上に小さな地図が出る')
  const x0 = await p.evaluate(() => window.__taxi.car.x)
  await p.keyboard.down('ArrowUp'); await p.waitForTimeout(1000); await p.keyboard.up('ArrowUp')
  await p.waitForTimeout(300)
  const x1 = await p.evaluate(() => window.__taxi.car.x)
  check(x1 > x0 + 1, `ソロ: キーボードの上矢印で進む（x ${x0} → ${x1}）`)
  await p.waitForTimeout(400)
  check(!(await p.evaluate(() => window.__taxi.inp.accel)), 'ソロ: キーを離すとアクセルが切れる（キーボードは押している間だけ）')
  await p.screenshot({ path: `${SHOTS}solo-game.png` })
  await fits(p, 'ソロ: ゲーム中', 'solo-game')
  check(errors.length === 0, `ソロ: コンソールエラー0件 ${errors.join(' / ')}`)
  await browser.close()
}
// WebGL が使えない端末の代わり（?2d）: 2D で描いて遊べる
{
  const browser = await webkit.launch()
  const errors = []
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, deviceScaleFactor: 2 })
  const p = await ctx.newPage(); watch(p, errors)
  await p.goto(base + '/?2d'); await p.fill('#name', '2D'); await p.click('#createBtn'); await p.waitForSelector('#lobby:not([hidden])')
  await p.click('#startBtn')
  await p.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 8000 })
  await p.waitForTimeout(500)
  const r = await p.evaluate(() => {
    const c = document.querySelector('#t-cv'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data
    let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { const l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += l; s2 += l * l; n++ }
    const m = s / n; return { mode: window.__tx.mode(), v: Math.round(s2 / n - m * m) }
  })
  check(r.mode === '2d' && r.v > 50, `2D: 3D が無いときは 2D で描ける（${r.mode} 輝度の分散 ${r.v}）`)
  await p.screenshot({ path: `${SHOTS}fallback-2d.png` })
  check(errors.length === 0, `2D: コンソールエラー0件 ${errors.join(' / ')}`)
  await browser.close()
}
// 6人（最大）: ハンドルが左右に分かれ、全員の画面が一画面に収まる
{
  const browser = await webkit.launch()
  const errors = []
  const pages = []
  for (let i = 0; i < 6; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, deviceScaleFactor: 2 })
    const p = await ctx.newPage(); watch(p, errors); pages.push(p)
  }
  await pages[0].goto(base); await pages[0].fill('#name', 'P1'); await pages[0].click('#createBtn'); await pages[0].waitForSelector('#lobby:not([hidden])')
  const invite = await pages[0].inputValue('#invite')
  for (let i = 1; i < 6; i++) { await pages[i].goto(invite); await pages[i].fill('#name', 'なかまのなまえ' + i); await pages[i].click('#joinBtn'); await pages[i].waitForSelector('#lobby:not([hidden])') }
  await pages[0].waitForFunction(() => document.querySelectorAll('#players li').length === 6)
  await fits(pages[0], '6人: ロビー', 'six-lobby')
  await pages[0].click('#startBtn')
  for (const p of pages) await p.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 10000 })
  const roles = await Promise.all(pages.map(p => p.evaluate(() => window.__taxi.me.join('+'))))
  check(roles.includes('wheelL') && roles.includes('wheelR') && roles.every(r => !r.includes('+')), `6人: 1人1役でハンドルは左右に分かれる ${roles.join(' / ')}`)
  const L = pages[roles.indexOf('wheelL')]
  check((await L.locator('[data-key]').count()) === 1 && (await L.locator('[data-key="left"]').count()) === 1, '6人: ハンドル左は左ボタンだけ')
  for (let i = 0; i < 6; i++) await fits(pages[i], `6人: ${roles[i]}`, `six-${roles[i]}`)
  await pages[0].waitForSelector('#result:not([hidden])', { timeout: 40000 })
  await fits(pages[0], '6人: 結果', 'six-result')
  check(errors.length === 0, `6人: コンソールエラー0件 ${errors.join(' / ')}`)
  await browser.close()
}
await srv.close()
console.log(fail ? `NG ${fail}/${total}件` : `すべてOK（${total}項目）`)
process.exit(fail ? 1 : 0)
