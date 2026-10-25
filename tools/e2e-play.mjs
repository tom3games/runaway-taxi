// 暴走タクシーを実ブラウザで遊ぶ手順。担当ごとに本物のボタンを押して、車が動く・掛け声が届くことを確かめる。
// pages: 参加している全員の page。check(ok, label) で結果を記録する。
const roleOf = p => p.evaluate(() => window.__taxi?.me || [])
const car = p => p.evaluate(() => window.__taxi.car)

// ボタンの上でマウスを押しっぱなしにする（pointerdown → 一定時間 → pointerup）
async function hold(page, sel, ms) {
  const box = await page.locator(sel).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

export async function playToEnd(pages, check, shot) {
  await pages[0].waitForFunction(() => window.__taxi && window.__taxi.st === 'ready')
  await shot(pages[0], 'ready')
  await pages[0].waitForFunction(() => window.__taxi.st === 'drive', null, { timeout: 8000 })
  const roles = await Promise.all(pages.map(roleOf))
  const find = r => pages[roles.findIndex(rs => rs.includes(r))]
  const engine = find('engine'), wheel = find('wheel') || find('wheelL'), navi = find('navi')
  check(!!engine && !!wheel && !!navi, `担当がそろう ${roles.map(r => r.join('+')).join(' / ')}`)

  // エンジン担当だけがアクセルボタンを持っている
  for (let i = 0; i < pages.length; i++) {
    const n = await pages[i].locator('[data-key="accel"]').count()
    check(n === (roles[i].includes('engine') ? 1 : 0), `アクセルボタンはエンジン担当だけ（${roles[i].join('+')}: ${n}個）`)
  }
  const c0 = await car(engine)
  await hold(engine, '[data-key="accel"]', 900)
  await engine.waitForTimeout(300)
  const c1 = await car(wheel)
  check(c1.x > c0.x + 1, `アクセルを押すと全員の画面で車が進む（x ${c0.x} → ${c1.x}）`)

  // ハンドル担当が右を押しながらエンジン担当がアクセル → 向きが変わる
  const a0 = (await car(engine)).a
  await Promise.all([hold(wheel, '[data-key="right"]', 700), hold(engine, '[data-key="accel"]', 700)])
  await engine.waitForTimeout(250)
  const a1 = (await car(navi)).a
  check(Math.abs(a1 - a0) > 0.3, `ハンドルとアクセルを同時に押すと曲がる（向き ${a0} → ${a1}）`)
  await hold(engine, '[data-key="brake"]', 450) // 長く押すとバックし始めるので短め
  await engine.waitForTimeout(250)
  const v = (await car(engine)).v
  check(v < 1, `ブレーキで止まる（速さ ${v}）`)

  // ナビの掛け声が全員に出る
  await navi.locator('[data-call="right"]').dispatchEvent('pointerdown')
  for (const p of pages) await p.waitForSelector('#t-call:not([hidden])', { timeout: 3000 })
  check(true, 'ナビの「次を右」が全員の画面に出る')
  for (let i = 0; i < pages.length; i++) await shot(pages[i], `game-${roles[i].join('+')}`)

  // 1回押したら離れる（押しっぱなしで残らない）
  const inp = await engine.evaluate(() => window.__taxi.inp)
  check(!inp.accel && !inp.brake, '指を離すと押していない状態に戻る')
}
