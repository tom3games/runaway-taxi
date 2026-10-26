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
const tap = (page, sel) => hold(page, sel, 60)

export async function playToEnd(pages, check, shot) {
  await pages[0].waitForFunction(() => window.__taxi && window.__taxi.st === 'ready')
  await pages[0].waitForTimeout(400)
  await shot(pages[0], 'ready')
  const rd = await pages[0].textContent('.rd-roles')
  check(rd.trim().length > 0, `開始前に自分の担当が出る（${rd.trim()}）`)
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
  // アクセルはスイッチ: 1回押して離しても入ったまま、全員の画面で車が進む
  const c0 = await car(engine)
  await tap(engine, '[data-key="accel"]')
  await engine.waitForTimeout(900)
  const c1 = await car(wheel)
  const moved = Math.hypot(c1.x - c0.x, c1.y - c0.y)
  check(moved > 1, `アクセルを1回押すと入りっぱなしで、全員の画面で車が進む（${moved.toFixed(2)}マス）`)
  await engine.waitForTimeout(900) // サーバーが「離した」とみなす1.5秒を越えても入ったまま
  const on = await engine.evaluate(() => ({ inp: window.__taxi.inp.accel, aria: document.querySelector('[data-key="accel"]').getAttribute('aria-pressed') }))
  check(on.inp === true && on.aria === 'true', `指を離して1.8秒たってもアクセルが入ったまま（${JSON.stringify(on)}）`)
  // ハンドル担当が右を押す → 向きが変わる。ほかの人の画面ではウインカーの計器が光る
  const a0 = (await car(engine)).a
  await hold(wheel, '[data-key="right"]', 700)
  await engine.waitForTimeout(250)
  const a1 = (await car(navi)).a
  check(Math.abs(a1 - a0) > 0.3, `アクセルが入ったままハンドルを押すと曲がる（向き ${a0} → ${a1}）`)
  // ブレーキを押すとアクセルのスイッチが切れて止まる
  await hold(engine, '[data-key="brake"]', 450) // 長く押すとバックし始めるので短め
  await engine.waitForTimeout(400)
  const st = await engine.evaluate(() => ({ v: window.__taxi.car.v, accel: window.__taxi.inp.accel, aria: document.querySelector('[data-key="accel"]').getAttribute('aria-pressed') }))
  check(st.v < 1.2 && !st.accel && st.aria === 'false', `ブレーキでアクセルが切れて止まる（${JSON.stringify(st)}）`)
  // ナビの掛け声が全員に出る
  await navi.locator('[data-call="right"]').dispatchEvent('pointerdown')
  for (const p of pages) await p.waitForSelector('#t-call:not([hidden])', { timeout: 3000 })
  check(true, 'ナビの「次を右」が全員の画面に出る')
  for (let i = 0; i < pages.length; i++) await shot(pages[i], `game-${roles[i].join('+')}`)
  const inp = await engine.evaluate(() => window.__taxi.inp)
  check(!inp.accel && !inp.brake, '指を離すと押していない状態に戻る')
  return roles
}
