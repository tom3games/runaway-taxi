// 街の地図（3つ）。サーバー（lib/game.mjs）と画面（game-view.js / view3d.js）の両方がこのファイルを読む。
// 変わらないものなので毎 tick 送らない。単位は「マス」（1マス=1）。x は右、y は下が正。
//   '#' 外壁  'B' 建物（ぶつかる）  '.' 道路  'g' 芝（通れるが遅く、揺れる）  'w' 水（ぶつかる）
// どの街も「幅2マスの道が5マスおき」の格子が土台。区画（bx,by は 0..3）の名前と乗り降りの場所はその格子で決まる。
//
// 街ごとに持つもの:
//   cones  コーン [x, y]            cats  道を横切る猫 { x, y, axis, phase }
//   loops  周回する車 { pts, v, off, from }（from: その幕から走り出す。0=最初から）
//   lights 信号 { x, y, off }（交差点 2x2 の左上のマス）。色は lightAt(信号, 走り出してからの秒) で決まるので送らない
//   works  工事で通れなくなる所 [x0, y0, x1, y1, from]（from の幕から現れる）

export const W = 24, H = 24
export const ROAD_PAIRS = [1, 6, 11, 16, 21] // 2マス幅の道の1マス目

const isRoadIdx = i => i >= 1 && i <= 22 && (i - 1) % 5 < 2 // 1,2 6,7 11,12 16,17 21,22

function grid() {
  const g = []
  for (let y = 0; y < H; y++) {
    const row = []
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) row.push('#')
      else if (isRoadIdx(x) || isRoadIdx(y)) row.push('.')
      else row.push('B')
    }
    g.push(row)
  }
  return g
}
const filler = g => (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c }

// 区画に面した道路のマス中央（乗り降りする場所）
const side = (bx, by, s) => {
  const cx = 4 + 5 * bx + 0.5, cy = 4 + 5 * by + 0.5
  if (s === 'S') return [cx, 6 + 5 * by + 0.5]
  if (s === 'N') return [cx, 2 + 5 * by + 0.5]
  if (s === 'E') return [6 + 5 * bx + 0.5, cy]
  return [2 + 5 * bx + 0.5, cy]
}
const P = (name, bx, by, s) => { const [x, y] = side(bx, by, s); return { name, x, y, bx, by, s } }
export const blockCenter = (bx, by) => [4 + 5 * bx + 0.5, 4 + 5 * by + 0.5]

// ---- 1. 下町（提灯と瓦屋根の夜。行き止まりが4つ）
function shitamachi() {
  const g = grid(), fill = filler(g)
  fill(3, 6, 5, 7, 'B')     // 駅の南の道をふさぐ
  fill(16, 3, 17, 5, 'B')   // 北東の縦道をふさぐ
  fill(11, 13, 12, 15, 'B') // 中央南の縦道をふさぐ
  fill(18, 16, 20, 17, 'B') // 南東の横道をふさぐ
  fill(13, 8, 15, 10, 'g')  // 公園（近道できるが揺れる）
  return {
    id: 'shitamachi', name: '下町', stars: 1, theme: 'shitamachi',
    lead: '提灯の灯る夜の下町。行き止まりに気をつけて',
    tiles: g.map(r => r.join('')),
    places: [
      P('駅', 0, 0, 'E'), P('病院', 1, 0, 'S'), P('学校', 2, 0, 'W'), P('ホテル', 3, 0, 'S'),
      P('市役所', 0, 1, 'S'), P('映画館', 1, 1, 'E'), P('神社', 3, 1, 'W'),
      P('図書館', 0, 2, 'E'), P('温泉', 1, 2, 'W'), P('寿司屋', 2, 2, 'E'), P('球場', 3, 2, 'N'),
      P('港', 0, 3, 'N'), P('遊園地', 1, 3, 'E'), P('美術館', 2, 3, 'W'), P('動物園', 3, 3, 'E')
    ],
    park: { name: '公園', x: 14.5, y: 9.5 },
    start: { x: 6.5, y: 11.5, a: 0 },
    cones: [[9.5, 1.5], [14.5, 6.5], [21.5, 9.5], [1.5, 14.5], [9.5, 16.5], [19.5, 21.5], [7.5, 19.5], [17.5, 12.5], [12.5, 2.5], [2.5, 8.5]],
    cats: [
      { x: 7, y: 16.5, axis: 'x', phase: 0 }, { x: 17.5, y: 2, axis: 'y', phase: 1.3 }, { x: 22, y: 5.5, axis: 'x', phase: 2.1 },
      { x: 9.5, y: 22, axis: 'y', phase: 0.7 }, { x: 17, y: 19.5, axis: 'x', phase: 3.0 }
    ],
    loops: [
      { pts: [[1.5, 1.5], [22.5, 1.5], [22.5, 22.5], [1.5, 22.5]], v: 2.4, off: 0, from: 0 },
      { pts: [[16.5, 16.5], [6.5, 16.5], [6.5, 6.5], [16.5, 6.5]], v: 2.0, off: 10, from: 0 },
      { pts: [[1.5, 22.5], [22.5, 22.5], [22.5, 1.5], [1.5, 1.5]], v: 2.8, off: 30, from: 1 },
      { pts: [[6.5, 6.5], [16.5, 6.5], [16.5, 16.5], [6.5, 16.5]], v: 2.4, off: 3, from: 2 }
    ],
    lights: [{ x: 11, y: 6, off: 0 }, { x: 11, y: 16, off: 4.5 }, { x: 6, y: 11, off: 2 }],
    works: [[11, 3, 12, 3, 1], [18, 11, 18, 12, 1], [14, 11, 14, 12, 2]]
  }
}

// ---- 2. 港町（真ん中を川が横切る。橋は2本だけ。夕霧の港）
function minato() {
  const g = grid(), fill = filler(g)
  for (let x = 1; x <= 22; x++) if (![6, 7, 16, 17].includes(x)) { g[11][x] = 'w'; g[12][x] = 'w' }
  fill(11, 3, 12, 5, 'B')   // 北の真ん中の縦道をふさぐ
  fill(16, 18, 17, 20, 'B') // 南東の縦道をふさぐ
  fill(13, 8, 15, 10, 'g')  // 海浜公園
  return {
    id: 'minato', name: '港町', stars: 2, theme: 'minato',
    lead: '川で街が南北に分かれる。橋は2本、ラッシュは橋が混む',
    tiles: g.map(r => r.join('')),
    places: [
      P('灯台', 0, 0, 'E'), P('教会', 1, 0, 'S'), P('洋館', 2, 0, 'S'), P('展望台', 3, 0, 'S'),
      P('中華街', 0, 1, 'N'), P('赤れんが', 1, 1, 'E'), P('税関', 3, 1, 'W'),
      P('水族館', 0, 2, 'E'), P('屋台村', 1, 2, 'W'), P('魚市場', 2, 2, 'E'), P('観覧車', 3, 2, 'S'),
      P('フェリー', 0, 3, 'N'), P('造船所', 1, 3, 'E'), P('倉庫街', 2, 3, 'W'), P('ホテル', 3, 3, 'E')
    ],
    park: { name: '海浜公園', x: 14.5, y: 9.5 },
    start: { x: 6.5, y: 13.5, a: -Math.PI / 2 },
    cones: [[9.5, 2.5], [21.5, 4.5], [14.5, 7.5], [4.5, 16.5], [12.5, 21.5], [19.5, 17.5], [21.5, 19.5], [2.5, 4.5], [9.5, 6.5], [16.5, 2.5]],
    cats: [
      { x: 12, y: 7.5, axis: 'y', phase: 0.4 }, { x: 4.5, y: 2, axis: 'y', phase: 1.6 }, { x: 22, y: 14.5, axis: 'x', phase: 2.4 },
      { x: 14.5, y: 22, axis: 'y', phase: 0.9 }, { x: 12, y: 18.5, axis: 'x', phase: 3.3 }
    ],
    loops: [
      { pts: [[1.5, 1.5], [22.5, 1.5], [22.5, 6.5], [1.5, 6.5]], v: 2.3, off: 0, from: 0 },
      { pts: [[1.5, 16.5], [22.5, 16.5], [22.5, 22.5], [1.5, 22.5]], v: 2.3, off: 8, from: 0 },
      { pts: [[6.5, 6.5], [16.5, 6.5], [16.5, 16.5], [6.5, 16.5]], v: 2.0, off: 4, from: 1 },
      { pts: [[16.5, 16.5], [6.5, 16.5], [6.5, 6.5], [16.5, 6.5]], v: 2.2, off: 17, from: 2 }
    ],
    lights: [{ x: 6, y: 6, off: 0 }, { x: 16, y: 16, off: 3 }, { x: 11, y: 16, off: 6 }],
    works: [[16, 4, 17, 4, 1], [11, 18, 12, 18, 1], [6, 19, 7, 19, 2]]
  }
}

// ---- 3. 繁華街（ネオンの夜。区画の中に幅1マスの路地。信号と車が多い）
function neon() {
  const g = grid(), fill = filler(g)
  for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
    if (bx === 2 && by === 1) continue
    if ((bx + by) % 2 === 0) for (let y = 3 + 5 * by; y <= 5 + 5 * by; y++) g[y][4 + 5 * bx] = '.' // 縦の路地
    else for (let x = 3 + 5 * bx; x <= 5 + 5 * bx; x++) g[4 + 5 * by][x] = '.' // 横の路地
  }
  fill(13, 8, 15, 10, 'g')  // センター広場
  fill(18, 16, 20, 17, 'B') // 南東の横道をふさぐ
  fill(13, 11, 15, 12, 'B') // 広場の南の横道をふさぐ
  return {
    id: 'neon', name: '繁華街', stars: 3, theme: 'neon',
    lead: 'ネオンの路地は近道。でも信号と車が多い',
    tiles: g.map(r => r.join('')),
    places: [
      P('劇場', 0, 0, 'E'), P('ゲーセン', 1, 0, 'S'), P('百貨店', 2, 0, 'W'), P('タワー', 3, 0, 'S'),
      P('ラーメン', 0, 1, 'S'), P('カラオケ', 1, 1, 'E'), P('ライブ', 3, 1, 'W'),
      P('電気街', 0, 2, 'E'), P('銭湯', 1, 2, 'W'), P('占い館', 2, 2, 'E'), P('屋台', 3, 2, 'N'),
      P('映画館', 0, 3, 'N'), P('古着屋', 1, 3, 'E'), P('回転寿司', 2, 3, 'W'), P('ホテル', 3, 3, 'E')
    ],
    park: { name: '広場', x: 14.5, y: 9.5 },
    start: { x: 6.5, y: 11.5, a: 0 },
    cones: [[9.5, 1.5], [21.5, 9.5], [2.5, 13.5], [9.5, 16.5], [19.5, 21.5], [12.5, 2.5], [17.5, 12.5], [7.5, 19.5], [2.5, 7.5], [19.5, 6.5], [11.5, 14.5], [16.5, 18.5]],
    cats: [
      { x: 7, y: 16.5, axis: 'x', phase: 0 }, { x: 17.5, y: 2, axis: 'y', phase: 1.3 }, { x: 22, y: 5.5, axis: 'x', phase: 2.1 },
      { x: 9.5, y: 22, axis: 'y', phase: 0.7 }, { x: 17, y: 19.5, axis: 'x', phase: 3.0 }, { x: 2, y: 9.5, axis: 'x', phase: 1.9 }
    ],
    loops: [
      { pts: [[1.5, 1.5], [22.5, 1.5], [22.5, 22.5], [1.5, 22.5]], v: 2.5, off: 0, from: 0 },
      { pts: [[16.5, 16.5], [6.5, 16.5], [6.5, 6.5], [16.5, 6.5]], v: 2.1, off: 10, from: 0 },
      { pts: [[1.5, 22.5], [22.5, 22.5], [22.5, 1.5], [1.5, 1.5]], v: 2.9, off: 30, from: 1 },
      { pts: [[6.5, 6.5], [16.5, 6.5], [16.5, 16.5], [6.5, 16.5]], v: 2.5, off: 3, from: 1 },
      { pts: [[1.5, 1.5], [22.5, 1.5], [22.5, 22.5], [1.5, 22.5]], v: 3.0, off: 45, from: 2 }
    ],
    lights: [{ x: 6, y: 6, off: 0 }, { x: 16, y: 6, off: 3 }, { x: 11, y: 11, off: 1.5 }, { x: 6, y: 16, off: 6 }, { x: 16, y: 16, off: 4.5 }],
    works: [[11, 3, 12, 3, 1], [18, 11, 18, 12, 1], [11, 18, 12, 18, 2]]
  }
}

export const MAPS = { shitamachi: shitamachi(), minato: minato(), neon: neon() }
export const MAP_IDS = Object.keys(MAPS)
export const DEFAULT_MAP = 'shitamachi'
export const getMap = id => (typeof id === 'string' && Object.hasOwn(MAPS, id) ? MAPS[id] : MAPS[DEFAULT_MAP])

export function tileOf(map, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y)
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return '#'
  return map.tiles[ty][tx]
}
export const isSolid = c => c === '#' || c === 'B' || c === 'w'

// 信号の色。9秒で一周: 東西が青 3.8秒 → 黄 0.7秒 → 南北が青 3.8秒 → 黄 0.7秒。'g' 青 / 'y' 黄 / 'r' 赤
export const LIGHT_T = 9
export function lightAt(l, t) {
  const u = (((t + l.off) % LIGHT_T) + LIGHT_T) % LIGHT_T
  if (u < 3.8) return { x: 'g', y: 'r' }
  if (u < 4.5) return { x: 'y', y: 'r' }
  if (u < 8.3) return { x: 'r', y: 'g' }
  return { x: 'r', y: 'y' }
}
export const inLight = (l, x, y) => x >= l.x && x < l.x + 2 && y >= l.y && y < l.y + 2
export const inRect = (r, x, y) => x >= r[0] && x < r[2] + 1 && y >= r[1] && y < r[3] + 1

// 1幕ごとの名前（どの街でも同じ流れで難しくなる）
export const PHASES = [
  { name: '宵の口', lead: 'まずは肩ならし' },
  { name: 'ラッシュアワー', lead: '車が増えて工事が始まった' },
  { name: '嵐の深夜', lead: '雨で滑る。運賃は1.3倍' }
]

// 以前の書き方（下町だけだった頃）との互換
export const TILES = MAPS[DEFAULT_MAP].tiles
export const PLACES = MAPS[DEFAULT_MAP].places
export const START = MAPS[DEFAULT_MAP].start
export const PARK = MAPS[DEFAULT_MAP].park
export const tileAt = (x, y) => tileOf(MAPS[DEFAULT_MAP], x, y)
