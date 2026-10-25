// OGP画像（public/og.png 1200x630）を SVG から作る。使い方: node tools/make-og.mjs
import { chromium } from 'playwright'
const roles = ['ハンドル', 'エンジン', 'ナビ', '見張り', '接客']
const windows = []
for (let i = 6; i < 10; i++) for (let j = 0; j < 5; j++) if ((i * 7 + j * 3) % 5 < 3) windows.push(`<rect x="${40 + i * 120 + (j % 2) * 30}" y="${30 + j * 34}" width="16" height="16" fill="#ffd56a" opacity="${0.5 + ((i + j) % 3) * 0.2}"/>`)
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}svg{display:block}</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="beam" cx="0" cy="0.5" r="1"><stop offset="0" stop-color="#fffbe0" stop-opacity=".55"/><stop offset="1" stop-color="#fffbe0" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#14161c"/>
  <rect x="0" y="0" width="1200" height="230" fill="#2a2640"/>
  ${windows.join('')}
  <rect x="0" y="230" width="1200" height="300" fill="#2b2f3a"/>
  <path d="M0 380H1200" stroke="#c9b45a" stroke-width="6" stroke-dasharray="40 34"/>
  <rect x="0" y="530" width="1200" height="100" fill="#1f2230"/>
  <path d="M690 330 L1200 220 L1200 520 Z" fill="url(#beam)"/>
  <g transform="translate(430 270) rotate(-5)">
    <rect x="0" y="40" width="270" height="90" rx="24" fill="#ffcf3a"/>
    <rect x="60" y="0" width="140" height="56" rx="16" fill="#ffcf3a"/>
    <rect x="72" y="10" width="54" height="36" rx="6" fill="#1b2230"/><rect x="134" y="10" width="54" height="36" rx="6" fill="#1b2230"/>
    <rect x="95" y="-26" width="70" height="26" rx="6" fill="#fff7d6"/><text x="130" y="-7" font-size="18" font-weight="900" text-anchor="middle" fill="#1a1400" font-family="Hiragino Sans, sans-serif">TAXI</text>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="${30 + i * 18}" y="80" width="18" height="14" fill="${i % 2 ? '#1a1400' : '#fff7d6'}"/>`).join('')}
    <circle cx="62" cy="130" r="24" fill="#0b0d12"/><circle cx="210" cy="130" r="24" fill="#0b0d12"/>
    <rect x="258" y="60" width="14" height="18" rx="3" fill="#fffbe0"/>
  </g>
  <path d="M400 330h-120M390 370H220M405 410H300" stroke="#9aa3b2" stroke-width="10" stroke-linecap="round" opacity=".7"/>
  <g transform="translate(980 420)"><path d="M0 -34 26 18H-26Z" fill="#ff7a1a"/><rect x="-14" y="-6" width="28" height="8" fill="#fff"/></g>
  <text x="60" y="118" font-size="104" font-weight="900" fill="#fff" font-family="Hiragino Sans, sans-serif" letter-spacing="4">暴走タクシー</text>
  <text x="64" y="186" font-size="38" font-weight="700" fill="#ffcf3a" font-family="Hiragino Sans, sans-serif">みんなで1台を運転する協力ゲーム</text>
  ${roles.map((r, i) => `<g transform="translate(${60 + i * 216} 552)"><rect width="196" height="56" rx="28" fill="#14161c" stroke="#ffcf3a" stroke-width="3"/><text x="98" y="38" font-size="28" font-weight="800" text-anchor="middle" fill="#fff" font-family="Hiragino Sans, sans-serif">${r}</text></g>`).join('')}
</svg></body></html>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 630 } })
await p.setContent(html)
await p.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname })
await b.close()
console.log('public/og.png')
