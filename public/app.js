// 画面の切り替え（ホーム → ロビー → ゲーム → 結果）。ゲーム中の描画と操作は game-view.js に任せる。
import { connect } from './net.js'
import * as view from './game-view.js'
import { MAPS, MAP_IDS, DEFAULT_MAP } from './map.js'
import * as snd from './sound.js'

const $ = s => document.querySelector(s)
const screens = ['home', 'lobby', 'game', 'result']
const ERR = {
  not_found: 'その部屋は見つかりません。コードを確かめてください',
  full: 'その部屋は満員です',
  started: 'その部屋はもうゲームを始めています。終わるまで待ってください',
  bad_name: 'ニックネームを入れてください（12文字まで）',
  not_host: 'ゲームを始められるのはホストだけです',
  not_enough: '人数が足りません',
  not_playing: 'いまはゲーム中ではありません',
  no_room: '部屋に入っていません',
  closed: 'しばらく動きがなかったので、部屋を閉じました'
}

let state = null, leftCode = null, resultKey = null
const NAME_KEY = 'pg-name'
// ホストが選ぶ街（スタートと再戦のときにサーバーへ送る。サーバー側でも検証する）
const pick = { map: DEFAULT_MAP }
try { const m = localStorage.getItem('taxi-map'); if (MAP_IDS.includes(m)) pick.map = m } catch {}
const CHEV = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const DIFF = n => `<span class="diff" aria-label="むずかしさ${n}">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`

const net = connect({
  onStatus: s => {
    const el = $('#net')
    el.dataset.s = s
    el.textContent = s === 'online' ? '接続中' : s === 'connecting' ? '接続しています' : '切断。つなぎ直しています'
  },
  onMessage: msg => {
    if (msg.t === 'welcome') {
      document.title = '暴走タクシー | みんなで1台を運転する協力ゲーム'
      // 招待URL（/r/ABCD）で開いたら、コード欄を埋めておく
      const m = location.pathname.match(/^\/r\/([A-Z0-9]{4})/i)
      if (m && !msg.code) { $('#code').value = m[1].toUpperCase(); $('#joinBox').open = true; $('#name').focus() }
      if (!msg.code) show('home')
    } else if (msg.t === 'state') {
      if (leftCode && msg.code === leftCode) return // 抜けた直後に届いた古い部屋の状態で、画面を戻さない
      state = msg
      render()
    } else if (msg.t === 'joined') {
      history.replaceState(null, '', '/r/' + msg.code)
    } else if (msg.t === 'error') {
      // ゲーム中の操作の弾かれ（連打・待ち時間・終了直後の押しっぱなし）は画面に出さない。サーバーは状態を変えていない
      if (msg.req === 'input' || ['too_fast', 'over', 'cooldown'].includes(msg.code)) return
      toast(ERR[msg.code] ? ERR[msg.code] + (msg.need ? `（${msg.need}人から）` : '') : 'エラー: ' + msg.code)
    } else if (msg.t === 'closed') {
      state = null; toast(ERR.closed); history.replaceState(null, '', '/'); show('home')
    } else if (msg.t === 'pong') {
      $('#ping').textContent = Math.round(performance.now() - msg.at) + 'ms'
    }
  }
})

function show(name) {
  for (const s of screens) $('#' + s).hidden = s !== name
  document.body.dataset.screen = name
}

function toast(text) {
  const t = $('#toast')
  t.textContent = text; t.hidden = false
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500)
}

function render() {
  if (!state) return show('home')
  const isHost = state.hostId === state.you
  if (state.phase === 'lobby') {
    show('lobby')
    resultKey = null
    $('#roomCode').textContent = state.code
    $('#invite').value = `${location.origin}/r/${state.code}`
    $('#count').textContent = `${state.players.length} / ${state.max}人`
    $('#players').replaceChildren(...state.players.map(p => {
      const li = document.createElement('li')
      li.textContent = p.name
      if (p.id === state.hostId) li.append(badge('ホスト'))
      if (p.id === state.you) li.append(badge('あなた'))
      if (!p.connected) { li.append(badge('切断中')); li.classList.add('off') }
      return li
    }))
    const n = state.players.filter(p => p.connected).length
    const short = state.min - n
    $('#startBtn').hidden = !isHost
    $('#startBtn').disabled = short > 0
    renderSetup(isHost)
    $('#lobbyHint').textContent = short > 0 ? `あと${short}人でスタートできます` : n < 3 ? '少人数は担当をかけ持ち。おすすめは3〜6人' : isHost ? 'そろったら出発' : 'ホストが出発するのを待っています'
  } else if (state.phase === 'playing') {
    show('game')
    view.render(state, { send: data => net.send({ t: 'input', data }) })
  } else if (state.phase === 'result') {
    show('result')
    const r = state.result || {}
    const key = state.code + ':' + state.round
    if (resultKey !== key) {
      resultKey = key
      $('#resultTitle').textContent = r.title || '結果'
      $('#resultTitle').dataset.win = r.win ? '1' : '0'
      $('#resultTitle').dataset.reason = r.reason || ''
      $('#resultBody').replaceChildren(view.renderResult(state))
      window.__lastResult = r // e2e が数え上げの行き先を確かめるため
    }
    $('#rematchBtn').hidden = !isHost
    $('#lobbyBtn').hidden = !isHost
    $('#resultHint').textContent = isHost ? '' : 'ホストが次を選ぶのを待っています'
  }
}

function renderSetup(isHost) {
  // ホストは自分の選択、ほかの人はホストが選んだもの（サーバー経由で届く）を見る
  const sh = state.setup || {}
  const cur = isHost ? pick.map : MAP_IDS.includes(sh.map) ? sh.map : DEFAULT_MAP
  if (isHost && sh.map !== pick.map) net.send({ t: 'setup', opts: { map: pick.map } })
  const m = MAPS[cur]
  const best = view.loadRecords().best[cur]
  const el = $('#mapPick')
  const i = MAP_IDS.indexOf(cur)
  el.dataset.host = isHost ? '1' : '0'
  el.innerHTML = `
    <button type="button" class="pk-btn" data-d="-1" aria-label="前の街">${CHEV(-1)}</button>
    <div class="pk-body" data-id="${cur}" data-theme="${m.theme}"><div class="pk-thumb">${view.mapThumb(cur)}</div><div class="pk-text"><small>街 ${i + 1}/${MAP_IDS.length} ${DIFF(m.stars)}</small><b></b><span class="pk-lead"></span><span class="pk-note"></span></div></div>
    <button type="button" class="pk-btn" data-d="1" aria-label="次の街">${CHEV(1)}</button>`
  el.querySelector('b').textContent = m.name
  el.querySelector('.pk-lead').textContent = m.lead
  el.querySelector('.pk-note').textContent = best ? `自己ベスト ${best.score.toLocaleString('ja-JP')}円・${best.rank === '-' ? '×' : best.rank}` : isHost ? '' : 'ホストが選ぶ'
  for (const b of el.querySelectorAll('.pk-btn')) {
    b.hidden = !isHost
    b.onclick = () => { pick.map = MAP_IDS[(i + Number(b.dataset.d) + MAP_IDS.length) % MAP_IDS.length]; try { localStorage.setItem('taxi-map', pick.map) } catch {}; render() }
  }
}

function badge(text) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = text; return b }

// ---- ボタン
const nameInput = $('#name')
try { nameInput.value = localStorage.getItem(NAME_KEY) || '' } catch {}
const name = () => { const n = nameInput.value.trim(); try { localStorage.setItem(NAME_KEY, n) } catch {}; return n }

$('#createBtn').onclick = () => { leftCode = null; if (!name()) return toast(ERR.bad_name); net.send({ t: 'create', name: name() }) }
$('#joinBtn').onclick = () => {
  leftCode = null
  const code = $('#code').value.trim().toUpperCase()
  if (!name()) return toast(ERR.bad_name)
  if (!/^[A-Z0-9]{4}$/.test(code)) return toast('参加コードは4文字です')
  net.send({ t: 'join', code, name: name() })
}
$('#copyBtn').onclick = async () => {
  const url = $('#invite').value
  try {
    if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: document.title, url })
    else { await navigator.clipboard.writeText(url); toast('招待URLをコピーしました') }
  } catch { $('#invite').select(); toast('URLを長押ししてコピーしてください') }
}
$('#startBtn').onclick = () => { snd.unlock(); net.send({ t: 'start', opts: { map: pick.map } }) }
function leaveRoom() { leftCode = state && state.code; net.send({ t: 'leave' }); state = null; snd.stopBgm(); history.replaceState(null, '', '/'); show('home') }
$('#leaveBtn').onclick = leaveRoom
$('#rematchBtn').onclick = () => net.send({ t: 'rematch', opts: { map: pick.map } })
$('#lobbyBtn').onclick = () => net.send({ t: 'lobby' })
// 抜けるボタンは2回押しで確定（ブラウザの確認ダイアログは使わない）
$('#quitBtn').onclick = () => {
  const b = $('#quitBtn')
  if (b.dataset.armed !== '1') { const icon = b.innerHTML; b.dataset.armed = '1'; b.textContent = 'もう一度で退出'; setTimeout(() => { b.dataset.armed = ''; b.innerHTML = icon }, 2500); return }
  leaveRoom()
}

// 遊び方・記録
const openModal = id => { $('#' + id).hidden = false; $('#' + id + ' .btn.primary').focus() }
$('#howBtn').onclick = () => openModal('howto')
$('#howClose').onclick = () => { $('#howto').hidden = true }
$('#recBtn').onclick = () => { const r = view.recordsHTML(); $('#recCount').textContent = '称号 ' + r.count; $('#recBody').innerHTML = r.html; openModal('records') }
$('#recClose').onclick = () => { $('#records').hidden = true }
for (const id of ['howto', 'records']) $('#' + id).onclick = e => { if (e.target.id === id) $('#' + id).hidden = true }
addEventListener('keydown', e => { if (e.key === 'Escape') { $('#howto').hidden = true; $('#records').hidden = true } })

window.__boot = true
{ const d = document.getElementById('bootErr'); if (d) d.hidden = true } // 遅れて起動できたときは誤報を消す
show('home')
