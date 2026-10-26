// OGP 画像（public/og.png, 1200x630）を作る。使い方: node tools/make-og.mjs
// 1) サーバーを立てて1人で下町を走り出し、3D の画面だけを撮る（HUD は隠す）
// 2) その上にタイトルのロゴ（index.html と同じ SVG）と一言を重ねる
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { startServer } from '../server.mjs'

const OUT = new URL('../public/og.png', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const h = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1.5, locale: 'ja-JP' })).newPage()
await h.goto(base); await h.fill('#name', 'たろう'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
for (let i = 0; i < 4 && await h.getAttribute('#mapPick .pk-body', 'data-id') !== (process.env.MAP || 'neon'); i++) await h.click('#mapPick .pk-btn[data-d="1"]')
await h.click('#startBtn')
await h.waitForFunction(() => window.__taxi && window.__taxi.st === 'drive', null, { timeout: 10000 })
await h.keyboard.down('ArrowUp'); await h.waitForTimeout(650); await h.keyboard.up('ArrowUp')
await h.keyboard.down('ArrowRight'); await h.waitForTimeout(120); await h.keyboard.up('ArrowRight')
await h.waitForTimeout(150)
await h.evaluate(() => window.__tx.fx({ k: 'deliver', name: '受験生', kind: 'hurry', stars: 5, yen: 1340, note: '' }))
await h.waitForTimeout(260)
await h.addStyleTag({ content: '.hud-top,.hud-sub,.dash,.mini,.dock,.pops,.banner,#quitBtn,.callbox,.labels{display:none!important}' })
await h.waitForTimeout(60)
const shot = await h.locator('#t-wrap').screenshot()
const bg = 'data:image/png;base64,' + shot.toString('base64')
const logo = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).match(/<svg class="logo-svg"[\s\S]*?<\/svg>/)[0]
const og = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage()
await og.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=M+PLUS+Rounded+1c:wght@900&display=swap"><style>
  body{margin:0;width:1200px;height:630px;position:relative;overflow:hidden;font-family:"M PLUS Rounded 1c",sans-serif}
  .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,8,32,.75),rgba(11,8,32,.15) 55%,transparent)}
  .logo{position:absolute;left:10px;top:20px;width:600px;filter:drop-shadow(0 8px 0 rgba(0,0,0,.35))}
  .logo svg{width:100%;height:auto}
  .hand{position:absolute;margin:0;font-family:"Dela Gothic One",sans-serif;color:#fff;font-size:38px;line-height:1.3;transform:rotate(-3deg);text-shadow:3px 0 0 #14110c,-3px 0 0 #14110c,0 3px 0 #14110c,0 -3px 0 #14110c,2px 2px 0 #14110c,-2px 2px 0 #14110c,2px -2px 0 #14110c,-2px -2px 0 #14110c}
  .roles{position:absolute;left:40px;bottom:36px;display:flex;gap:10px}
  .roles span{font-family:"Dela Gothic One",sans-serif;font-size:26px;padding:6px 16px;border-radius:99px;border:4px solid #14110c;box-shadow:0 5px 0 #14110c}
</style></head><body><img class="bg" src="${bg}"><div class="shade"></div><div class="logo">${logo}</div>
<p class="hand" style="left:46px;top:330px;color:#ffcf3a">1台をみんなで運転！</p>
<p class="hand" style="left:46px;top:384px;font-size:30px">声をかけ合わないと曲がれない</p>
<div class="roles"><span style="background:#ffcf3a">ハンドル</span><span style="background:#2fcf7f">エンジン</span><span style="background:#5ad1ff">ナビ</span><span style="background:#ff8ab0">見張り</span><span style="background:#c79bff">接客</span></div>
</body></html>`)
await og.waitForLoadState('networkidle').catch(() => {})
await og.evaluate(() => document.fonts.ready)
await og.screenshot({ path: OUT })
await b.close(); await srv.close()
console.log('public/og.png')
