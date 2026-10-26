/* Old Testament Wordle: host screen (TV) and phone play. */
(function () {
'use strict';

  function learnHtml(w) { if (!w || !w.s) return ''; return '<div class="learn"><h3>The story behind ' + SemCore.esc(w.w.charAt(0) + w.w.slice(1).toLowerCase()) + '</h3><p>' + SemCore.esc(w.s) + '</p><p class="read">Read it: <b>' + SemCore.esc(w.r) + '</b></p></div>'; }
const C = window.SemCore;
const BANK = window.WORDLE_BANK;
const MAXG = 6;
const PFX = 'otw:';

function evaluate(guess, ans) {
  const L = ans.length, res = Array(L).fill('b'), cnt = {};
  for (let i = 0; i < L; i++) { if (guess[i] === ans[i]) res[i] = 'g'; else cnt[ans[i]] = (cnt[ans[i]] || 0) + 1; }
  for (let i = 0; i < L; i++) { if (res[i] !== 'g' && cnt[guess[i]] > 0) { res[i] = 'y'; cnt[guess[i]]--; } }
  return res.join('');
}
function points(n, left, total) { return (MAXG + 1 - n) * 100 + Math.round(100 * Math.max(0, left) / Math.max(1, total)); }
function wordOf(meta) { return BANK[meta.order[meta.qIdx]]; }

function tilesHtml(word, pattern, show) {
  return '<div class="tiles">' + word.split('').map((ch, i) => '<span class="tile ' + (pattern ? pattern[i] : '') + '">' + (show ? ch : '') + '</span>').join('') + '</div>';
}
function miniGrid(rows, L) {
  let h = '<div class="mini">';
  for (let r = 0; r < MAXG; r++) { const p = rows && rows[r]; h += '<div class="mrow">'; for (let i = 0; i < L; i++) h += '<i class="' + (p ? p[i] : '') + '"></i>'; h += '</div>'; }
  return h + '</div>';
}

/* ------------------------------ HOST ------------------------------ */
function mountHost(el, db, opts) {
  opts = opts || {};
  const page = opts.playPage || 'wordle-play.html';
  const S = { code: null, room: null, unwatch: null, ticker: null,
    set: Object.assign({ count: 5, secs: 120, hint: 'after3' }, C.store.get(PFX + 'settings') || {}) };

  function setup() {
    stopRoom();
    const resume = C.store.get(PFX + 'hostRoom');
    const st = S.set;
    const preset = [1, 5, 10].indexOf(st.count) >= 0;
    el.innerHTML = '<div class="wrap narrow host-setup">' +
      '<h1 class="title">Old Testament Wordle</h1>' +
      '<p class="lede">Everyone gets the same five-letter word and six guesses. Faster solves with fewer guesses earn more points.</p>' +
      '<div class="card form">' +
      '<label class="lbl">Number of words</label>' + C.choiceHtml('countPick', [{ v: 1, l: '1' }, { v: 5, l: '5' }, { v: 10, l: '10' }, { v: 'custom', l: 'Custom' }], preset ? st.count : 'custom') +
      '<input id="customCount" class="inp" type="number" min="1" max="' + BANK.length + '" value="' + st.count + '"' + (preset ? ' hidden' : '') + '>' +
      '<label class="lbl">Time per word</label>' + C.choiceHtml('secs', [{ v: 60, l: '1 min' }, { v: 90, l: '1.5 min' }, { v: 120, l: '2 min' }, { v: 180, l: '3 min' }], st.secs) +
      '<label class="lbl">Scripture hint on phones</label>' + C.choiceHtml('hint', [{ v: 'off', l: 'Off' }, { v: 'after3', l: 'After 3 guesses' }, { v: 'start', l: 'From the start' }], st.hint) +
      '<button type="button" class="btn primary block" id="open">Open game room</button>' +
      (resume ? '<button type="button" class="btn ghost block" id="resume">Return to room ' + C.esc(resume) + '</button>' : '') +
      '</div><p class="muted small">' + BANK.length + ' words in the bank. Words do not repeat within a game.</p></div>';
    C.bindChoices(el, st, name => {
      if (name === 'countPick') {
        const inp = el.querySelector('#customCount');
        if (st.countPick === 'custom') { inp.hidden = false; inp.focus(); } else { inp.hidden = true; st.count = st.countPick; inp.value = st.count; }
      }
    });
    el.querySelector('#open').onclick = createRoom;
    const r = el.querySelector('#resume'); if (r) r.onclick = () => openRoom(resume);
  }

  async function createRoom() {
    const st = S.set;
    const ci = el.querySelector('#customCount');
    if (ci && !ci.hidden) st.count = Math.max(1, Math.min(BANK.length, parseInt(ci.value, 10) || 5));
    delete st.countPick;
    C.store.set(PFX + 'settings', st);
    el.querySelector('#open').disabled = true;
    try {
      const code = await C.uniqueCode(db);
      const order = C.fresh('ot-wordle-used', BANK.map((_, i) => i), st.count);
      await db.set(code, { meta: { status: 'lobby', qIdx: 0, total: order.length, order, secs: st.secs, hint: st.hint, left: st.secs, created: Date.now() } });
      openRoom(code);
    } catch (e) { el.querySelector('#open').disabled = false; C.toast(el, 'Could not reach the database. Check config.js.'); }
  }

  function openRoom(code) {
    stopRoom();
    S.code = code; C.store.set(PFX + 'hostRoom', code);
    el.innerHTML = '<div class="wrap wide"><div class="hostbar"><span class="brand">Old Testament Wordle</span><span class="roomtag">Room ' + C.esc(code) + '</span><span class="spacer"></span><span id="ctl"></span></div><div id="stage"></div></div>';
    el.querySelector('#ctl').onclick = onControl;
    S.unwatch = db.watch(code, room => {
      if (!room || !room.meta) { C.store.del(PFX + 'hostRoom'); setup(); return; }
      S.room = room; render();
    });
    S.ticker = setInterval(tick, 500);
  }

  function stopRoom() { if (S.unwatch) S.unwatch(); if (S.ticker) clearInterval(S.ticker); S.unwatch = S.ticker = null; S.room = null; }

  function players() { return (S.room && S.room.players) || {}; }
  function roundData() { const m = S.room.meta; return ((S.room.rounds || {})[m.qIdx]) || {}; }

  function tick() {
    const R = S.room; if (!R || R.meta.status !== 'playing') return;
    const m = R.meta;
    const left = m.secs - Math.floor((Date.now() - m.roundStart) / 1000);
    const ids = Object.keys(players());
    const rd = roundData();
    const allDone = ids.length > 0 && ids.every(id => rd[id] && rd[id].done);
    if (left <= 0 || allDone) { db.patch(S.code + '/meta', { status: 'reveal', left: 0 }); return; }
    if (left !== m.left) { m.left = left; db.patch(S.code + '/meta', { left }); render(); }
  }

  function startRound(i) {
    const m = S.room.meta;
    db.patch(S.code + '/meta', { status: 'playing', qIdx: i, roundStart: Date.now(), left: m.secs });
  }

  function onControl(e) {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act, m = S.room && S.room.meta;
    if (act === 'start') startRound(0);
    else if (act === 'end') db.patch(S.code + '/meta', { status: 'reveal', left: 0 });
    else if (act === 'next') { if (m.qIdx + 1 < m.total) startRound(m.qIdx + 1); else db.patch(S.code + '/meta', { status: 'over' }); }
    else if (act === 'close') { if (confirm('Close this room and go back to setup?')) { const c = S.code; stopRoom(); C.store.del(PFX + 'hostRoom'); db.remove(c); setup(); } }
    else if (act === 'new') { const c = S.code; stopRoom(); C.store.del(PFX + 'hostRoom'); db.remove(c); setup(); }
  }

  function render() {
    const R = S.room, m = R.meta, P = players();
    const ctl = el.querySelector('#ctl'), stage = el.querySelector('#stage');
    const n = Object.keys(P).length;
    if (m.status === 'lobby') {
      ctl.innerHTML = '<button type="button" class="btn ghost" data-act="close">Close room</button> <button type="button" class="btn primary" data-act="start"' + (n ? '' : ' disabled') + '>Start game</button>';
      stage.innerHTML = '<h2 class="screen-title">Scan to join</h2><p class="muted">' + m.total + (m.total === 1 ? ' word' : ' words') + ', ' + C.clock(m.secs) + ' each</p>' + C.lobbyHtml('Wordle', S.code, C.joinUrl(page, S.code), P);
      return;
    }
    const w = wordOf(m), L = w.w.length, rd = roundData();
    if (m.status === 'playing') {
      ctl.innerHTML = '<button type="button" class="btn ghost" data-act="end">End word now</button>';
      const ids = Object.keys(P);
      const done = ids.filter(id => rd[id] && rd[id].done).length;
      const solved = ids.filter(id => rd[id] && rd[id].solved).length;
      stage.innerHTML = '<div class="roundhead"><div><div class="qnum">Word ' + (m.qIdx + 1) + ' of ' + m.total + '</div>' + tilesHtml(w.w, null, false) + '</div>' +
        '<div class="timer' + (m.left <= 10 ? ' low' : '') + '">' + C.clock(m.left) + '</div></div>' +
        '<p class="status">' + solved + ' solved, ' + done + ' of ' + ids.length + ' finished</p>' +
        '<div class="pgrid">' + ids.map(id => { const d = rd[id] || {}; return '<div class="pcard' + (d.solved ? ' solved' : '') + '"><div class="pn">' + C.esc(P[id].name) + '</div>' + miniGrid(d.rows, L) + '</div>'; }).join('') + '</div>';
      return;
    }
    if (m.status === 'reveal') {
      const last = m.qIdx + 1 >= m.total;
      ctl.innerHTML = '<button type="button" class="btn primary" data-act="next">' + (last ? 'Show final results' : 'Next word') + '</button>';
      const res = Object.keys(P).map(id => ({ name: P[id].name, d: rd[id] || {} }))
        .sort((a, b) => (b.d.pts || 0) - (a.d.pts || 0));
      stage.innerHTML = '<div class="reveal"><div class="qnum">Word ' + (m.qIdx + 1) + ' of ' + m.total + '</div>' + tilesHtml(w.w, 'g'.repeat(L), true) +
        '<p class="ref">' + C.esc(w.r) + '</p><p class="note">' + C.esc(w.n) + '</p></div>' + learnHtml(w) +
        '<div class="two"><div class="card"><h3>This word</h3><ol class="board">' + res.map(x => '<li><span class="nm">' + C.esc(x.name) + '</span><span class="sub">' + (x.d.solved ? x.d.n + (x.d.n === 1 ? ' guess' : ' guesses') : 'Not solved') + '</span><span class="pts">+' + C.num(x.d.pts || 0) + '</span></li>').join('') + '</ol></div>' +
        '<div class="card"><h3>Leaderboard</h3>' + C.boardHtml(P, 10) + '</div></div>';
      return;
    }
    if (m.status === 'over') {
      ctl.innerHTML = '<button type="button" class="btn primary" data-act="new">New game</button>';
      stage.innerHTML = '<h2 class="screen-title">Final results</h2>' + C.podiumHtml(P) + '<div class="card">' + C.boardHtml(P) + '</div>';
    }
  }

  setup();
  return { getCode: () => S.code };
}

/* ------------------------------ PHONE ------------------------------ */
function mountPhone(el, db, opts) {
  opts = opts || {};
  let code = C.letters(opts.code || new URLSearchParams(location.search).get('room') || '');
  const S = { room: null, pid: null, name: null, local: null, q: null, view: null, kb: null, unkeys: null, sending: false };

  if (!code) { C.codeForm(el, c => { code = c; start(); }); } else start();

  function start() {
    const saved = C.store.get(PFX + 'me:' + code) || {};
    S.pid = opts.pid || saved.pid || C.uid();
    S.name = saved.name || null;
    db.watch(code, room => { S.room = room; render(); });
    S.unkeys = C.physicalKeys(onKey);
  }

  function join(name) {
    S.name = name; C.store.set(PFX + 'me:' + code, { pid: S.pid, name });
    const rec = { name, score: (S.room.players && S.room.players[S.pid] && S.room.players[S.pid].score) || 0 };
    S.room.players = S.room.players || {}; S.room.players[S.pid] = rec;
    db.patch(code + '/players/' + S.pid, rec);
    S.view = null; render();
  }

  function localKey(q) { return PFX + 'g:' + code + ':' + S.pid + ':' + q; }
  function loadLocal(q) { if (S.q !== q) { S.q = q; S.local = C.store.get(localKey(q)) || { guesses: [], cur: '', sent: false }; } return S.local; }
  function saveLocal() { C.store.set(localKey(S.q), S.local); }

  function me() { return (S.room.players || {})[S.pid]; }

  function onKey(k) {
    const R = S.room; if (!R || !R.meta || R.meta.status !== 'playing' || !me()) return;
    const w = wordOf(R.meta).w, L = w.length, st = loadLocal(R.meta.qIdx);
    const done = st.guesses.some(g => g === w) || st.guesses.length >= MAXG;
    if (done) return;
    if (k === 'DEL') st.cur = st.cur.slice(0, -1);
    else if (k === 'ENTER') {
      if (st.cur.length < L) { C.toast(el, 'Not enough letters'); shake(); return; }
      st.guesses.push(st.cur); st.cur = '';
      const solved = st.guesses[st.guesses.length - 1] === w;
      const fin = solved || st.guesses.length >= MAXG;
      const rows = st.guesses.map(g => evaluate(g, w));
      const upd = {};
      let pts = 0;
      if (solved) pts = points(st.guesses.length, R.meta.left, R.meta.secs);
      upd['rounds/' + R.meta.qIdx + '/' + S.pid] = { rows, done: fin, solved, n: st.guesses.length, pts };
      if (solved && !st.sent) { st.sent = true; upd['players/' + S.pid + '/score'] = (me().score || 0) + pts; st.pts = pts; }
      saveLocal();
      db.patch(code, upd);
      if (solved) C.toast(el, ['Incredible', 'Amazing', 'Great job', 'Nicely done', 'Well done', 'Phew'][st.guesses.length - 1]);
      else if (fin) C.toast(el, 'Out of guesses');
    } else if (st.cur.length < L) st.cur += k;
    saveLocal(); drawPlay();
  }

  function shake() { const r = el.querySelector('.grid .row.cur'); if (r) { r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); } }

  function render() {
    const R = S.room;
    if (!R || !R.meta) { S.view = 'none'; el.innerHTML = '<div class="wrap narrow"><div class="card"><h2>Room ' + C.esc(code) + ' is not open</h2><p class="muted">Check the code on the screen and scan again.</p></div></div>'; return; }
    if (!S.name || !me()) {
      if (S.name && !me()) { join(S.name); return; }
      if (S.view !== 'join') { S.view = 'join'; C.nameForm(el, 'Old Testament Wordle', join); }
      return;
    }
    const m = R.meta;
    if (m.status === 'lobby') return frame('lobby', '<div class="wait"><h2>You are in, ' + C.esc(S.name) + '</h2><p class="muted">Watch the screen. The game starts soon.</p></div>');
    if (m.status === 'playing') {
      if (S.view !== 'play:' + m.qIdx) { S.view = 'play:' + m.qIdx; buildPlay(); }
      drawPlay(); return;
    }
    if (m.status === 'reveal') {
      const w = wordOf(m), st = loadLocal(m.qIdx), d = ((R.rounds || {})[m.qIdx] || {})[S.pid] || {};
      const rank = C.rankOf(R.players, S.pid);
      return frame('reveal:' + m.qIdx + ':' + rank + ':' + me().score, '<div class="reveal">' + tilesHtml(w.w, 'g'.repeat(w.w.length), true) + '<p class="ref">' + C.esc(w.r) + '</p><p class="note">' + C.esc(w.n) + '</p>' + learnHtml(w) +
        '<p class="big">' + (d.solved ? 'Solved in ' + d.n + (d.n === 1 ? ' guess' : ' guesses') + '<br><b>+' + C.num(d.pts) + '</b>' : 'Not this time') + '</p>' +
        '<p class="muted">You are in ' + C.ordinal(rank) + ' place with ' + C.num(me().score) + ' points</p></div>');
    }
    if (m.status === 'over') {
      const rank = C.rankOf(R.players, S.pid);
      return frame('over:' + rank, '<div class="reveal"><h2>Final results</h2><p class="big">' + C.ordinal(rank) + ' place</p><p class="muted">' + C.num(me().score) + ' points</p>' + C.boardHtml(R.players, 5, S.pid) + '</div>');
    }
  }

  function frame(key, inner) {
    if (S.view === key) return;
    S.view = key;
    el.innerHTML = '<div class="phone-top"><span>' + C.esc(S.name) + '</span><span>' + C.num(me().score) + ' pts</span></div><div class="wrap narrow">' + inner + '</div>';
  }

  function buildPlay() {
    el.innerHTML = '<div class="phone-top"><span id="qn"></span><span id="tm" class="tm"></span><span id="sc"></span></div>' +
      '<div class="play"><p class="hint" id="hint" hidden></p><div class="grid" id="grid"></div><p class="after" id="after"></p><div class="kb" id="kb"></div></div>';
    S.kb = C.keyboard(el.querySelector('#kb'), onKey);
  }

  function drawPlay() {
    const R = S.room; if (!R || R.meta.status !== 'playing' || !el.querySelector('#grid')) return;
    const m = R.meta, w = wordOf(m), L = w.w.length, st = loadLocal(m.qIdx);
    el.querySelector('#qn').textContent = 'Word ' + (m.qIdx + 1) + ' of ' + m.total;
    const tm = el.querySelector('#tm'); tm.textContent = C.clock(m.left); tm.classList.toggle('low', m.left <= 10);
    el.querySelector('#sc').textContent = C.num(me().score) + ' pts';
    const showHint = m.hint === 'start' || (m.hint === 'after3' && st.guesses.length >= 3);
    const hint = el.querySelector('#hint'); hint.hidden = !showHint; hint.textContent = 'Hint: ' + w.r;
    let h = '';
    const solved = st.guesses.indexOf(w.w) >= 0, fin = solved || st.guesses.length >= MAXG;
    for (let r = 0; r < MAXG; r++) {
      const g = st.guesses[r], isCur = !g && r === st.guesses.length && !fin;
      const pat = g ? evaluate(g, w.w) : null, text = g || (isCur ? st.cur : '');
      h += '<div class="row' + (isCur ? ' cur' : '') + '">';
      for (let i = 0; i < L; i++) h += '<span class="tile ' + (pat ? pat[i] : (text[i] ? 'typed' : '')) + '">' + (text[i] || '') + '</span>';
      h += '</div>';
    }
    el.querySelector('#grid').innerHTML = h;
    const map = {};
    const rank = { g: 3, y: 2, b: 1 };
    st.guesses.forEach(g => { const p = evaluate(g, w.w); g.split('').forEach((c, i) => { if (!map[c] || rank[p[i]] > rank[map[c]]) map[c] = p[i]; }); });
    S.kb.paint(map);
    el.querySelector('#after').innerHTML = solved ? 'Solved! <b>+' + C.num(st.pts || 0) + '</b> points. Watch the screen.' : fin ? 'Out of guesses. The word appears on the screen soon.' : '';
  }

  return { getPid: () => S.pid };
}

window.OTWordle = { mountHost, mountPhone, evaluate, points, BANK };
})();
