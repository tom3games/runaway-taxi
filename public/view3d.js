// ゲーム中の 3D 描画（Three.js）。動きの計算はサーバーがするので、ここは届いた位置を立体で見せるだけ。
// 地図の座標（x 右、y 下）を 3D では x → x、y → z に置き換える。1マス = 1。
// カメラは運転する人ならタクシーの後ろ上から前を見る追いかけ視点（車の前＝画面の奥。左右ボタンと画面の左右が一致する）。
// ナビだけの人は街全体を斜め上から見下ろす（北が奥）。
// カメラとタクシーの間にある建物は切り取って、角を曲がるときも車が隠れないようにする。
import * as THREE from './vendor/three.module.js'
import { W, H, tileOf, lightAt, getMap, ROAD_PAIRS, blockCenter } from './map.js'

const THEMES = {
  shitamachi: {
    skyTop: 0x070b24, skyHor: 0x3a2a55, fog: 0x1b1630, hemiSky: 0x7f88c8, hemiGround: 0x3a2a24, moon: 0xcfd8ff,
    road: '#2c2f38', walk: '#4b4652', grass: '#24502f', grass2: '#2f6a3c', line: '#d9c25a',
    walls: [0x6b5a4a, 0x7a4a3a, 0x5a5466, 0x80705a], roof: 0x2b2a33, win: ['#ffcf6a', '#ffb24a', '#ffe9a8'], winOff: '#2a2433',
    lamp: 0xffc070, accent: 0xff5a2a, floors: [[1.1, 2], [1.5, 3], [1.9, 4], [2.5, 5]], pitched: true
  },
  minato: {
    skyTop: 0x0a1630, skyHor: 0x5a3f6a, fog: 0x283550, hemiSky: 0x8aa0d8, hemiGround: 0x2a2a3a, moon: 0xe8eeff,
    road: '#2a2e36', walk: '#5a5050', grass: '#24502f', grass2: '#2f6a3c', line: '#e0d080',
    walls: [0x8a4a34, 0x9a5a3e, 0x56606e, 0x6e7884], roof: 0x30343c, win: ['#ffe3a0', '#fff0c8', '#ffd080'], winOff: '#2c2a36',
    lamp: 0xfff0c0, accent: 0x5ad1ff, floors: [[1.4, 3], [1.9, 4], [2.4, 5], [3.0, 6]]
  },
  neon: {
    skyTop: 0x05030c, skyHor: 0x3a1048, fog: 0x1c0c28, hemiSky: 0x8a70c8, hemiGround: 0x2a1030, moon: 0xffd0f0,
    road: '#24232c', walk: '#3c3446', grass: '#264a3a', grass2: '#2f5e48', line: '#ff6ad0',
    walls: [0x2a2540, 0x24304a, 0x3a2438, 0x30303c], roof: 0x1c1a24, win: ['#9be7ff', '#ff9be0', '#fff59b', '#b4ffd0'], winOff: '#1c1828',
    lamp: 0xff7ae0, accent: 0xff3fa4, floors: [[2.0, 4], [2.8, 6], [3.6, 7], [4.6, 8]], neon: [0xff3fa4, 0x3ff0ff, 0xfff03f, 0x9b6cff, 0x5aff8a]
  }
}

// お客さんの見た目（髪・帽子・服の色）
const PAX_LOOK = {
  hurry: { hair: 0x1b1b22, cloth: 0x24305a, hat: 'cap', hatColor: 0x111118 },
  gentle: { hair: 0xc8c8d0, cloth: 0x8a5ab0, hat: 'bun' },
  tour: { hair: 0x8a5a2a, cloth: 0x2fb0a0, hat: 'straw', hatColor: 0xe8d090 },
  kid: { hair: 0x3a2a1a, cloth: 0xffc83a, hat: 'cap', hatColor: 0xe0302a },
  queasy: { hair: 0x2a2a2a, cloth: 0x4a5a70, hat: 'tie', hatColor: 0xd0302a, blush: true },
  vip: { hair: 0x101010, cloth: 0x30302a, hat: 'slick', mustache: true },
  mama: { hair: 0x5a3020, cloth: 0xff9ac0, hat: 'bun' },
  ghost: { hair: 0x101010, cloth: 0xf4f8ff, hat: 'ghost', ghost: true },
  walker: { hair: 0x3a2a1a, cloth: 0x5ad1ff, hat: 'none' }
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z)
const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295 }
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra })
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra })
let gradTex = null
function toon(color, extra = {}) {
  if (!gradTex) {
    gradTex = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat)
    gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...extra })
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}
const FONT = '"Dela Gothic One","M PLUS Rounded 1c","Hiragino Sans","Noto Sans JP",sans-serif'

function textTex(text, { w = 256, h = 72, bg = '#14161c', fg = '#ffcf3a', border = null, size = 46 } = {}) {
  return canvasTex(w, h, g => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h)
    if (border) { g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6) }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'
    let s = size
    g.font = `400 ${s}px ${FONT}`
    while (g.measureText(text).width > w * 0.88 && s > 12) { s -= 2; g.font = `400 ${s}px ${FONT}` }
    g.fillText(text, w / 2, h / 2 + 3)
  })
}

// 顔（機嫌 0..4、驚き 5、幽霊は青白い）
function faceTex(kind, mood) {
  const look = PAX_LOOK[kind] || PAX_LOOK.walker
  return canvasTex(128, 128, g => {
    g.fillStyle = look.ghost ? '#e8f0ff' : '#ffd9b3'
    g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill()
    g.strokeStyle = '#1b130d'; g.fillStyle = '#1b130d'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'
    const eye = (x, y, r = 8) => { g.beginPath(); g.ellipse(x, y, r * 0.8, r, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 2, y - 3, r * 0.3, 0, 7); g.fill(); g.fillStyle = '#1b130d' }
    if (look.ghost) {
      g.lineWidth = 5; g.beginPath(); g.moveTo(32, 56); g.lineTo(54, 60); g.moveTo(96, 56); g.lineTo(74, 60); g.stroke()
      g.fillStyle = '#5a6a9a'; g.beginPath(); g.ellipse(64, 92, 10, 14, 0, 0, 7); g.fill()
      g.strokeStyle = '#7a8acc'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(30 + i * 8, 18); g.lineTo(30 + i * 8, 40); g.stroke() }
      return
    }
    if (mood === 5) { // 驚き
      g.lineWidth = 5; g.beginPath(); g.arc(42, 54, 11, 0, 7); g.stroke(); g.beginPath(); g.arc(86, 54, 11, 0, 7); g.stroke()
      g.beginPath(); g.arc(42, 54, 4, 0, 7); g.arc(86, 54, 4, 0, 7); g.fill()
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.ellipse(64, 94, 13, 17, 0, 0, 7); g.fill()
    } else if (mood === 0) { // 激怒
      g.beginPath(); g.moveTo(28, 36); g.lineTo(54, 50); g.moveTo(100, 36); g.lineTo(74, 50); g.stroke()
      eye(44, 60, 7); eye(84, 60, 7)
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.moveTo(40, 100); g.quadraticCurveTo(64, 76, 88, 100); g.closePath(); g.fill()
      g.fillStyle = '#fff'; g.fillRect(48, 90, 32, 6)
    } else if (mood === 1) { // 不機嫌
      g.beginPath(); g.moveTo(30, 44); g.lineTo(54, 48); g.moveTo(98, 44); g.lineTo(74, 48); g.stroke()
      eye(44, 62, 7); eye(84, 62, 7)
      g.beginPath(); g.arc(64, 106, 14, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke()
      g.fillStyle = '#7fd3ff'; g.beginPath(); g.moveTo(108, 26); g.quadraticCurveTo(120, 46, 108, 50); g.quadraticCurveTo(96, 46, 108, 26); g.fill()
    } else if (mood === 2) {
      eye(44, 60); eye(84, 60)
      g.beginPath(); g.moveTo(48, 90); g.lineTo(80, 90); g.stroke()
    } else if (mood === 3) {
      eye(44, 60); eye(84, 60)
      g.beginPath(); g.arc(64, 78, 14, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke()
    } else { // 大満足
      g.beginPath(); g.arc(42, 62, 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke()
      g.beginPath(); g.arc(86, 62, 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke()
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.arc(64, 80, 20, 0, Math.PI); g.closePath(); g.fill(); g.stroke()
    }
    if (look.mustache) { g.fillStyle = '#1b130d'; g.beginPath(); g.ellipse(52, 80, 14, 6, 0.3, 0, 7); g.ellipse(76, 80, 14, 6, -0.3, 0, 7); g.fill() }
    g.fillStyle = look.blush ? 'rgba(255,60,60,.65)' : 'rgba(255,110,110,.45)'
    g.beginPath(); g.ellipse(26, 82, 12, 8, 0, 0, 7); g.ellipse(102, 82, 12, 8, 0, 0, 7); g.fill()
  })
}

// 頭の上に出す記号（怒り・汗・ハート・星・火の玉）
function iconTex(kind) {
  return canvasTex(64, 64, g => {
    g.lineCap = 'round'; g.lineJoin = 'round'
    if (kind === 'anger') {
      g.strokeStyle = '#ff2a2a'; g.lineWidth = 7
      for (const [a, b] of [[[14, 24], [26, 24]], [[26, 12], [26, 24]], [[38, 12], [38, 24]], [[38, 24], [50, 24]], [[14, 40], [26, 40]], [[26, 40], [26, 52]], [[38, 40], [50, 40]], [[38, 40], [38, 52]]]) { g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke() }
    } else if (kind === 'heart') {
      g.fillStyle = '#ff5aa0'; g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 34, 10, 8, 32, 22); g.bezierCurveTo(54, 8, 60, 34, 32, 54); g.fill()
    } else if (kind === 'sweat') {
      g.fillStyle = '#7fd3ff'; g.beginPath(); g.moveTo(32, 6); g.quadraticCurveTo(54, 40, 32, 56); g.quadraticCurveTo(10, 40, 32, 6); g.fill()
    } else if (kind === 'star') {
      g.fillStyle = '#ffe14a'; g.strokeStyle = '#7a5a00'; g.lineWidth = 3; g.beginPath()
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 12 : 28, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r) }
      g.closePath(); g.fill(); g.stroke()
    } else if (kind === 'flame') {
      const gr = g.createRadialGradient(32, 38, 2, 32, 38, 26); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#8ad8ff'); gr.addColorStop(1, 'rgba(40,120,255,0)')
      g.fillStyle = gr; g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(60, 40, 32, 60); g.quadraticCurveTo(4, 40, 32, 4); g.fill()
    } else if (kind === 'glow') {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
    } else if (kind === 'ring') {
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(32, 32, 26, 0, 7); g.stroke()
    }
  })
}

// 窓の明かり（8階ぶん x 3列）。同じ絵を繰り返すので、階ごとに点き方を変えておく
function windowTex(theme, lit = 0.55) {
  return canvasTex(96, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
    for (let f = 0; f < 8; f++) for (let c = 0; c < 3; c++) {
      const on = hash(f, c, 7) < lit
      g.fillStyle = on ? theme.win[Math.floor(hash(c, f, 3) * theme.win.length)] : '#000'
      g.fillRect(8 + c * 30, 6 + f * 32, 20, 18)
    }
  })
}
function facadeTex(theme) {
  return canvasTex(96, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h)
    for (let f = 0; f < 8; f++) {
      g.fillStyle = '#d0d0d8'; g.fillRect(0, f * 32 + 28, w, 4)
      for (let c = 0; c < 3; c++) { g.fillStyle = theme.winOff; g.fillRect(8 + c * 30, 6 + f * 32, 20, 18) }
    }
  })
}

// ---- 人（ちびキャラ）
function makePerson(kind, faceMat) {
  const look = PAX_LOOK[kind] || PAX_LOOK.walker
  const g = new THREE.Group()
  const cloth = toon(look.cloth, look.ghost ? { transparent: true, opacity: 0.75 } : {})
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, look.ghost ? 0.02 : 0.09, 0.2, 10), cloth); body.position.y = 0.12; g.add(body)
  const head = new THREE.Group(); head.position.y = 0.32; g.add(head)
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), toon(look.ghost ? 0xe8f0ff : 0xffd9b3)))
  addHair(head, look)
  const face = new THREE.Sprite(faceMat); face.scale.set(0.22, 0.22, 1); face.position.set(0, 0, 0.0); face.renderOrder = 3; head.add(face)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.035), cloth); arm.position.set(0.09, 0.22, 0); arm.geometry.translate(0, 0.07, 0); g.add(arm)
  g.userData = { head, face, arm, body }
  return g
}
function addHair(head, look) {
  const hair = toon(look.hair)
  if (look.hat === 'ghost') { // 三角の布
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 3), toon(0xffffff)); tri.position.set(0, 0.1, 0.06); tri.rotation.x = 0.3; head.add(tri)
    return
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair); cap.position.y = 0.01; head.add(cap)
  if (look.hat === 'cap') {
    const c = toon(look.hatColor)
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), c); top.position.y = 0.025; head.add(top)
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.09), c); brim.position.set(0, 0.06, 0.11); head.add(brim)
  } else if (look.hat === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), hair); bun.position.set(0, 0.13, -0.02); head.add(bun)
  } else if (look.hat === 'straw') {
    const c = toon(look.hatColor)
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 18), c); brim.position.y = 0.07; head.add(brim)
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.07, 14), c); top.position.y = 0.1; head.add(top)
  } else if (look.hat === 'tie') { // 頭にネクタイ（酔っぱらい）
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.012, 6, 18), toon(look.hatColor)); t.rotation.x = Math.PI / 2; t.position.y = 0.04; head.add(t)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.01), toon(look.hatColor)); tail.position.set(0.1, 0.0, -0.06); tail.rotation.z = 0.6; head.add(tail)
  } else if (look.hat === 'slick') {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.16), hair); s.position.set(0, 0.1, 0); head.add(s)
  }
}

// ---- タクシー
function makeTaxi() {
  const g = new THREE.Group()
  const body = new THREE.Group(); g.add(body)
  const yellow = toon(0xffcf3a, { emissive: 0x8a6000 }) // 夜でも黄色に見えるよう少し自ら光らせる
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.17, 0.46), yellow); lower.position.y = 0.17; lower.castShadow = true; body.add(lower)
  const checker = canvasTex(64, 8, g2 => { for (let i = 0; i < 16; i++) { g2.fillStyle = i % 2 ? '#111' : '#fff'; g2.fillRect(i * 4, (i % 2) * 4, 4, 4); g2.fillStyle = i % 2 ? '#fff' : '#111'; g2.fillRect(i * 4, ((i + 1) % 2) * 4, 4, 4) } })
  checker.wrapS = THREE.RepeatWrapping; checker.repeat.set(3, 1); checker.magFilter = THREE.NearestFilter
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.825, 0.04, 0.465), basic(0xffffff, { map: checker })); band.position.y = 0.2; body.add(band)
  const glass = lam(0x1a2a44, { emissive: 0x0a1424 })
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, 0.42), glass); cabin.position.set(-0.05, 0.31, 0); body.add(cabin)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.42), yellow); roof.position.set(-0.05, 0.38, 0); roof.castShadow = true; body.add(roof)
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.425), yellow); pillar.position.set(-0.05, 0.31, 0); body.add(pillar)
  const signMat = basic(0xffffff, { map: textTex('TAXI', { w: 128, h: 48, bg: '#fff7d6', fg: '#1a1400', size: 34 }) })
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.22), signMat); sign.position.set(-0.04, 0.43, 0); body.add(sign)
  const headMat = basic(0xfffbe0), tailMat = basic(0x7a1010), blinkMat = basic(0x5a3000)
  for (const z of [-0.15, 0.15]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.09), headMat); h.position.set(0.415, 0.18, z); body.add(h)
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), tailMat); t.position.set(-0.415, 0.18, z); body.add(t)
  }
  const blinkL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), blinkMat.clone()), blinkR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), blinkMat.clone())
  blinkL.position.set(0.39, 0.22, -0.22); blinkR.position.set(0.39, 0.22, 0.22); body.add(blinkL, blinkR)
  const blinkL2 = new THREE.Mesh(blinkL.geometry, blinkL.material), blinkR2 = new THREE.Mesh(blinkR.geometry, blinkR.material)
  blinkL2.position.set(-0.39, 0.22, -0.22); blinkR2.position.set(-0.39, 0.22, 0.22); body.add(blinkL2, blinkR2)
  // ヘッドライトの光の帯（地面に落ちる光。ライトの計算が重い端末でも前が明るく見える）
  const beamTex = canvasTex(64, 128, (g2, w, h) => { const gr = g2.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,245,200,.55)'); gr.addColorStop(1, 'rgba(255,245,200,0)'); g2.fillStyle = gr; g2.beginPath(); g2.moveTo(w * 0.4, h); g2.lineTo(w * 0.6, h); g2.lineTo(w, 0); g2.lineTo(0, 0); g2.fill() })
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.2), basic(0xffffff, { map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  beam.rotation.x = -Math.PI / 2; beam.rotation.z = -Math.PI / 2; beam.position.set(2.45, 0.02, 0); g.add(beam)
  const wheels = []
  const tire = toon(0x15161a), hub = toon(0xd0d4dc)
  for (const [x, z] of [[0.26, -0.22], [0.26, 0.22], [-0.26, -0.22], [-0.26, 0.22]]) {
    const pv = new THREE.Group(); pv.position.set(x, 0.1, z); g.add(pv)
    const w = new THREE.Group(); pv.add(w)
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 14), tire); t.rotation.x = Math.PI / 2; w.add(t)
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.075), hub); w.add(hb)
    wheels.push({ pv, w, front: x > 0 })
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.62), basic(0x000000, { transparent: true, opacity: 0.4, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.011; g.add(shadow)
  g.userData = { body, wheels, tailMat, headMat, blink: [blinkL.material, blinkR.material], sign, signMat, beam, roof, lower, cabin }
  return g
}

function makeNpcCar(color) {
  const g = new THREE.Group()
  const paint = toon(color)
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.17, 0.44), paint); lower.position.y = 0.16; lower.castShadow = true; g.add(lower)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), lam(0x18243a, { emissive: 0x080c18 })); cab.position.set(-0.04, 0.3, 0); g.add(cab)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.4), paint); roof.position.set(-0.04, 0.37, 0); g.add(roof)
  const hl = basic(0xfffbe0), tl = basic(0xff3030)
  for (const z of [-0.14, 0.14]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), hl); h.position.set(0.385, 0.17, z); g.add(h)
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), tl); t.position.set(-0.385, 0.17, z); g.add(t)
  }
  const tire = toon(0x15161a)
  for (const [x, z] of [[0.24, -0.21], [0.24, 0.21], [-0.24, -0.21], [-0.24, 0.21]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), tire); t.rotation.x = Math.PI / 2; t.position.set(x, 0.09, z); g.add(t) }
  const glowTex = iconTex('glow')
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), basic(0xfff0c0, { map: glowTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
  glow.rotation.x = -Math.PI / 2; glow.position.set(1.0, 0.015, 0); g.add(glow)
  return g
}

function makeCat() {
  const g = new THREE.Group()
  const fur = toon(0xf0e6d2), dark = toon(0x8a6a4a)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), fur); body.scale.set(1.6, 0.9, 1); body.position.y = 0.11; g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), fur); head.position.set(0.15, 0.17, 0); g.add(head)
  for (const z of [-0.04, 0.04]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), dark); ear.position.set(0.15, 0.25, z); g.add(ear)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), basic(0x9dff6a)); eye.position.set(0.215, 0.18, z * 0.8); g.add(eye)
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.2, 6), dark); tail.position.set(-0.17, 0.2, 0); tail.rotation.z = 0.7; g.add(tail)
  for (const [x, z] of [[0.08, -0.05], [0.08, 0.05], [-0.08, -0.05], [-0.08, 0.05]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 6), fur); l.position.set(x, 0.04, z); g.add(l) }
  g.userData = { body, tail }
  return g
}

function makeCone() {
  const g = new THREE.Group()
  const o = toon(0xff7a1a)
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 12), o); c.position.y = 0.17; g.add(c)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.05, 12), toon(0xffffff)); band.position.y = 0.17; g.add(band)
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.24), o); base.position.y = 0.015; g.add(base)
  return g
}

// カメラとタクシーを結ぶ線の近くにある建物の壁を切り取る（角を曲がっても車が隠れない）
function addCut(mat, cutU) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCam = cutU.cam; sh.uniforms.uCar = cutU.car; sh.uniforms.uCutOn = cutU.on
    sh.vertexShader = 'varying vec3 vCutW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vec4 cutw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  cutw = instanceMatrix * cutw;
  #endif
  vCutW = (modelMatrix * cutw).xyz;`)
    sh.fragmentShader = 'uniform vec2 uCam;\nuniform vec2 uCar;\nuniform float uCutOn;\nvarying vec3 vCutW;\n' + sh.fragmentShader.replace('void main() {', `void main() {
  if (uCutOn > 0.5 && vCutW.y > 0.04) {
    vec2 ab = uCar - uCam; vec2 ap = vCutW.xz - uCam;
    float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    if (length(ap - ab * h) < 0.55 + 0.25 * h && h < 0.93) discard;
  }`)
  }
  mat.customProgramCacheKey = () => 'cut'
  return mat
}

export function createView3D(canvas, { map: mapId, mode = 'chase', look = false }) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !matchMedia('(pointer: coarse)').matches, powerPreference: 'high-performance' })
    if (!renderer.getContext()) throw new Error('no gl')
  } catch { return null }
  const map = getMap(mapId)
  const th = THEMES[map.theme] || THEMES.shitamachi
  const coarse = matchMedia('(pointer: coarse)').matches
  let tier = coarse ? 1 : 2 // 2=高 1=中 0=低。fps が出なければ下げる
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.type = THREE.PCFShadowMap
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(th.skyHor)
  scene.fog = new THREE.Fog(th.fog, 4, 14)
  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 200)
  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, 1.1); scene.add(hemi)
  const moon = new THREE.DirectionalLight(th.moon, 0.9)
  moon.shadow.camera.left = -7; moon.shadow.camera.right = 7; moon.shadow.camera.top = 7; moon.shadow.camera.bottom = -7
  moon.shadow.camera.near = 1; moon.shadow.camera.far = 40; moon.shadow.bias = -0.0015
  scene.add(moon); scene.add(moon.target)
  const head = new THREE.SpotLight(0xfff2cc, 28, 9, 0.62, 0.65, 1.3)
  scene.add(head); scene.add(head.target)
  const cutU = { cam: { value: new THREE.Vector2() }, car: { value: new THREE.Vector2() }, on: { value: 1 } }
  const T = (x, y) => tileOf(map, x + 0.5, y + 0.5)
  const solid = (x, y) => { const t = T(x, y); return t === 'B' || t === '#' }

  // ---- 空・月・星
  {
    const geo = new THREE.SphereGeometry(120, 24, 12)
    const top = new THREE.Color(th.skyTop), hor = new THREE.Color(th.skyHor), cols = []
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) { const k = Math.max(0, Math.min(1, pos.getY(i) / 60)); const c = hor.clone().lerp(top, Math.pow(k, 0.5)); cols.push(c.r, c.g, c.b) }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    const sky = new THREE.Mesh(geo, basic(0xffffff, { vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
    sky.position.set(W / 2, 0, H / 2); sky.renderOrder = -2; scene.add(sky)
    const n = map.theme === 'neon' ? 120 : 360, sp = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { const a = hash(i, 1) * Math.PI * 2, e = 0.15 + hash(i, 2) * 1.2; sp[i * 3] = W / 2 + Math.cos(a) * Math.cos(e) * 110; sp[i * 3 + 1] = Math.sin(e) * 110; sp[i * 3 + 2] = H / 2 + Math.sin(a) * Math.cos(e) * 110 }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })))
    const moonS = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, g => { const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, '#fffbe8'); gr.addColorStop(0.45, '#fff2c0'); gr.addColorStop(0.5, 'rgba(255,240,200,.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(200,190,150,.5)'; g.beginPath(); g.arc(54, 56, 7, 0, 7); g.arc(74, 72, 5, 0, 7); g.fill() }), fog: false, depthWrite: false }))
    moonS.scale.set(16, 16, 1); moonS.position.set(W / 2 - 40, 46, H / 2 - 80); scene.add(moonS)
  }

  // ---- 地面（地図の絵を1枚貼る）
  const PX = 40
  const groundTex = canvasTex(W * PX, H * PX, g => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = T(x, y), X = x * PX, Y = y * PX
      g.fillStyle = t === '.' ? th.road : t === 'g' ? th.grass : t === 'w' ? '#0c2238' : th.walk
      g.fillRect(X, Y, PX, PX)
      if (t === '.') { for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(255,255,255,${0.015 + hash(x, y, i) * 0.03})`; g.fillRect(X + hash(i, x, y) * PX, Y + hash(y, i, x) * PX, 3, 3) } }
      if (t === 'g' && (x + y) % 2 === 0) { g.fillStyle = th.grass2; g.beginPath(); g.arc(X + PX / 2, Y + PX / 2, PX * 0.3, 0, 7); g.fill() }
      if (t === 'B' || t === '#') { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(X + 4, Y + 4, PX - 8, PX - 8) }
    }
    // 縁石
    g.strokeStyle = 'rgba(200,200,210,.5)'; g.lineWidth = 3
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (T(x, y) !== '.') continue
      const X = x * PX, Y = y * PX
      g.beginPath()
      if (solid(x, y - 1)) { g.moveTo(X, Y + 1); g.lineTo(X + PX, Y + 1) }
      if (solid(x, y + 1)) { g.moveTo(X, Y + PX - 1); g.lineTo(X + PX, Y + PX - 1) }
      if (solid(x - 1, y)) { g.moveTo(X + 1, Y); g.lineTo(X + 1, Y + PX) }
      if (solid(x + 1, y)) { g.moveTo(X + PX - 1, Y); g.lineTo(X + PX - 1, Y + PX) }
      g.stroke()
    }
    // 中央線と横断歩道
    g.strokeStyle = th.line; g.lineWidth = 3; g.setLineDash([12, 14])
    const R = (x, y) => T(x, y) === '.'
    for (const p of ROAD_PAIRS) for (let i = 1; i < W - 1; i++) {
      if (R(i, p) && R(i, p + 1) && !(R(i, p - 1) && R(i, p + 2))) { g.beginPath(); g.moveTo(i * PX, (p + 1) * PX); g.lineTo((i + 1) * PX, (p + 1) * PX); g.stroke() }
      if (R(p, i) && R(p + 1, i) && !(R(p - 1, i) && R(p + 2, i))) { g.beginPath(); g.moveTo((p + 1) * PX, i * PX); g.lineTo((p + 1) * PX, (i + 1) * PX); g.stroke() }
    }
    g.setLineDash([])
    g.fillStyle = 'rgba(235,235,240,.55)'
    for (const ix of ROAD_PAIRS) for (const iy of ROAD_PAIRS) {
      if (!(R(ix, iy) && R(ix + 1, iy + 1))) continue
      const zebra = (x0, y0, horiz) => { for (let k = 0; k < 5; k++) horiz ? g.fillRect(x0 + 4 + k * 16, y0 + 6, 9, PX - 12) : g.fillRect(x0 + 6, y0 + 4 + k * 16, PX - 12, 9) }
      if (R(ix, iy - 1) && R(ix + 1, iy - 1)) zebra(ix * PX, (iy - 1) * PX, true)
      if (R(ix, iy + 2) && R(ix + 1, iy + 2)) zebra(ix * PX, (iy + 2) * PX, true)
      if (R(ix - 1, iy) && R(ix - 1, iy + 1)) zebra((ix - 1) * PX, iy * PX, false)
      if (R(ix + 2, iy) && R(ix + 2, iy + 1)) zebra((ix + 2) * PX, iy * PX, false)
    }
    // 乗り場の印
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 3; g.setLineDash([8, 6])
    for (const p of map.places) g.strokeRect((p.x - 0.42) * PX, (p.y - 0.42) * PX, 0.84 * PX, 0.84 * PX)
    g.setLineDash([])
    g.font = `400 ${PX * 0.26}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,255,255,.6)'
    for (const p of map.places) g.fillText('のりば', p.x * PX, p.y * PX)
    // 信号の停止線
    g.fillStyle = 'rgba(255,255,255,.75)'
    for (const l of map.lights) { g.fillRect((l.x - 1) * PX + PX - 6, l.y * PX, 5, PX * 2); g.fillRect((l.x + 2) * PX + 1, l.y * PX, 5, PX * 2); g.fillRect(l.x * PX, (l.y - 1) * PX + PX - 6, PX * 2, 5); g.fillRect(l.x * PX, (l.y + 2) * PX + 1, PX * 2, 5) }
  })
  groundTex.anisotropy = 4
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), lam(0xffffff, { map: groundTex }))
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true; scene.add(ground)
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), lam(new THREE.Color(th.walk).multiplyScalar(0.6)))
  outer.rotation.x = -Math.PI / 2; outer.position.set(W / 2, -0.02, H / 2); scene.add(outer)

  // 水（港町の川）
  let water = null
  if (map.tiles.some(r => r.includes('w'))) {
    const wt = canvasTex(128, 128, g => { g.fillStyle = '#123a5c'; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(160,210,255,.35)'; g.lineWidth = 2; for (let i = 0; i < 9; i++) { const y = hash(i, 4) * 128, x = hash(i, 5) * 128; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 4, x + 28, y); g.stroke() } })
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(12, 1)
    water = new THREE.Mesh(new THREE.PlaneGeometry(W - 2, 2), lam(0xffffff, { map: wt, emissive: 0x08203a }))
    water.rotation.x = -Math.PI / 2; water.position.set(W / 2, 0.012, 12); scene.add(water)
    // 橋の欄干
    const rail = toon(0xd8d0c0)
    for (const bx of [6, 16]) for (const x of [bx + 0.03, bx + 1.97]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 2.1), rail); r.position.set(x, 0.11, 12); scene.add(r) }
  }

  // ---- 建物（高さの種類ごとに InstancedMesh）
  const winT = windowTex(th), facT = facadeTex(th)
  const buildingMats = []
  const classes = th.floors.map(([h, floors]) => {
    const wt = winT.clone(); wt.needsUpdate = true; wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(1, floors / 8)
    const ft = facT.clone(); ft.needsUpdate = true; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(1, floors / 8)
    const side = addCut(lam(0xffffff, { map: ft, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: 1 }), cutU)
    const top = addCut(lam(th.roof), cutU)
    buildingMats.push(side, top)
    return { h, mats: [side, side, top, top, side, side], list: [] }
  })
  const bGeo = new THREE.BoxGeometry(1, 1, 1); bGeo.translate(0, 0.5, 0)
  const roofs = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!solid(x, y)) continue
    const edge = T(x, y) === '#'
    const ci = edge ? classes.length - 1 - Math.floor(hash(x, y, 9) * 2) : Math.floor(hash(Math.floor(x / 2), Math.floor(y / 2), 1) * classes.length * 0.999)
    const c = classes[Math.max(0, ci)]
    const ins = 0.07
    const ix0 = solid(x - 1, y) ? 0.02 : ins + 0.06, ix1 = solid(x + 1, y) ? 0.02 : ins + 0.06
    const iz0 = solid(x, y - 1) ? 0.02 : ins + 0.06, iz1 = solid(x, y + 1) ? 0.02 : ins + 0.06
    const sx = 1 - ix0 - ix1, sz = 1 - iz0 - iz1
    const hh = c.h * (0.85 + hash(x, y, 2) * 0.3)
    c.list.push([x + ix0 + sx / 2, z0(y) + iz0 + sz / 2, sx, hh, sz, hash(x, y, 5)])
    if (th.pitched && c.h < 2) roofs.push([x + 0.5, y + 0.5, hh, sx, sz])
  }
  function z0(y) { return y }
  const tint = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3()
  const buildingMeshes = []
  for (const c of classes) {
    if (!c.list.length) continue
    const im = new THREE.InstancedMesh(bGeo, c.mats, c.list.length)
    c.list.forEach(([x, z, sx, h, sz, r], i) => {
      m4.compose(ps.set(x, 0, z), q.identity(), sc.set(sx, h, sz)); im.setMatrixAt(i, m4)
      im.setColorAt(i, tint.setHex(th.walls[Math.floor(r * th.walls.length) % th.walls.length]))
    })
    im.castShadow = true; im.receiveShadow = true
    scene.add(im); buildingMeshes.push(im)
  }
  // 下町は瓦屋根（四角すい）
  if (roofs.length) {
    const rg = new THREE.ConeGeometry(0.72, 0.45, 4, 1); rg.rotateY(Math.PI / 4); rg.translate(0, 0.225, 0)
    const rm = addCut(lam(0x3a3a48), cutU); buildingMats.push(rm)
    const im = new THREE.InstancedMesh(rg, rm, roofs.length)
    roofs.forEach(([x, z, h, sx, sz], i) => { m4.compose(ps.set(x, h, z), q.identity(), sc.set(sx * 1.08, 1, sz * 1.08)); im.setMatrixAt(i, m4) })
    im.castShadow = true; scene.add(im); buildingMeshes.push(im)
  }
  // 遠くの街並み（地図の外の影絵）。地図の視点では手前に大きく映るので隠す
  let farCity = null
  {
    const n = 140, im = new THREE.InstancedMesh(bGeo, lam(0x14121c, { emissive: 0xffffff, emissiveMap: (() => { const t = winT.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return t })(), emissiveIntensity: 0.55 }), n)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 22 + hash(i, 3) * 16
      const h = 2 + hash(i, 4) * (map.theme === 'neon' ? 14 : 7)
      m4.compose(ps.set(W / 2 + Math.cos(a) * r, -0.02, H / 2 + Math.sin(a) * r), q.setFromAxisAngle(v3(0, 1, 0), -a), sc.set(2 + hash(i, 6) * 3, h, 2 + hash(i, 7) * 2)); im.setMatrixAt(i, m4)
    }
    scene.add(im); farCity = im
  }

  // ---- 看板（行き先の名前を建物の壁に）
  const signMats = []
  for (const p of map.places) {
    const dir = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[p.s]
    // 乗り場の反対側（区画側）の建物の壁に付ける。真後ろが路地なら横にずらす
    let wx = Math.floor(p.x) - dir[0], wy = Math.floor(p.y) - dir[1]
    for (const off of [0, 1, -1]) {
      const tx = wx + (dir[1] ? off : 0), ty = wy + (dir[0] ? off : 0)
      if (solid(tx, ty)) { wx = tx; wy = ty; break }
    }
    const mat = addCut(basic(0xffffff, { map: textTex(p.name, { bg: '#14161c', fg: th.win[0], border: '#' + new THREE.Color(th.accent).getHexString() }), fog: true }), cutU)
    signMats.push(mat)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.27), mat)
    const fx = wx + 0.5 + dir[0] * 0.52, fz = wy + 0.5 + dir[1] * 0.52
    m.position.set(fx, 0.85, fz)
    m.rotation.y = dir[0] === 1 ? Math.PI / 2 : dir[0] === -1 ? -Math.PI / 2 : dir[1] === 1 ? 0 : Math.PI
    scene.add(m)
  }

  // ---- 街灯（交差点ごとに1本）と光だまり
  const glowTex = iconTex('glow')
  {
    const pts = []
    for (const ix of ROAD_PAIRS) for (const iy of ROAD_PAIRS) if (T(ix, iy) === '.' && T(ix + 1, iy + 1) === '.' && solid(ix + 2, iy - 1)) pts.push([ix + 2 + 0.12, iy - 0.12])
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.03, 1.3, 6).translate(0, 0.65, 0), toon(0x3a3e48), pts.length)
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), basic(th.lamp), pts.length)
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), basic(th.lamp, { map: glowTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }), pts.length)
    pts.forEach(([x, z], i) => {
      m4.makeTranslation(x, 0, z); pole.setMatrixAt(i, m4)
      m4.makeTranslation(x - 0.18, 1.3, z + 0.18); bulb.setMatrixAt(i, m4)
      m4.makeTranslation(x - 0.5, 0.013, z + 0.5); pool.setMatrixAt(i, m4)
    })
    scene.add(pole, bulb, pool)
  }

  // ---- 街ごとの飾り
  const spinners = [], blinkers = [], farDeco = []
  const eff = { lanterns: null }
  if (map.theme === 'shitamachi') {
    // 提灯（区画の角）
    const pts = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T(x, y) === 'B' && hash(x, y, 11) < 0.35 && (!solid(x, y + 1) || !solid(x + 1, y))) pts.push([x + (solid(x + 1, y) ? 0.5 : 0.95), y + (solid(x, y + 1) ? 0.95 : 0.5)])
    const lan = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 10), basic(0xff6a3a), pts.length)
    pts.forEach(([x, z], i) => { m4.makeTranslation(x, 0.95, z); lan.setMatrixAt(i, m4) })
    scene.add(lan)
    // 遠くの五重塔
    const pag = new THREE.Group(); pag.position.set(-6, 0, -8)
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2 - i * 0.3, 1.1, 2.2 - i * 0.3), lam(0x3a2420, { emissive: 0x1a0804 })); b.position.y = 0.55 + i * 1.5; pag.add(b)
      const r = new THREE.Mesh(new THREE.ConeGeometry(2.3 - i * 0.3, 0.5, 4).rotateY(Math.PI / 4), lam(0x22222a)); r.position.y = 1.35 + i * 1.5; pag.add(r)
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), lam(0xc8a040)); top.position.y = 8.5; pag.add(top)
    scene.add(pag); farDeco.push(pag)
  } else if (map.theme === 'minato') {
    // 観覧車（東の沖）
    const wheel = new THREE.Group(); wheel.position.set(W + 9, 9, 12)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.12, 6, 48), basic(0x5ad1ff)); wheel.add(ring)
    const n = 18, lp = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 7, 0.06), lam(0x8a9ab0)); sp.rotation.z = a; sp.position.set(Math.cos(a + Math.PI / 2) * 3.5, Math.sin(a + Math.PI / 2) * 3.5, 0); wheel.add(sp)
      lp[i * 3] = Math.cos(a) * 7; lp[i * 3 + 1] = Math.sin(a) * 7
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3))
    wheel.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xffd0f0, size: 0.9, fog: false })))
    wheel.rotation.y = Math.PI / 2
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.2, 9, 0.2), lam(0x8a9ab0)); legs.position.set(W + 9, 4.5, 12); scene.add(legs)
    scene.add(wheel); spinners.push({ o: wheel, ax: 'x', v: 0.08 }); farDeco.push(wheel, legs)
    // クレーン（南の港）
    for (const x of [4, 12, 20]) {
      const c = new THREE.Group(); c.position.set(x, 0, H + 5)
      const m1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), lam(0xd0503a)); m1.position.y = 3.5; c.add(m1)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 8), lam(0xd0503a)); arm.position.set(0, 7, -2); c.add(arm)
      const bl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), basic(0xff2020)); bl.position.y = 7.4; c.add(bl); blinkers.push(bl)
      scene.add(c); farDeco.push(c)
    }
    // 灯台（北西）。光の帯が回る
    const lh = new THREE.Group(); lh.position.set(-5, 0, -4)
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 6, 12), lam(0xf0f0f0)); tw.position.y = 3; lh.add(tw)
    const lt = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), basic(0xfff6c0)); lt.position.y = 6.4; lh.add(lt)
    const bm = new THREE.Mesh(new THREE.ConeGeometry(2.4, 26, 16, 1, true).rotateZ(Math.PI / 2).translate(13, 0, 0), basic(0xfff6c0, { transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }))
    const bp = new THREE.Group(); bp.position.y = 6.4; bp.add(bm); lh.add(bp); spinners.push({ o: bp, ax: 'y', v: 0.6 })
    scene.add(lh); farDeco.push(lh)
  } else if (map.theme === 'neon') {
    // 屋上の看板と縦のネオン
    const words = ['ラーメン', 'カラオケ', '24H', 'GAME', 'BAR', '居酒屋', 'ホテル', 'パチ', '焼肉', 'LIVE']
    let k = 0
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (T(x, y) !== 'B' || hash(x, y, 21) > 0.12) continue
      const col = th.neon[k % th.neon.length]
      const word = words[k % words.length]; k++
      const mat = addCut(basic(0xffffff, { map: textTex(word, { w: 256, h: 80, bg: '#0a0610', fg: '#' + new THREE.Color(col).getHexString(), border: '#' + new THREE.Color(col).getHexString(), size: 50 }) }), cutU)
      signMats.push(mat)
      const vert = hash(x, y, 22) < 0.5
      const geo = vert ? new THREE.PlaneGeometry(0.3, 1.1) : new THREE.PlaneGeometry(0.9, 0.3)
      const m = new THREE.Mesh(geo, mat)
      const face = !solid(x, y + 1) ? [0, 1] : !solid(x + 1, y) ? [1, 0] : !solid(x - 1, y) ? [-1, 0] : [0, -1]
      m.position.set(x + 0.5 + face[0] * 0.5, vert ? 1.5 : 1.25, y + 0.5 + face[1] * 0.5)
      m.rotation.y = face[0] === 1 ? Math.PI / 2 : face[0] === -1 ? -Math.PI / 2 : face[1] === 1 ? 0 : Math.PI
      if (vert) { const t = mat.map; t.center.set(0.5, 0.5); t.rotation = -Math.PI / 2 }
      scene.add(m)
    }
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), basic(0xff2020)); const a = i / 6 * Math.PI * 2; b.position.set(W / 2 + Math.cos(a) * 30, 15 + hash(i, 9) * 6, H / 2 + Math.sin(a) * 30); scene.add(b); blinkers.push(b) }
  }
  // 公園の木
  {
    const pts = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T(x, y) === 'g' && (x + y) % 2 === 0) pts.push([x + 0.5, y + 0.5])
    if (pts.length) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6).translate(0, 0.25, 0), toon(0x5a3a22), pts.length)
      const leaf = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), toon(map.theme === 'neon' ? 0x2a6a5a : 0x2f7a40), pts.length)
      pts.forEach(([x, z], i) => { m4.makeTranslation(x, 0, z); trunk.setMatrixAt(i, m4); m4.makeTranslation(x, 0.68, z); leaf.setMatrixAt(i, m4) })
      trunk.castShadow = leaf.castShadow = true
      scene.add(trunk, leaf)
    }
  }

  // ---- 信号機（交差点の北西と南東の角に1本ずつ。東西向きと南北向きの灯器）
  const signals = map.lights.map(l => {
    const mats = { x: [basic(0x300000), basic(0x302000), basic(0x003010)], y: [basic(0x300000), basic(0x302000), basic(0x003010)] }
    const g = new THREE.Group()
    const mk = (px, pz, faceX, faceZ) => {
      const p = new THREE.Group(); p.position.set(px, 0, pz)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.1, 6), toon(0x2a2e36)); pole.position.y = 0.55; p.add(pole)
      for (const [axis, fx, fz] of [['x', faceX, 0], ['y', 0, faceZ]]) {
        const hd = new THREE.Group(); hd.position.set(fx * 0.06, 1.0, fz * 0.06)
        hd.rotation.y = fx ? (fx < 0 ? -Math.PI / 2 : Math.PI / 2) : (fz < 0 ? Math.PI : 0)
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), toon(0x1a1c22)); hd.add(box)
        for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), mats[axis][i]); b.position.set(-0.11 + i * 0.11, 0, 0.031); hd.add(b) }
        p.add(hd)
      }
      g.add(p)
    }
    mk(l.x - 0.12, l.y - 0.12, -1, -1)
    mk(l.x + 2.12, l.y + 2.12, 1, 1)
    scene.add(g)
    return { l, mats }
  })
  const SIG_ON = { r: [0xff2a2a, 0x302000, 0x003010], y: [0x300000, 0xffc020, 0x003010], g: [0x300000, 0x302000, 0x20ff80] }

  // ---- 工事の柵（幕2から出る）
  const workMeshes = map.works.map(r => {
    const [x0, y0, x1, y1] = r
    const g = new THREE.Group()
    const vert = x0 === x1 // 横道をふさぐ（柵は南北に並ぶ）
    const cx = (x0 + x1 + 1) / 2, cz = (y0 + y1 + 1) / 2
    g.position.set(cx, 0, cz)
    const len = vert ? (y1 - y0 + 1) : (x1 - x0 + 1)
    const stripe = canvasTex(128, 32, g2 => { for (let i = -2; i < 12; i++) { g2.fillStyle = i % 2 ? '#111' : '#ffd23a'; g2.beginPath(); g2.moveTo(i * 16, 32); g2.lineTo(i * 16 + 16, 32); g2.lineTo(i * 16 + 32, 0); g2.lineTo(i * 16 + 16, 0); g2.fill() } })
    stripe.wrapS = THREE.RepeatWrapping; stripe.repeat.set(len * 1.5, 1)
    const board = new THREE.Mesh(new THREE.BoxGeometry(vert ? 0.06 : len * 0.96, 0.16, vert ? len * 0.96 : 0.06), toon(0xffffff, { map: stripe })); board.position.y = 0.42; g.add(board)
    const board2 = board.clone(); board2.position.y = 0.2; g.add(board2)
    const lampMat = basic(0xffa000)
    for (let i = 0; i <= len; i++) {
      const off = -len / 2 + i * len / Math.max(1, len) * 0.96
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), toon(0xeeeeee)); leg.position.set(vert ? 0 : off, 0.25, vert ? off : 0); g.add(leg)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lampMat); lamp.position.set(vert ? 0 : off, 0.56, vert ? off : 0); g.add(lamp)
    }
    for (const s of [-1, 1]) { const c = makeCone(); c.position.set(vert ? s * 0.45 : 0, 0, vert ? 0 : s * 0.45); g.add(c) }
    g.visible = false; g.scale.y = 0.01
    scene.add(g)
    blinkers.push(lamp0(g, lampMat))
    return g
  })
  function lamp0(g, mat) { return { material: mat, isWork: true } }

  // ---- タクシー・お客さん・障害物
  const taxi = makeTaxi(); scene.add(taxi)
  const faceMats = new Map()
  const faceMat = (kind, mood) => {
    const k = kind + ':' + mood
    if (!faceMats.has(k)) faceMats.set(k, new THREE.SpriteMaterial({ map: faceTex(kind, mood), depthWrite: false }))
    return faceMats.get(k)
  }
  const iconMats = {}
  const iconMat = k => (iconMats[k] = iconMats[k] || new THREE.SpriteMaterial({ map: iconTex(k), depthWrite: false, transparent: true }))
  let paxKind = null, paxGroup = null
  const paxIcon = new THREE.Sprite(iconMat('heart')); paxIcon.scale.set(0.16, 0.16, 1); paxIcon.visible = false; paxIcon.renderOrder = 4
  scene.add(paxIcon)
  function setPax(kind) {
    if (kind === paxKind) return
    if (paxGroup) { taxi.userData.body.remove(paxGroup); paxGroup = null }
    paxKind = kind
    if (!kind) return
    paxGroup = makePerson(kind, faceMat(kind, 3))
    paxGroup.userData.body.visible = false; paxGroup.userData.arm.visible = false
    paxGroup.position.set(-0.13, 0.17, 0)
    taxi.userData.body.add(paxGroup)
  }
  // 乗り場で手を挙げて待つ人
  const waiter = makePerson('walker', faceMat('walker', 3)); waiter.visible = false; scene.add(waiter)

  const obsPool = new Map() // id -> mesh
  const NPC_COLORS = [0x3a6aff, 0xe8e8ee, 0x30a060, 0xd04050, 0x8a5aff]
  function obsMesh(id, t) {
    let m = obsPool.get(id)
    if (!m) {
      m = t === 'c' ? makeCone() : t === 'k' ? makeCat() : makeNpcCar(NPC_COLORS[Number(id.slice(1)) % NPC_COLORS.length])
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24).rotateX(-Math.PI / 2), basic(0xff4a4a, { transparent: true, opacity: 0.85, depthWrite: false }))
      ring.position.y = 0.02; ring.visible = false; m.add(ring); m.userData.ring = ring
      obsPool.set(id, m); scene.add(m)
    }
    return m
  }
  const lastObs = new Map() // id -> [t, x, y]

  // 乗り場の光の筒・ナビの目印
  const zoneTex = canvasTex(16, 64, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h) })
  const mkBeam = (r, h, color) => {
    const g = new THREE.Group()
    const col = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28, 1, true).translate(0, h / 2, 0), basic(color, { map: zoneTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }))
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r, 40).rotateX(-Math.PI / 2), basic(color, { transparent: true, opacity: 0.9, depthWrite: false }))
    ring.position.y = 0.02
    g.add(col, ring); g.visible = false; scene.add(g)
    return g
  }
  const zone = mkBeam(1.4, 1.1, 0x3ddc97)
  const navBeam = mkBeam(0.5, 14, 0x3ddc97)
  const viaBeam = mkBeam(0.4, 10, 0xb07aff)
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 3).rotateZ(-Math.PI / 2), basic(0xffcf3a)); arrow.visible = false; scene.add(arrow)

  // ---- 粒（火花・コイン・紙吹雪・煙・雨しぶき）
  const MAXP = 260
  const pmesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), basic(0xffffff), MAXP)
  pmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); pmesh.count = 0; pmesh.frustumCulled = false
  pmesh.setColorAt(0, new THREE.Color()); scene.add(pmesh)
  const parts = []
  const pcol = new THREE.Color()
  function burst(x, y, z, n, { color = 0xffd23a, speed = 2, up = 2, life = 0.9, size = 0.05, grav = 6, colors = null } = {}) {
    for (let i = 0; i < n && parts.length < MAXP; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6)
      parts.push({ x, y, z, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * s, life, max: life, size: size * (0.6 + Math.random() * 0.8), grav, col: new THREE.Color(colors ? colors[i % colors.length] : color), spin: Math.random() * 8 })
    }
  }
  // 頭の上を回る星（ぶつけたとき）
  const stars = [0, 1, 2].map(() => { const s = new THREE.Sprite(iconMat('star')); s.scale.set(0.16, 0.16, 1); s.visible = false; s.renderOrder = 4; scene.add(s); return s })
  let starsUntil = 0
  // 飛んでいく物（猫・コーン・部品・お客さん）
  const flyers = []
  function fly(obj, { vx = 0, vy = 3, vz = 0, spin = 6, life = 1.4, ground = 0, fade = true } = {}) {
    scene.add(obj)
    flyers.push({ obj, vx, vy, vz, spin, life, max: life, ground, fade })
  }

  // ---- 雨（第3幕）
  const RAIN = 700
  const rainPos = new Float32Array(RAIN * 6)
  for (let i = 0; i < RAIN; i++) { const x = (Math.random() - 0.5) * 16, y = Math.random() * 8, z = (Math.random() - 0.5) * 16; rainPos.set([x, y, z, x - 0.03, y - 0.35, z], i * 6) }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc8dcff, transparent: true, opacity: 0.7, fog: false }))
  rain.visible = false; rain.frustumCulled = false; scene.add(rain)
  let flash = 0, nextFlash = 0

  // ---- 画質
  function setTier(t) {
    tier = Math.max(0, Math.min(2, t))
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [1, 1.5, 2][tier]))
    renderer.shadowMap.enabled = tier === 2
    moon.castShadow = tier === 2
    rainGeo.setDrawRange(0, [RAIN * 0.3, RAIN * 0.6, RAIN][tier] * 2 | 0)
    if (sizeW) renderer.setSize(sizeW, sizeH, false)
  }
  let sizeW = 0, sizeH = 0
  setTier(tier)

  // ---- カメラ
  let camMode = mode, nightVision = look
  const cam = { a: null, x: 0, z: 0, shake: 0, fov: 62, shiftY: 0 }
  const band = { top: 0, bottom: 0, left: 0, right: 0, topMap: 0 } // 画面のうち HUD と操作に隠れていない所（px）
  const tmpV = new THREE.Vector3()
  function applyMode() {
    const mapView = camMode === 'map'
    scene.fog.near = mapView ? 60 : nightVision ? 6 : 3.2
    scene.fog.far = mapView ? 140 : nightVision ? 17 : 12.5
    scene.fog.color.set(nightVision && !mapView ? 0x123028 : th.fog)
    hemi.intensity = mapView ? 2.2 : nightVision ? 2.0 : 1.1
    hemi.color.set(nightVision && !mapView ? 0xc0ffe0 : th.hemiSky)
    cutU.on.value = mapView ? 0 : 1
    for (const im of buildingMeshes) im.scale.y = mapView ? 0.45 : 1 // 地図では低いミニチュアにして道を見やすく
    if (farCity) farCity.visible = !mapView
    for (const o of farDeco) o.visible = !mapView
  }
  applyMode()

  function placeCamera(car, dt, now) {
    if (camMode === 'map') {
      // 北（奥）が上の斜め見下ろし。画面の縦横に合わせて全体が入る距離にする
      // HUD と掛け声ボタンに隠れていない四角（band）に収まる距離にして、その真ん中へずらす
      const aspect = sizeW / Math.max(1, sizeH)
      const fovV = 40
      camera.fov = fovV
      const bt = band.right > band.left ? band.topMap : 0, bb = band.right > band.left ? band.bottom : sizeH
      const bl = band.right > band.left ? band.left : 0, br = band.right > band.left ? band.right : sizeW
      const vw = Math.max(sizeW * 0.4, br - bl), vh = Math.max(sizeH * 0.4, bb - bt)
      const needW = (W + 1.5) * sizeW / vw, needH = (H * 0.9 + 1) * sizeH / vh
      const tanV = Math.tan(fovV * Math.PI / 360), tanH = tanV * aspect
      const d = Math.max(needH / 2 / tanV, needW / 2 / tanH) * 1.02
      const tilt = 62 * Math.PI / 180
      camera.position.set(W / 2, Math.sin(tilt) * d, H / 2 + Math.cos(tilt) * d)
      camera.lookAt(W / 2, 0, H / 2 + 0.6)
      camera.clearViewOffset()
      const ox = sizeW / 2 - (bl + br) / 2, oy = sizeH / 2 - (bt + Math.min(bb, sizeH)) / 2
      if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) camera.setViewOffset(sizeW, sizeH, ox, oy, sizeW, sizeH)
      camera.updateProjectionMatrix()
      return
    }
    if (cam.a == null) { cam.a = car.a; cam.x = car.x; cam.z = car.y }
    const k = Math.min(1, dt * 4.2)
    cam.a += Math.atan2(Math.sin(car.a - cam.a), Math.cos(car.a - cam.a)) * k
    cam.x += (car.x - cam.x) * Math.min(1, dt * 12); cam.z += (car.y - cam.z) * Math.min(1, dt * 12)
    const ca = Math.cos(cam.a), sa = Math.sin(cam.a)
    const speed = Math.abs(car.v)
    const back = 2.1 + speed * 0.06, up = 1.35 + speed * 0.03
    let sx = 0, sy = 0
    if (cam.shake > 0) { sx = (Math.random() - 0.5) * cam.shake * 0.5; sy = (Math.random() - 0.5) * cam.shake * 0.4 }
    camera.position.set(cam.x - ca * back + sx, up + sy, cam.z - sa * back + sx)
    const ahead = 2.4
    camera.lookAt(cam.x + ca * ahead, 0.15, cam.z + sa * ahead)
    const aspect = sizeW / Math.max(1, sizeH)
    const want = (aspect < 0.8 ? 74 : aspect < 1.3 ? 64 : 52) + Math.min(8, speed * 1.2)
    cam.fov += (want - cam.fov) * Math.min(1, dt * 3)
    camera.fov = cam.fov
    camera.clearViewOffset()
    camera.updateProjectionMatrix()
    // 下の操作ボタンに隠れないよう、タクシーが「HUD と操作の間」の下寄りに来るまで絵を上へずらす
    if (band.bottom > band.top) {
      camera.updateMatrixWorld()
      const p = project(car.x, 0.25, car.y)
      const want = band.top + (band.bottom - band.top) * 0.68
      const d = Math.max(0, Math.min(sizeH * 0.32, p.y - want))
      cam.shiftY += (d - cam.shiftY) * Math.min(1, dt * 4)
    } else cam.shiftY = 0
    if (cam.shiftY > 0.5) { camera.setViewOffset(sizeW, sizeH, 0, cam.shiftY, sizeW, sizeH); camera.updateProjectionMatrix() }
    cutU.cam.value.set(camera.position.x, camera.position.z)
    cutU.car.value.set(car.x, car.y)
  }

  const fpsLog = []
  let lastTierCheck = performance.now() + 3000
  let wheelRot = 0, lastCarX = null, lastCarY = 0
  let wrecked = false, endShown = ''
  let mood = 3

  const _w = new THREE.Vector3(), _d = new THREE.Vector3()
  // 顔の絵を頭の「カメラ側」に置く（後ろから見ても顔が見える。漫画の決まり）
  function faceToCam(person) {
    const hd = person.userData.head, f = person.userData.face
    if (!hd || !f) return
    hd.getWorldPosition(_w)
    _d.copy(camera.position).sub(_w).normalize().multiplyScalar(0.125).add(_w)
    f.position.copy(hd.worldToLocal(_d))
  }

  function project(x, y, z) {
    tmpV.set(x, y, z).project(camera)
    return { x: (tmpV.x * 0.5 + 0.5) * sizeW, y: (-tmpV.y * 0.5 + 0.5) * sizeH, behind: tmpV.z > 1 }
  }

  const api = {
    is3d: true,
    get tier() { return tier },
    setMode(m, lk) { if (m === camMode && lk === nightVision) return; camMode = m; nightVision = lk; cam.a = null; applyMode() },
    setBand(b) { Object.assign(band, b) },
    setSize(w, h) {
      if (w === sizeW && h === sizeH) return
      sizeW = w; sizeH = h
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix()
    },
    // 出来事に合わせた演出（game-view.js が新しいイベントごとに呼ぶ）
    event(e, car) {
      const cx = car.x, cz = car.y
      if (e.k === 'crash') {
        cam.shake = Math.min(1.2, 0.3 + e.p * 0.2)
        burst(cx + Math.cos(car.a) * 0.4, 0.25, cz + Math.sin(car.a) * 0.4, 14 + Math.round(e.p * 6), { colors: [0xffd23a, 0xff8a2a, 0xffffff], speed: 2.4, up: 2.2, life: 0.6, size: 0.04 })
        starsUntil = performance.now() + 1500
        taxi.userData.body.position.y = 0.06
        // 当たった物を飛ばす（最後に見えた位置の一番近いもの）
        if (e.what === 'cat' || e.what === 'cone') {
          const t = e.what === 'cat' ? 'k' : 'c'
          let best = null, bd = 1.6
          for (const [id, [tt, x, y]] of lastObs) { if (tt !== t) continue; const d = Math.hypot(x - cx, y - cz); if (d < bd) { bd = d; best = [id, x, y] } }
          const px = best ? best[1] : cx + Math.cos(car.a) * 0.5, pz = best ? best[2] : cz + Math.sin(car.a) * 0.5
          const o = t === 'k' ? makeCat() : makeCone()
          o.position.set(px, 0, pz)
          const dx = px - cx, dz = pz - cz, dl = Math.hypot(dx, dz) || 1
          fly(o, t === 'k' ? { vx: dx / dl * 1.5 + Math.cos(car.a + 1.6) * 1.2, vy: 4.6, vz: dz / dl * 1.5 + Math.sin(car.a + 1.6) * 1.2, spin: 9, life: 1.5 } : { vx: dx / dl * 3 + Math.cos(car.a) * 2, vy: 2.5, vz: dz / dl * 3 + Math.sin(car.a) * 2, spin: 12, life: 1.2 })
          if (best) { const m = obsPool.get(best[0]); if (m) m.visible = false }
        }
        if (e.what === 'water') burst(cx, 0.1, cz, 30, { colors: [0x9ad8ff, 0xffffff], speed: 1.6, up: 3.2, life: 0.9, size: 0.05 })
      } else if (e.k === 'deliver') {
        burst(cx, 0.6, cz, 40, { colors: [0xffd23a, 0xffe98a, 0xffb000], speed: 1.8, up: 3.5, life: 1.2, size: 0.06 })
        burst(cx, 0.8, cz, 30, { colors: [0xff5aa0, 0x5ad1ff, 0x3ddc97, 0xffffff], speed: 1.4, up: 2.5, life: 1.6, size: 0.04, grav: 2 })
        if (paxKind) { const p = makePerson(paxKind, faceMat(paxKind, 4)); p.position.set(cx, 0.3, cz); fly(p, { vx: -Math.sin(car.a) * 1.4, vy: 2.2, vz: Math.cos(car.a) * 1.4, spin: 0, life: 1.6, fade: true }) }
        setPax(null)
      } else if (e.k === 'angry') {
        if (paxKind || e.kind) {
          const kind = paxKind || e.kind
          const p = makePerson(kind, faceMat(kind, 0)); p.position.set(cx, 0.4, cz)
          const an = new THREE.Sprite(iconMat('anger')); an.scale.set(0.2, 0.2, 1); an.position.set(0.1, 0.5, 0); p.add(an)
          fly(p, { vx: -Math.sin(car.a) * 2.2, vy: 4, vz: Math.cos(car.a) * 2.2, spin: 7, life: 1.8 })
        }
        burst(cx, 0.6, cz, 16, { color: 0xffffff, speed: 0.8, up: 1.4, life: 1.2, size: 0.09, grav: -0.5 })
        setPax(null)
      } else if (e.k === 'board') {
        burst(cx, 0.5, cz, 18, { colors: [0xffffff, 0x5ad1ff], speed: 1.2, up: 2, life: 0.8, size: 0.04 })
      } else if (e.k === 'red') {
        cam.shake = 0.25
      } else if (e.k === 'phase' && e.ph === 2) {
        flash = 1
      }
    },
    frame({ car, obs, g, dt, now, lt }) {
      fpsLog.push(dt); if (fpsLog.length > 90) fpsLog.shift()
      if (now > lastTierCheck && fpsLog.length >= 60) {
        lastTierCheck = now + 2500
        const fps = fpsLog.length / fpsLog.reduce((a, b) => a + b, 0)
        if (fps < 42 && tier > 0) setTier(tier - 1)
      }
      const t = now / 1000
      // タクシー
      taxi.position.set(car.x, 0, car.y)
      taxi.rotation.y = -car.a
      const ud = taxi.userData
      if (lastCarX != null) wheelRot += Math.hypot(car.x - lastCarX, car.y - lastCarY) / 0.1 * Math.sign(car.v || 1)
      lastCarX = car.x; lastCarY = car.y
      for (const w of ud.wheels) { w.w.rotation.z = -wheelRot; if (w.front) w.pv.rotation.y = -(car.s || 0) * 0.45 }
      // カメラ（タクシーが動いたあと、顔の向きを決める前に置く）
      cam.shake = Math.max(0, cam.shake - dt * 2)
      placeCamera(car, dt, now)
      ud.body.position.y += (0 - ud.body.position.y) * Math.min(1, dt * 8)
      ud.body.rotation.x = -(car.s || 0) * Math.min(1, Math.abs(car.v) / 5) * 0.07 // 曲がるとき外へ傾く
      ud.body.rotation.z = g.inp.brake && car.v > 0.5 ? -0.05 : g.inp.accel ? 0.03 : 0
      ud.tailMat.color.setHex(g.inp.brake ? 0xff2020 : 0x7a1010)
      const blinkOn = Math.floor(now / 260) % 2 === 0
      ud.blink[0].color.setHex(car.s < 0 && blinkOn ? 0xffa000 : 0x5a3000)
      ud.blink[1].color.setHex(car.s > 0 && blinkOn ? 0xffa000 : 0x5a3000)
      // 傷み: 60% から煙、85% から火花。ライトもちらつく
      if (g.dmg >= 60 && Math.random() < dt * (g.dmg >= 85 ? 14 : 6)) burst(car.x + Math.cos(car.a) * 0.3, 0.35, car.y + Math.sin(car.a) * 0.3, 1, { color: g.dmg >= 85 ? 0x55555a : 0x8a8a90, speed: 0.2, up: 0.8, life: 1.1, size: 0.1, grav: -0.6 })
      const flicker = g.dmg >= 85 && Math.random() < 0.15
      ud.headMat.color.setHex(flicker ? 0x555555 : 0xfffbe0)
      head.intensity = flicker ? 4 : wrecked ? 0 : 28
      ud.beam.visible = !flicker && !wrecked && camMode !== 'map'
      // 終わりの演出: 廃車は部品が飛び散る。時間切れは行灯が「回送」になる
      if (g.st === 'end' && endShown !== g.end) {
        endShown = g.end
        if (g.end === 'wreck') {
          wrecked = true
          cam.shake = 1.4
          burst(car.x, 0.4, car.y, 60, { colors: [0x55555a, 0x8a8a90, 0xffd23a, 0xff6a2a], speed: 3, up: 4, life: 1.6, size: 0.08 })
          for (const w of ud.wheels) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 12).rotateX(Math.PI / 2), toon(0x15161a)); wh.position.set(car.x, 0.1, car.y); fly(wh, { vx: (Math.random() - 0.5) * 5, vy: 3 + Math.random() * 2, vz: (Math.random() - 0.5) * 5, spin: 10, life: 2.2, fade: false }); w.w.visible = false }
          const sign = new THREE.Mesh(ud.sign.geometry, ud.signMat); sign.position.set(car.x, 0.5, car.y); fly(sign, { vy: 6, spin: 8, life: 2.2, fade: false }); ud.sign.visible = false
          const hood = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.44), toon(0xffcf3a)); hood.position.set(car.x, 0.3, car.y); fly(hood, { vx: Math.cos(car.a) * 2, vy: 5, vz: Math.sin(car.a) * 2, spin: 6, life: 2.2, fade: false })
          if (paxKind) { const p = makePerson(paxKind, faceMat(paxKind, 5)); p.position.set(car.x, 0.5, car.y); fly(p, { vx: -Math.sin(car.a) * 1.5, vy: 6.5, vz: Math.cos(car.a) * 1.5, spin: 9, life: 2.2, fade: false }); setPax(null) }
          ud.body.scale.set(1, 0.7, 1); ud.roof.material = toon(0x6a5a2a); ud.lower.material = toon(0x6a5a2a)
        } else if (g.end === 'time') {
          ud.signMat.map = textTex('回送', { w: 128, h: 48, bg: '#ff5a3a', fg: '#fff', size: 34 }); ud.signMat.needsUpdate = true
        }
      }
      // お客さん（屋根の窓から身を乗り出している）。機嫌で顔と頭の上の記号が変わる
      if (!wrecked) setPax(g.pax)
      if (paxGroup) {
        mood = g.face
        const hd = paxGroup.userData.head
        paxGroup.userData.face.material = faceMat(paxKind, starsUntil > now ? 5 : mood)
        paxGroup.position.y = 0.17 + Math.abs(Math.sin(t * (mood === 4 ? 9 : mood === 0 ? 14 : 3))) * (mood === 4 || mood === 0 ? 0.05 : 0.015)
        paxGroup.rotation.y = mood === 0 ? Math.sin(t * 18) * 0.3 : 0
        const icon = paxKind === 'ghost' ? 'flame' : mood === 0 ? 'anger' : mood === 1 ? 'sweat' : mood === 4 ? 'heart' : null
        paxIcon.visible = !!icon
        if (icon) {
          paxIcon.material = iconMat(icon)
          hd.getWorldPosition(paxIcon.position); paxIcon.position.y += 0.2 + Math.sin(t * 4) * 0.03; paxIcon.position.x += 0.1
        }
      } else paxIcon.visible = false
      // 頭の上を回る星
      const sOn = starsUntil > now
      stars.forEach((s, i) => {
        s.visible = sOn
        if (sOn) { const a = t * 6 + i * 2.1; s.position.set(car.x + Math.cos(a) * 0.32, 0.72, car.y + Math.sin(a) * 0.32) }
      })
      // 障害物
      const look = nightVision
      const seen = new Set()
      for (const o of obs) {
        const [id, tt, x, y, a] = o
        seen.add(id)
        lastObs.set(id, [tt, x, y])
        const m = obsMesh(id, tt)
        m.visible = true
        m.position.set(x, 0, y)
        m.rotation.y = -a
        if (tt === 'k') { m.userData.body.position.y = 0.11 + Math.abs(Math.sin(t * 10 + x)) * 0.02; m.userData.tail.rotation.x = Math.sin(t * 5) * 0.4 }
        m.userData.ring.visible = look
      }
      for (const [id, m] of obsPool) if (!seen.has(id)) m.visible = false
      // 信号の色
      for (const s of signals) {
        const st = lightAt(s.l, lt)
        for (const ax of ['x', 'y']) { const on = SIG_ON[st[ax]]; for (let i = 0; i < 3; i++) s.mats[ax][i].color.setHex(on[i]) }
      }
      // 工事
      const cl = g.cl || []
      map.works.forEach((_, i) => {
        const m = workMeshes[i], on = cl.includes(i)
        if (on && !m.visible) { m.visible = true; m.scale.y = 0.01 }
        if (on) m.scale.y += (1 - m.scale.y) * Math.min(1, dt * 7)
        else m.visible = false
      })
      for (const b of blinkers) {
        if (b.isWork) b.material.color.setHex(Math.floor(now / 350) % 2 ? 0xffa000 : 0x402000)
        else b.visible = Math.floor(now / 700) % 2 === 0
      }
      for (const s of spinners) s.o.rotation[s.ax] += s.v * dt
      if (water) water.material.map.offset.x = (t * 0.03) % 1
      // 乗り場（近いときは全員に見える）と、ナビにだけ見える行き先の柱
      const pulse = 1 + Math.sin(t * 6) * 0.04
      const zcol = k => (k === 'pickup' ? 0x5ad1ff : 0x3ddc97)
      zone.visible = !!g.near
      if (g.near) { zone.position.set(g.near.x, 0, g.near.y); zone.scale.set(pulse, 1, pulse); zone.children.forEach(c => c.material.color.setHex(zcol(g.near.k))) }
      navBeam.visible = !!g.nav
      if (g.nav) { navBeam.position.set(g.nav.x, 0, g.nav.y); navBeam.children.forEach(c => c.material.color.setHex(zcol(g.nav.k))); navBeam.scale.set(camMode === 'map' ? 1.6 : 1, 1, camMode === 'map' ? 1.6 : 1) }
      viaBeam.visible = !!(g.nav && g.nav.via)
      if (viaBeam.visible) viaBeam.position.set(g.nav.via.x, 0, g.nav.via.y)
      const wait = g.stage === 'pickup' ? (g.near && g.near.k === 'pickup' ? g.near : g.nav && g.nav.k === 'pickup' ? g.nav : null) : null
      waiter.visible = !!wait
      if (wait) {
        waiter.position.set(wait.x + 0.55, 0, wait.y + 0.55)
        waiter.rotation.y = Math.atan2(car.x - wait.x, car.y - wait.y)
        waiter.userData.arm.rotation.z = -2.4 + Math.sin(t * 9) * 0.5
        waiter.scale.setScalar(camMode === 'map' ? 2.2 : 1.4)
      }
      arrow.visible = camMode === 'map'
      if (arrow.visible) { arrow.position.set(car.x, 1.6, car.y); arrow.rotation.y = -car.a; taxi.scale.setScalar(1.8) } else taxi.scale.setScalar(1)
      // 粒
      let k = 0
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.life -= dt
        if (p.life <= 0) { parts.splice(i, 1); continue }
        p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
        if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7 }
      }
      for (const p of parts) {
        const s = p.size * Math.min(1, p.life / p.max * 2)
        m4.compose(ps.set(p.x, p.y, p.z), q.setFromAxisAngle(v3(0.5, 1, 0.3).normalize(), p.life * p.spin), sc.set(s, s, s))
        pmesh.setMatrixAt(k, m4); pmesh.setColorAt(k, pcol.copy(p.col)); k++
      }
      pmesh.count = k
      pmesh.instanceMatrix.needsUpdate = true; if (pmesh.instanceColor) pmesh.instanceColor.needsUpdate = true
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i]
        f.life -= dt
        f.vy -= 9 * dt
        f.obj.position.x += f.vx * dt; f.obj.position.y += f.vy * dt; f.obj.position.z += f.vz * dt
        if (f.obj.position.y < f.ground) { f.obj.position.y = f.ground; f.vy *= -0.35; f.vx *= 0.6; f.vz *= 0.6; f.spin *= 0.5 }
        f.obj.rotation.x += f.spin * dt; f.obj.rotation.z += f.spin * 0.6 * dt
        if (f.fade && f.life < 0.4) f.obj.scale.setScalar(Math.max(0.01, f.life / 0.4))
        if (f.life <= 0) { scene.remove(f.obj); flyers.splice(i, 1) }
      }
      // 雨と稲光
      const rainy = g.ph >= 2
      rain.visible = rainy && tier > 0 && camMode !== 'map'
      if (rain.visible) {
        rain.position.set(car.x, 0, car.y)
        const arr = rainGeo.attributes.position.array
        for (let i = 0; i < arr.length; i += 6) { arr[i + 1] -= dt * 11; arr[i + 4] -= dt * 11; if (arr[i + 4] < 0) { arr[i + 1] += 8; arr[i + 4] += 8 } }
        rainGeo.attributes.position.needsUpdate = true
      }
      if (rainy && now > nextFlash) { flash = 1; nextFlash = now + 6000 + Math.random() * 7000 }
      flash = Math.max(0, flash - dt * 2.5)
      hemi.intensity = (camMode === 'map' ? 2.2 : nightVision ? 2.0 : rainy ? 0.85 : 1.1) + flash * 3
      if (paxGroup) faceToCam(paxGroup)
      if (waiter.visible) faceToCam(waiter)
      for (const f of flyers) if (f.obj.userData.face) faceToCam(f.obj)
      // ヘッドライトと月の影はタクシーの近くだけ
      const ca = Math.cos(car.a), sa = Math.sin(car.a)
      head.position.set(car.x + ca * 0.45, 0.32, car.y + sa * 0.45)
      head.target.position.set(car.x + ca * 4, 0, car.y + sa * 4)
      moon.position.set(car.x - 6, 14, car.y - 8); moon.target.position.set(car.x, 0, car.y)
      renderer.render(scene, camera)
      // 地図のときは区画の名前を HTML で重ねる（文字をくっきり見せる）
      const labels = []
      if (camMode === 'map') {
        for (const p of map.places) { const [bx, bz] = blockCenter(p.bx, p.by); const s = project(bx, 0.5, bz); labels.push({ name: p.name, x: s.x, y: s.y, hl: !!(g.nav && g.nav.name === p.name), via: !!(g.nav && g.nav.via && g.nav.via.name === p.name) }) }
      }
      const marks = []
      if (g.near && camMode !== 'map') { const s = project(g.near.x, 1.3, g.near.y); if (!s.behind) marks.push({ x: s.x, y: s.y, k: g.near.k }) }
      return { labels, marks }
    },
    // 描けているかの確認用: いまの画面の輝度の分散
    variance() {
      renderer.render(scene, camera)
      const gl = renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const px = new Uint8Array(4)
      let s1 = 0, s2 = 0, nn = 0
      for (let yy = 4; yy < h; yy += Math.max(1, h / 24 | 0)) for (let xx = 4; xx < w; xx += Math.max(1, w / 24 | 0)) {
        gl.readPixels(xx, yy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
        const l = px[0] * 0.3 + px[1] * 0.59 + px[2] * 0.11; s1 += l; s2 += l * l; nn++
      }
      return s2 / nn - (s1 / nn) ** 2
    },
    fps() { return fpsLog.length ? fpsLog.length / fpsLog.reduce((a, b) => a + b, 0) : 0 },
    dispose() {
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { if (x.map) x.map.dispose(); x.dispose() }) })
      renderer.dispose()
      try { renderer.forceContextLoss() } catch {} // 再戦のたびに作り直すので、古い WebGL の枠をすぐ返す（ブラウザは同時に持てる数が限られる）
    }
  }
  return api
}
