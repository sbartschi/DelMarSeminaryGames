/* Shared helpers for the Old Testament word games (Wordle and Clue Quest). */
(function () {
'use strict';
const C = {};

C.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
C.uid = () => Math.random().toString(36).slice(2, 10);
C.num = n => Number(n || 0).toLocaleString('en-US');
C.letters = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
/* Pick n items from pool, preferring ones not used in recent games on this device. Resets once everything has been used. */
C.fresh = (key, pool, n) => {
  let used = []; try { used = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  let out = C.shuffle(pool.filter(i => used.indexOf(i) < 0)).slice(0, n);
  if (out.length < n) { used = used.filter(i => pool.indexOf(i) < 0); out = out.concat(C.shuffle(pool.filter(i => out.indexOf(i) < 0)).slice(0, n - out.length)); }
  try { localStorage.setItem(key, JSON.stringify(used.concat(out))); } catch (e) {}
  return out;
};
C.shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
C.roomCode = () => { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)]; return s; };
C.clock = secs => { secs = Math.max(0, secs | 0); return Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'); };
C.ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

C.store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* Firebase Realtime Database over REST, with polling for live updates */
C.restDb = function (url, root) {
  url = String(url).replace(/\/+$/, '');
  const u = p => url + '/' + root + (p ? '/' + p : '') + '.json';
  const req = (m, p, b) => fetch(u(p), { method: m, body: b === undefined ? undefined : JSON.stringify(b) })
    .then(r => { if (!r.ok) throw new Error('Database error ' + r.status); return r.json(); });
  return {
    get: p => req('GET', p),
    set: (p, v) => req('PUT', p, v),
    patch: (p, v) => req('PATCH', p, v),
    remove: p => req('DELETE', p),
    watch(p, cb, ms) {
      let stop = false, last;
      const loop = () => {
        if (stop) return;
        req('GET', p).then(v => { const s = JSON.stringify(v); if (s !== last) { last = s; cb(v); } })
          .catch(() => {}).then(() => { if (!stop) setTimeout(loop, ms || 700); });
      };
      loop();
      return () => { stop = true; };
    }
  };
};

/* In-memory database with the same interface, used by the preview */
C.memDb = function () {
  const data = {}, subs = [];
  const parts = p => String(p || '').split('/').filter(Boolean);
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  const read = p => { let n = data; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return clone(n); };
  const write = (p, v) => {
    const ks = parts(p); let n = data;
    for (let i = 0; i < ks.length - 1; i++) { if (typeof n[ks[i]] !== 'object' || n[ks[i]] === null) n[ks[i]] = {}; n = n[ks[i]]; }
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = clone(v);
  };
  const fire = () => setTimeout(() => subs.slice().forEach(s => s()), 0);
  return {
    get: p => Promise.resolve(read(p)),
    set: (p, v) => { write(p, v); fire(); return Promise.resolve(v); },
    patch: (p, v) => { Object.keys(v).forEach(k => write((p ? p + '/' : '') + k, v[k])); fire(); return Promise.resolve(v); },
    remove: p => { write(p, null); fire(); return Promise.resolve(null); },
    watch(p, cb) {
      let last;
      const s = () => { const v = read(p); const j = JSON.stringify(v); if (j !== last) { last = j; cb(v); } };
      subs.push(s); setTimeout(s, 0);
      return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
    }
  };
};

C.makeDb = function (gameRoot) {
  const CFG = window.GAME_CONFIG || {};
  if (!CFG.databaseURL || /YOUR-/.test(CFG.databaseURL)) return null;
  return C.restDb(CFG.databaseURL, (CFG.root || 'seminaryGames') + '/' + gameRoot);
};

C.setupMissing = el => {
  el.innerHTML = '<div class="wrap narrow"><div class="card"><h2>One setup step left</h2><p>Open <b>config.js</b> in this folder and paste your Firebase Realtime Database address.</p></div></div>';
};

C.qrSvg = text => {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
};

C.joinUrl = (page, code) => {
  try { return new URL(page + '?room=' + code, location.href).href; } catch (e) { return page + '?room=' + code; }
};

C.uniqueCode = async db => {
  for (let i = 0; i < 8; i++) { const c = C.roomCode(); const m = await db.get(c + '/meta'); if (!m) return c; }
  return C.roomCode() + Math.floor(Math.random() * 9);
};

/* On-screen keyboard; returns a painter for letter colors */
C.keyboard = function (el, onKey) {
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  el.innerHTML = rows.map((r, i) => '<div class="kb-row">' +
    (i === 2 ? '<button type="button" class="key wide" data-k="ENTER">Enter</button>' : '') +
    r.split('').map(c => '<button type="button" class="key" data-k="' + c + '">' + c + '</button>').join('') +
    (i === 2 ? '<button type="button" class="key wide" data-k="DEL" aria-label="Delete letter">&#9003;</button>' : '') +
    '</div>').join('');
  el.onclick = e => { const b = e.target.closest('[data-k]'); if (b) onKey(b.dataset.k); };
  return {
    paint(map) {
      el.querySelectorAll('[data-k]').forEach(b => { const s = map && map[b.dataset.k]; b.classList.remove('g', 'y', 'b'); if (s) b.classList.add(s); });
    }
  };
};

C.physicalKeys = function (onKey) {
  const h = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Enter') onKey('ENTER');
    else if (e.key === 'Backspace') onKey('DEL');
    else if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toUpperCase());
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', h);
  return () => document.removeEventListener('keydown', h);
};

C.standings = players => Object.keys(players || {}).map(id => Object.assign({ id }, players[id]))
  .sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.name).localeCompare(String(b.name)));

C.rankOf = (players, pid) => { const s = C.standings(players); const i = s.findIndex(p => p.id === pid); return i < 0 ? null : i + 1; };

C.boardHtml = (players, limit, mark) => {
  const s = C.standings(players).slice(0, limit || 99);
  if (!s.length) return '<p class="muted">No players yet</p>';
  return '<ol class="board">' + s.map((p, i) => '<li class="' + (p.id === mark ? 'me' : '') + '"><span class="pos">' + (i + 1) + '</span><span class="nm">' + C.esc(p.name) + '</span><span class="pts">' + C.num(p.score) + '</span></li>').join('') + '</ol>';
};

C.podiumHtml = players => {
  const s = C.standings(players);
  const top = [s[1], s[0], s[2]];
  const cls = ['second', 'first', 'third'];
  return '<div class="podium">' + top.map((p, i) => p ? '<div class="step ' + cls[i] + '"><div class="pname">' + C.esc(p.name) + '</div><div class="ppts">' + C.num(p.score) + '</div><div class="block">' + (i === 1 ? 1 : i === 0 ? 2 : 3) + '</div></div>' : '<div class="step empty"></div>').join('') + '</div>';
};

C.lobbyHtml = (title, code, url, players) => {
  const names = Object.keys(players || {}).map(k => players[k].name);
  return '<div class="lobby">' +
    '<div class="joinbox"><div class="qr">' + C.qrSvg(url) + '</div>' +
    '<div class="joininfo"><p class="muted">Scan to join, or go to the link below and enter the code</p>' +
    '<div class="code">' + C.esc(code) + '</div><p class="url">' + C.esc(url.split('?')[0]) + '</p></div></div>' +
    '<div class="card"><h3>' + names.length + (names.length === 1 ? ' player' : ' players') + ' in the room</h3>' +
    (names.length ? '<div class="chips">' + names.map(n => '<span class="chip">' + C.esc(n) + '</span>').join('') + '</div>' : '<p class="muted">Waiting for students to scan the code</p>') +
    '</div></div>';
};

/* Segmented choice control */
C.choiceHtml = (name, opts, cur) => '<div class="seg" data-name="' + name + '">' + opts.map(o =>
  '<button type="button" class="' + (String(o.v) === String(cur) ? 'on' : '') + '" data-v="' + o.v + '">' + C.esc(o.l) + '</button>').join('') + '</div>';

C.bindChoices = (root, settings, after) => {
  root.querySelectorAll('.seg').forEach(seg => {
    seg.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      const v = b.dataset.v; settings[seg.dataset.name] = isNaN(Number(v)) ? v : Number(v);
      if (after) after(seg.dataset.name);
    };
  });
};

C.toast = (el, msg) => {
  let t = el.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; el.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
};

/* Phone: ask for a room code when the link has none */
C.codeForm = (el, onCode) => {
  el.innerHTML = '<div class="wrap narrow"><div class="card"><h2>Join a game</h2><label class="lbl" for="rc">Room code</label><input id="rc" class="inp big" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="ABCD"><button type="button" class="btn primary block" id="go">Join</button></div></div>';
  const go = () => { const v = C.letters(el.querySelector('#rc').value); if (v.length >= 4) onCode(v); };
  el.querySelector('#go').onclick = go;
  el.querySelector('#rc').onkeydown = e => { if (e.key === 'Enter') go(); };
};

C.nameForm = (el, title, onName) => {
  el.innerHTML = '<div class="wrap narrow"><div class="card"><h2>' + C.esc(title) + '</h2><label class="lbl" for="nm">Your name</label><input id="nm" class="inp big" maxlength="16" autocomplete="off" placeholder="First name"><button type="button" class="btn primary block" id="go">Join the game</button></div></div>';
  const inp = el.querySelector('#nm');
  const go = () => { const v = inp.value.trim().slice(0, 16); if (v) onName(v); else inp.focus(); };
  el.querySelector('#go').onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };
};

window.SemCore = C;
})();
