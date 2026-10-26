/* Old Testament Clue Quest: clues unlock one at a time; earlier answers earn more points. */
(function () {
'use strict';
const C = window.SemCore;
const BANK = window.CLUE_BANK;
const PTS = [400, 300, 200, 100];
const PFX = 'otc:';
const TOPICS = [{ v: 'all', l: 'All' }, { v: 'People', l: 'People' }, { v: 'Places', l: 'Places' }, { v: 'Things and events', l: 'Things and events' }];

function itemOf(meta) { return BANK[meta.order[meta.qIdx]]; }
function learnHtml(item) {
  return '<div class="learn"><h3>About ' + C.esc(item.a.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')) + '</h3><p>' + C.esc(item.s || '') + '</p><p class="read">Read the story: <b>' + C.esc(item.r) + '</b></p></div>';
}

/* Boxes grouped by word so the length and word breaks are clear */
function boxesHtml(answer, typed, cls) {
  let k = 0;
  return '<div class="boxes ' + (cls || '') + '">' + answer.split(' ').map(word => '<span class="bword">' + word.split('').map(() => {
    const ch = typed == null ? '' : (typed[k] || ''); k++;
    return '<span class="box' + (ch ? ' typed' : '') + '">' + C.esc(ch) + '</span>';
  }).join('') + '</span>').join('') + '</div>';
}

function cluesHtml(item, stage, left, big) {
  return '<div class="clues' + (big ? ' big' : '') + '">' + item.c.map((c, i) => {
    if (i < stage) return '<div class="clue on"><span class="cn">Clue ' + (i + 1) + '</span><span class="ct">' + C.esc(c) + '</span><span class="cp">' + PTS[i] + ' pts</span></div>';
    if (i === stage) return '<div class="clue next"><span class="cn">Clue ' + (i + 1) + '</span><span class="ct">Unlocks in ' + Math.max(0, left) + 's</span></div>';
    return '<div class="clue locked"><span class="cn">Clue ' + (i + 1) + '</span><span class="ct">Locked</span></div>';
  }).join('') + '</div>';
}

/* ------------------------------ HOST ------------------------------ */
function mountHost(el, db, opts) {
  opts = opts || {};
  const page = opts.playPage || 'clues-play.html';
  const S = { code: null, room: null, unwatch: null, ticker: null,
    set: Object.assign({ count: 5, clueSecs: 10, tries: 3, topic: 'all' }, C.store.get(PFX + 'settings') || {}) };

  function pool(topic) { return BANK.map((_, i) => i).filter(i => topic === 'all' || BANK[i].t === topic); }

  function setup() {
    stopRoom();
    const resume = C.store.get(PFX + 'hostRoom');
    const st = S.set, preset = [1, 5, 10].indexOf(st.count) >= 0;
    el.innerHTML = '<div class="wrap narrow host-setup">' +
      '<h1 class="title">Old Testament Clue Quest</h1>' +
      '<p class="lede">Clues unlock one at a time. Guess the person, place, or thing early for more points: 400, then 300, 200, and 100.</p>' +
      '<div class="card form">' +
      '<label class="lbl">Number of questions</label>' + C.choiceHtml('countPick', [{ v: 1, l: '1' }, { v: 5, l: '5' }, { v: 10, l: '10' }, { v: 'custom', l: 'Custom' }], preset ? st.count : 'custom') +
      '<input id="customCount" class="inp" type="number" min="1" max="' + BANK.length + '" value="' + st.count + '"' + (preset ? ' hidden' : '') + '>' +
      '<label class="lbl">Seconds per clue</label>' + C.choiceHtml('clueSecs', [{ v: 5, l: '5' }, { v: 10, l: '10' }, { v: 15, l: '15' }, { v: 20, l: '20' }], st.clueSecs) +
      '<label class="lbl">Guesses per question</label>' + C.choiceHtml('tries', [{ v: 1, l: '1' }, { v: 3, l: '3' }, { v: 5, l: '5' }, { v: 0, l: 'Unlimited' }], st.tries) +
      '<label class="lbl">Topic</label>' + C.choiceHtml('topic', TOPICS, st.topic) +
      '<p class="muted small" id="poolNote"></p>' +
      '<button type="button" class="btn primary block" id="open">Open game room</button>' +
      (resume ? '<button type="button" class="btn ghost block" id="resume">Return to room ' + C.esc(resume) + '</button>' : '') +
      '</div></div>';
    const note = () => { const n = pool(st.topic).length; el.querySelector('#poolNote').textContent = n + ' questions available in this topic'; };
    C.bindChoices(el, st, name => {
      if (name === 'countPick') {
        const inp = el.querySelector('#customCount');
        if (st.countPick === 'custom') { inp.hidden = false; inp.focus(); } else { inp.hidden = true; st.count = st.countPick; inp.value = st.count; }
      }
      if (name === 'topic') note();
    });
    note();
    el.querySelector('#open').onclick = createRoom;
    const r = el.querySelector('#resume'); if (r) r.onclick = () => openRoom(resume);
  }

  async function createRoom() {
    const st = S.set, ci = el.querySelector('#customCount');
    if (ci && !ci.hidden) st.count = Math.max(1, parseInt(ci.value, 10) || 5);
    delete st.countPick;
    C.store.set(PFX + 'settings', st);
    el.querySelector('#open').disabled = true;
    try {
      const code = await C.uniqueCode(db);
      const order = C.fresh('ot-clues-used', pool(st.topic), st.count);
      await db.set(code, { meta: { status: 'lobby', qIdx: 0, total: order.length, order, clueSecs: st.clueSecs, tries: st.tries, stage: 1, left: st.clueSecs, created: Date.now() } });
      openRoom(code);
    } catch (e) { el.querySelector('#open').disabled = false; C.toast(el, 'Could not reach the database. Check config.js.'); }
  }

  function openRoom(code) {
    stopRoom();
    S.code = code; C.store.set(PFX + 'hostRoom', code);
    el.innerHTML = '<div class="wrap wide"><div class="hostbar"><span class="brand">Old Testament Clue Quest</span><span class="roomtag">Room ' + C.esc(code) + '</span><span class="spacer"></span><span id="ctl"></span></div><div id="stage"></div></div>';
    el.querySelector('#ctl').onclick = onControl;
    S.unwatch = db.watch(code, room => {
      if (!room || !room.meta) { C.store.del(PFX + 'hostRoom'); setup(); return; }
      S.room = room; render();
    });
    S.ticker = setInterval(tick, 500);
  }

  function stopRoom() { if (S.unwatch) S.unwatch(); if (S.ticker) clearInterval(S.ticker); S.unwatch = S.ticker = null; S.room = null; }
  function players() { return (S.room && S.room.players) || {}; }
  function answers() { const m = S.room.meta; return ((S.room.answers || {})[m.qIdx]) || {}; }

  function tick() {
    const R = S.room; if (!R || R.meta.status !== 'playing') return;
    const m = R.meta;
    const ids = Object.keys(players()), an = answers();
    if (ids.length && ids.every(id => an[id] && an[id].done)) { db.patch(S.code + '/meta', { status: 'reveal', left: 0 }); return; }
    const left = m.clueSecs - Math.floor((Date.now() - m.stageStart) / 1000);
    if (left <= 0) {
      if (m.stage < 4) { m.stage++; m.stageStart = Date.now(); m.left = m.clueSecs; db.patch(S.code + '/meta', { stage: m.stage, stageStart: m.stageStart, left: m.left }); render(); }
      else db.patch(S.code + '/meta', { status: 'reveal', left: 0 });
      return;
    }
    if (left !== m.left) { m.left = left; db.patch(S.code + '/meta', { left }); render(); }
  }

  function startRound(i) {
    db.patch(S.code + '/meta', { status: 'playing', qIdx: i, stage: 1, stageStart: Date.now(), left: S.room.meta.clueSecs });
  }

  function onControl(e) {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act, m = S.room && S.room.meta;
    if (act === 'start') startRound(0);
    else if (act === 'clue') { if (m.stage < 4) db.patch(S.code + '/meta', { stage: m.stage + 1, stageStart: Date.now(), left: m.clueSecs }); }
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
      stage.innerHTML = '<h2 class="screen-title">Scan to join</h2><p class="muted">' + m.total + (m.total === 1 ? ' question' : ' questions') + ', a new clue every ' + m.clueSecs + ' seconds</p>' + C.lobbyHtml('Clue Quest', S.code, C.joinUrl(page, S.code), P);
      return;
    }
    const item = itemOf(m), an = answers();
    if (m.status === 'playing') {
      ctl.innerHTML = (m.stage < 4 ? '<button type="button" class="btn ghost" data-act="clue">Next clue now</button> ' : '') + '<button type="button" class="btn ghost" data-act="end">End question</button>';
      const ids = Object.keys(P);
      const got = ids.filter(id => an[id] && an[id].ok).length;
      stage.innerHTML = '<div class="roundhead"><div><div class="qnum">Question ' + (m.qIdx + 1) + ' of ' + m.total + '</div>' + boxesHtml(item.a, null, 'host') + '</div>' +
        '<div class="timer' + (m.left <= 3 ? ' low' : '') + '">' + m.left + 's</div></div>' +
        cluesHtml(item, m.stage, m.left, true) +
        (m.stage === 4 ? '<p class="status">Last clue. Final ' + m.clueSecs + ' seconds to answer.</p>' : '') +
        '<p class="status">' + got + ' of ' + ids.length + ' have it</p>' +
        '<div class="chips">' + ids.map(id => { const a = an[id]; return '<span class="chip' + (a && a.ok ? ' ok' : a && a.done ? ' out' : '') + '">' + C.esc(P[id].name) + (a && a.ok ? ' (clue ' + a.stage + ')' : '') + '</span>'; }).join('') + '</div>';
      return;
    }
    if (m.status === 'reveal') {
      const last = m.qIdx + 1 >= m.total;
      ctl.innerHTML = '<button type="button" class="btn primary" data-act="next">' + (last ? 'Show final results' : 'Next question') + '</button>';
      const res = Object.keys(P).map(id => ({ name: P[id].name, a: an[id] || {} })).sort((x, y) => (y.a.pts || 0) - (x.a.pts || 0));
      stage.innerHTML = '<div class="reveal"><div class="qnum">Question ' + (m.qIdx + 1) + ' of ' + m.total + '</div>' + boxesHtml(item.a, C.letters(item.a), 'host solved') + '</div>' + learnHtml(item) +
        cluesHtml(item, 4, 0, false) +
        '<div class="two"><div class="card"><h3>This question</h3><ol class="board">' + res.map(x => '<li><span class="nm">' + C.esc(x.name) + '</span><span class="sub">' + (x.a.ok ? 'Clue ' + x.a.stage : 'Missed') + '</span><span class="pts">+' + C.num(x.a.pts || 0) + '</span></li>').join('') + '</ol></div>' +
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
  const S = { room: null, pid: null, name: null, cur: '', q: null, view: null, kb: null };

  if (!code) C.codeForm(el, c => { code = c; start(); }); else start();

  function start() {
    const saved = C.store.get(PFX + 'me:' + code) || {};
    S.pid = opts.pid || saved.pid || C.uid();
    S.name = saved.name || null;
    db.watch(code, room => { S.room = room; render(); });
    C.physicalKeys(onKey);
  }

  function join(name) {
    S.name = name; C.store.set(PFX + 'me:' + code, { pid: S.pid, name });
    const rec = { name, score: (S.room.players && S.room.players[S.pid] && S.room.players[S.pid].score) || 0 };
    S.room.players = S.room.players || {}; S.room.players[S.pid] = rec;
    db.patch(code + '/players/' + S.pid, rec);
    S.view = null; render();
  }

  function me() { return (S.room.players || {})[S.pid]; }
  function mine() { const m = S.room.meta; return (((S.room.answers || {})[m.qIdx]) || {})[S.pid] || { tries: 0 }; }

  function onKey(k) {
    const R = S.room; if (!R || !R.meta || R.meta.status !== 'playing' || !me()) return;
    const m = R.meta, item = itemOf(m), target = C.letters(item.a), a = mine();
    if (a.done) return;
    if (S.q !== m.qIdx) { S.q = m.qIdx; S.cur = ''; }
    if (k === 'DEL') S.cur = S.cur.slice(0, -1);
    else if (k === 'ENTER') {
      if (S.cur.length < target.length) { C.toast(el, 'Fill every box first'); shake(); return; }
      const tries = (a.tries || 0) + 1, ok = S.cur === target;
      const out = !ok && m.tries > 0 && tries >= m.tries;
      const rec = { tries, ok, done: ok || out, stage: m.stage, pts: ok ? PTS[m.stage - 1] : 0 };
      const upd = {}; upd['answers/' + m.qIdx + '/' + S.pid] = rec;
      if (ok) upd['players/' + S.pid + '/score'] = (me().score || 0) + rec.pts;
      // apply locally right away so a fast second tap cannot double count
      R.answers = R.answers || {}; R.answers[m.qIdx] = R.answers[m.qIdx] || {}; R.answers[m.qIdx][S.pid] = rec;
      db.patch(code, upd);
      if (ok) C.toast(el, 'Correct! +' + rec.pts);
      else { C.toast(el, out ? 'Out of guesses' : 'Not it. Try again'); shake(); S.cur = ''; }
    } else if (S.cur.length < target.length) S.cur += k;
    drawPlay();
  }

  function shake() { const b = el.querySelector('.boxes'); if (b) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); } }

  function frame(key, inner) {
    if (S.view === key) return;
    S.view = key;
    el.innerHTML = '<div class="phone-top"><span>' + C.esc(S.name) + '</span><span>' + C.num(me().score) + ' pts</span></div><div class="wrap narrow">' + inner + '</div>';
  }

  function render() {
    const R = S.room;
    if (!R || !R.meta) { S.view = 'none'; el.innerHTML = '<div class="wrap narrow"><div class="card"><h2>Room ' + C.esc(code) + ' is not open</h2><p class="muted">Check the code on the screen and scan again.</p></div></div>'; return; }
    if (!S.name || !me()) {
      if (S.name && !me()) { join(S.name); return; }
      if (S.view !== 'join') { S.view = 'join'; C.nameForm(el, 'Old Testament Clue Quest', join); }
      return;
    }
    const m = R.meta;
    if (m.status === 'lobby') return frame('lobby', '<div class="wait"><h2>You are in, ' + C.esc(S.name) + '</h2><p class="muted">Watch the screen. The game starts soon.</p></div>');
    if (m.status === 'playing') {
      if (S.view !== 'play:' + m.qIdx) {
        S.view = 'play:' + m.qIdx; S.q = m.qIdx; S.cur = '';
        el.innerHTML = '<div class="phone-top"><span id="qn"></span><span id="tm" class="tm"></span><span id="sc"></span></div>' +
          '<div class="play"><div id="clues"></div><div id="boxes"></div><p class="after" id="after"></p><div class="kb" id="kb"></div></div>';
        S.kb = C.keyboard(el.querySelector('#kb'), onKey);
      }
      drawPlay(); return;
    }
    if (m.status === 'reveal') {
      const item = itemOf(m), a = mine(), rank = C.rankOf(R.players, S.pid);
      return frame('reveal:' + m.qIdx + ':' + rank + ':' + me().score, '<div class="reveal">' + boxesHtml(item.a, C.letters(item.a), 'solved') +
        '<p class="big">' + (a.ok ? 'Got it on clue ' + a.stage + '<br><b>+' + C.num(a.pts) + '</b>' : 'Not this time') + '</p>' +
        '<p class="muted">You are in ' + C.ordinal(rank) + ' place with ' + C.num(me().score) + ' points</p></div>' + learnHtml(item));
    }
    if (m.status === 'over') {
      const rank = C.rankOf(R.players, S.pid);
      return frame('over:' + rank, '<div class="reveal"><h2>Final results</h2><p class="big">' + C.ordinal(rank) + ' place</p><p class="muted">' + C.num(me().score) + ' points</p>' + C.boardHtml(R.players, 5, S.pid) + '</div>');
    }
  }

  function drawPlay() {
    const R = S.room; if (!R || R.meta.status !== 'playing' || !el.querySelector('#boxes')) return;
    const m = R.meta, item = itemOf(m), a = mine();
    el.querySelector('#qn').textContent = 'Question ' + (m.qIdx + 1) + ' of ' + m.total;
    const tm = el.querySelector('#tm'); tm.textContent = m.left + 's'; tm.classList.toggle('low', m.left <= 3);
    el.querySelector('#sc').textContent = C.num(me().score) + ' pts';
    el.querySelector('#clues').innerHTML = cluesHtml(item, m.stage, m.left, false);
    el.querySelector('#boxes').innerHTML = boxesHtml(item.a, a.ok ? C.letters(item.a) : S.cur, a.ok ? 'solved' : '');
    const triesLeft = m.tries > 0 ? m.tries - (a.tries || 0) : null;
    el.querySelector('#after').innerHTML = a.ok ? 'Correct on clue ' + a.stage + '! <b>+' + C.num(a.pts) + '</b>' :
      a.done ? 'Out of guesses. Watch the screen for the answer.' :
      'Worth <b>' + PTS[m.stage - 1] + '</b> points now' + (triesLeft != null ? ', ' + triesLeft + (triesLeft === 1 ? ' guess' : ' guesses') + ' left' : '');
    el.querySelector('#kb').style.visibility = a.done ? 'hidden' : '';
  }

  return { getPid: () => S.pid };
}

window.OTClues = { mountHost, mountPhone, BANK, PTS };
})();
