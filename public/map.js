// 街の地図。サーバー（lib/game.mjs）と画面（game-view.js）の両方がこのファイルを読む。
// 変わらないものなので毎 tick 送らない。単位は「マス」（1マス=1）。x は右、y は下が正。
//   '#' 外壁  'B' 建物（ぶつかる）  '.' 道路  'g' 公園の芝（通れるが遅く、揺れる）

export const W = 24, H = 24

function build() {
  const g = []
  const isRoad = i => i >= 1 && i <= 22 && (i - 1) % 5 < 2 // 1,2 6,7 11,12 16,17 21,22
  for (let y = 0; y < H; y++) {
    const row = []
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) row.push('#')
      else if (isRoad(x) || isRoad(y)) row.push('.')
      else row.push('B')
    }
    g.push(row)
  }
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c }
  // 行き止まりと遠回りを作る（全部が格子だと迷わない）
  fill(3, 6, 5, 7, 'B')     // 駅の南の道をふさぐ
  fill(16, 3, 17, 5, 'B')   // 北東の縦道をふさぐ
  fill(11, 13, 12, 15, 'B') // 中央南の縦道をふさぐ
  fill(18, 16, 20, 17, 'B') // 南東の横道をふさぐ
  fill(13, 8, 15, 10, 'g')  // 公園（近道できるが揺れる）
  return g.map(r => r.join(''))
}

export const TILES = build()

export function tileAt(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y)
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return '#'
  return TILES[ty][tx]
}
export const isSolid = c => c === '#' || c === 'B'

// 区画（bx,by は 0..3）の名前と、乗り降りする場所（区画に面した道路のマス中央）
const side = (bx, by, s) => {
  const cx = 4 + 5 * bx + 0.5, cy = 4 + 5 * by + 0.5
  if (s === 'S') return [cx, 6 + 5 * by + 0.5]
  if (s === 'N') return [cx, 2 + 5 * by + 0.5]
  if (s === 'E') return [6 + 5 * bx + 0.5, cy]
  return [2 + 5 * bx + 0.5, cy]
}
const P = (name, bx, by, s) => { const [x, y] = side(bx, by, s); return { name, x, y, bx, by } }

export const PLACES = [
  P('駅', 0, 0, 'E'),
  P('病院', 1, 0, 'S'),
  P('学校', 2, 0, 'W'),
  P('ホテル', 3, 0, 'S'),
  P('市役所', 0, 1, 'S'),
  P('映画館', 1, 1, 'E'),
  P('神社', 3, 1, 'W'),
  P('図書館', 0, 2, 'E'),
  P('温泉', 1, 2, 'W'),
  P('寿司屋', 2, 2, 'E'),
  P('球場', 3, 2, 'N'),
  P('港', 0, 3, 'N'),
  P('遊園地', 1, 3, 'E'),
  P('美術館', 2, 3, 'W'),
  P('動物園', 3, 3, 'E')
]

// 区画の中央（看板を描く位置）
export const blockCenter = (bx, by) => [4 + 5 * bx + 0.5, 4 + 5 * by + 0.5]
export const PARK = { name: '公園', x: 14.5, y: 9.5 }

export const START = { x: 6.5, y: 11.5, a: 0 } // 出発地点（中央の横道を東向き）
