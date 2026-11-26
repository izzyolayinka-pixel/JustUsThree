'use strict';
// ===== Just Us Three · polish layer (loads AFTER extras.js; adds to the app, removes nothing) =====
(() => {
const $q = (s, r = document) => r.querySelector(s);
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const REPLY = 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z';
const SMILE = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z';
const EM = '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤗 🤔 🫡 🤭 😐 😏 😒 🙄 😬 😌 😔 😴 🤒 🤯 🥳 🥺 🥹 😭 😤 😡 😱 😨 🫠 🫶 👏 🙌 🤝 👍 👎 👌 ✌️ 🤞 💪 🙏 🔥 ✨ 🎉 💯 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 😈 💀 👀 🤌 🤦 🤷 🙋'.split(' ');
const EM2 = '🍚 🌶️ 🍕 🍔 🍟 🍗 🍰 🍫 ☕ 🍻 🥂 🎂 ⚽ 🏀 🎮 🎧 🎬 📸 🚗 ✈️ 🌍 🌹 🌞 🌙 ⭐ 🍀 🐶 🐱 🦁 🐸 🙈 🙉 🙊 💃 🕺 🏆 💸 💡 📌 ✅ ❌ ⚠️ 🔒 🎁 🇳🇬'.split(' ');
const msgBox = $('messages'), S = $('sheet');

// ---------- finger tracking (stops accidental taps right after a long-press) ----------
let down = 0, lastUp = 0, openedAt = 0;
document.addEventListener('touchstart', e => { down = e.touches.length; }, { capture: true, passive: true });
const upH = e => { down = e.touches.length; lastUp = Date.now(); };
document.addEventListener('touchend', upH, { capture: true, passive: true });
document.addEventListener('touchcancel', upH, { capture: true, passive: true });
const tooSoon = t0 => down > 0 || Date.now() - Math.max(t0, lastUp) < 380;

// ---------- WhatsApp-style text formatting: *bold* _italic_ ~strike~ `code` ----------
const FMT = /(https?:\/\/[^\s]+|@[a-z0-9_]{3,20}\b|(?<![\w*])\*[^*\n]+\*(?![\w*])|(?<![\w_])_[^_\n]+_(?![\w_])|(?<![\w~])~[^~\n]+~(?![\w~])|`[^`\n]+`)/gi;
const _linkify = linkify;
linkify = function (host, text) {
  try {
    const frag = document.createDocumentFragment();
    text.split(FMT).forEach((part, i) => {
      if (!part) return;
      if (i % 2 === 0) { frag.appendChild(document.createTextNode(part)); return; }
      if (/^https?:\/\//i.test(part)) {
        const tail = (part.match(/[.,;:!?)]+$/) || [''])[0];
        const url = tail ? part.slice(0, -tail.length) : part;
        const a = el('a', '', url);
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.onclick = e => e.stopPropagation();
        frag.appendChild(a);
        if (tail) frag.appendChild(document.createTextNode(tail));
      } else if (part[0] === '@') {
        frag.appendChild(el('span', 'mention' + (part.slice(1).toLowerCase() === me.username ? ' me' : ''), part));
      } else {
        const tag = { '*': 'b', '_': 'i', '~': 's', '`': 'code' }[part[0]];
        frag.appendChild(el(tag, '', part.slice(1, -1)));
      }
    });
    host.appendChild(frag);
  } catch (e) { _linkify(host, text); }
};

// ---------- reactions: instant (optimistic), then synced ----------
const _react = react;
react = async function (id, emoji) {
  try {
    closeSheet();
    const arr = reacts[id] = reacts[id] || [];
    const i = arr.findIndex(r => r.user_id === me.id);
    const same = i > -1 && arr[i].emoji === emoji;
    if (i > -1) arr.splice(i, 1);
    if (!same) arr.push({ message_id: id, user_id: me.id, emoji });
    renderReacts(id);
    if (!same) { const p = $q(`.msg[data-id="${id}"] .pill.mine`); if (p) p.classList.add('pop'); }
    const { error } = same
      ? await db.from('reactions').delete().eq('message_id', id).eq('user_id', me.id)
      : await db.from('reactions').upsert({ message_id: id, user_id: me.id, emoji }, { onConflict: 'message_id,user_id' });
    if (error) toast('Could not react');
    loadReactions();
  } catch (e) { _react(id, emoji); }
};

// ---------- the long-press menu: smooth, with a preview, and no accidental taps ----------
const _openSheet = openSheet;
let sheetT = null;
function ensureExtra() {
  if ($('shareBtn')) return;
  const mk = (id, ic, lb, fn) => { const b = el('button'); b.id = id; b.innerHTML = `<i>${ic}</i><b>${lb}</b>`; b.onclick = fn; return b; };
  $('copyBtn').after(
    mk('shareBtn', '⤴', 'Share', async () => {
      const m = sheetMsg; closeSheet();
      try { await navigator.share(m.media_url ? { title: 'Just Us Three', text: m.content || '', url: m.media_url } : { text: m.content }); } catch (e) {}
    }),
    mk('dlBtn', '⬇', 'Save media', () => {
      const m = sheetMsg; closeSheet();
      const a = el('a'); a.href = m.media_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.download = m.media_name || '';
      document.body.appendChild(a); a.click(); a.remove();
    }));
}
openSheet = function (m) {
  try {
    clearTimeout(sheetT);
    sheetMsg = m; lpFired = Date.now(); openedAt = Date.now();
    const mine = m.sender_id === me.id;
    S.classList.remove('hidden', 'closing', 'picking');
    S.classList.add('arming');
    setTimeout(() => S.classList.remove('arming'), 420);
    const mineR = (reacts[m.id] || []).find(r => r.user_id === me.id);
    const row = $('emojiRow'); row.innerHTML = '';
    EMOJIS.forEach((e, i) => {
      const b = el('button', 'emo' + (mineR && mineR.emoji === e ? ' on' : ''), e);
      b.style.setProperty('--i', i); b.onclick = () => react(m.id, e); row.appendChild(b);
    });
    const more = el('button', 'emo more', '＋'); more.style.setProperty('--i', EMOJIS.length);
    more.onclick = () => S.classList.add('picking'); row.appendChild(more);
    let grid = $('emojiMore');
    if (!grid) { grid = el('div'); grid.id = 'emojiMore'; row.after(grid); }
    grid.innerHTML = '';
    EM.forEach(e => { const b = el('button', 'emo', e); b.style.animation = 'none'; b.onclick = () => react(m.id, e); grid.appendChild(b); });
    const old = $('sheetPrev'); if (old) old.remove();
    const src = $q(`#messages .msg[data-id="${m.id}"]`);
    if (src) {
      const prev = el('div', 'sheetprev' + (mine ? ' mine' : '')); prev.id = 'sheetPrev';
      const c = src.cloneNode(true);
      c.removeAttribute('data-id'); c.classList.remove('in', 'sel', 'flash', 'pressing', 'hasr'); c.style.transform = '';
      c.querySelectorAll('video,audio,iframe,.reacts,.swipeico,.heart,.speed').forEach(n => n.remove());
      prev.appendChild(c); $('menuList').before(prev);
    }
    ensureExtra();
    $('copyBtn').classList.toggle('hidden', !m.content);
    $('shareBtn').classList.toggle('hidden', !(navigator.share && (m.content || m.media_url)));
    $('dlBtn').classList.toggle('hidden', !m.media_url);
    $('sStar').querySelector('b').textContent = starred.has(m.id) ? 'Remove star' : 'Star';
    $('sPin').querySelector('b').textContent = pinned.has(m.id) ? 'Unpin' : 'Pin';
    $('editBtn').classList.toggle('hidden', !(mine && m.content && !m.media_type && Date.now() - new Date(m.created_at) < EDIT_MS));
    $('delAllBtn').classList.toggle('hidden', !mine);
    [...$('menuList').children].filter(b => !b.classList.contains('hidden')).forEach((b, i) => b.style.setProperty('--i', i));
    $('menuList').scrollTop = 0;
  } catch (e) { console.error(e); S.classList.remove('arming'); _openSheet(m); }
};
closeSheet = function () {
  if (S.classList.contains('hidden') || S.classList.contains('closing')) return;
  if (selEl) { selEl.classList.remove('sel'); selEl = null; }
  S.classList.add('closing');
  clearTimeout(sheetT);
  sheetT = setTimeout(() => { S.classList.add('hidden'); S.classList.remove('closing', 'picking', 'arming'); }, 160);
};
S.addEventListener('click', e => { if (tooSoon(openedAt)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
openFor = function (node) {
  const m = msgs[node.dataset.id];
  if (!m || m.media_type === 'call') return;
  buzz(14);
  openSheet(m);
};

// ---------- touch gestures on messages: long-press, swipe-to-reply (replaces the old ones) ----------
let g = null, lpT = null;
const TH = 56;
function endG(reply) {
  if (!g) return;
  const { el: m, ico: ic, lock } = g; clearTimeout(g.pressT); clearTimeout(lpT); g = null;
  m.classList.remove('pressing');
  if (!lock) return;
  m.style.transition = 'transform .38s cubic-bezier(.34,1.56,.64,1)'; m.style.transform = '';
  if (ic) { ic.style.transition = 'opacity .2s, scale .2s'; ic.style.opacity = 0; ic.style.scale = .4; }
  setTimeout(() => { m.style.transition = ''; if (ic) ic.remove(); }, 400);
  if (reply) { const x = msgs[m.dataset.id]; if (x) { buzz(8); setReply(x); } }
}
msgBox.addEventListener('touchstart', e => {
  e.stopPropagation();
  clearTimeout(lpT); endG(false);
  const node = e.target.closest('.msg:not(.callmsg)');
  if (!node || e.touches.length !== 1) return;
  const t = e.touches[0];
  g = { el: node, x: t.clientX, y: t.clientY, dx: 0, lock: false, hit: false, ico: null, noSwipe: !!e.target.closest('audio,video') };
  g.pressT = setTimeout(() => { if (g) g.el.classList.add('pressing'); }, 140);
  lpT = setTimeout(() => { if (!g) return; const n = g.el; clearTimeout(g.pressT); n.classList.remove('pressing'); g = null; openFor(n); }, 420);
}, { capture: true, passive: true });
msgBox.addEventListener('touchmove', e => {
  e.stopPropagation();
  if (!g) return;
  const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { clearTimeout(lpT); clearTimeout(g.pressT); g.el.classList.remove('pressing'); }
  if (!g.lock) {
    if (Math.abs(dy) > 10 || g.noSwipe) { endG(false); return; }
    if (dx > 14 && dx > Math.abs(dy) * 1.5) {
      g.lock = true; g.el.style.transition = 'none';
      g.ico = el('div', 'swipeico'); g.ico.innerHTML = ico(REPLY); g.el.appendChild(g.ico);
    } else return;
  }
  const x = Math.max(dx, 0);
  g.dx = Math.min(x < TH ? x : TH + (x - TH) * .25, 84);
  g.el.style.transform = `translateX(${g.dx}px)`;
  const p = Math.min(g.dx / TH, 1);
  g.ico.style.opacity = p; g.ico.style.scale = .4 + .6 * p;
  const hit = g.dx >= TH;
  if (hit !== g.hit) { g.hit = hit; g.ico.classList.toggle('go', hit); if (hit) buzz(10); }
}, { capture: true, passive: true });
msgBox.addEventListener('touchend', e => { e.stopPropagation(); endG(!!(g && g.hit)); }, { capture: true });
msgBox.addEventListener('touchcancel', e => { e.stopPropagation(); endG(false); }, { capture: true });

// ---------- double-tap (or double-click) = Love ❤️ ; tap a reaction to toggle it ----------
let lastTap = { id: '', t: 0 };
function love(node) {
  const id = Number(node.dataset.id);
  if (!msgs[id]) return;
  const h = el('div', 'heart', '❤️'); node.appendChild(h); setTimeout(() => h.remove(), 850);
  buzz(15);
  $('lightbox').classList.add('hidden');
  const mineR = (reacts[id] || []).find(r => r.user_id === me.id);
  if (!(mineR && mineR.emoji === '❤️')) react(id, '❤️');
}
msgBox.addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  const node = e.target.closest('.msg:not(.callmsg)');
  if (!node) return;
  if (pill) { react(Number(node.dataset.id), pill.textContent.trim().split(' ')[0]); return; }
  if (e.target.closest('a,button,video,audio,.popt,.quote,.more,input')) return;
  const now = Date.now();
  if (lastTap.id === node.dataset.id && now - lastTap.t < 320) { lastTap = { id: '', t: 0 }; love(node); }
  else lastTap = { id: node.dataset.id, t: now };
});

// ---------- floating date chip + "new messages" counter on the scroll-down button ----------
const chip = el('div'); chip.id = 'dayFloat'; $('chatPane').appendChild(chip);
const tb = $('toBottom'), badge = el('span'); badge.id = 'tbBadge'; tb.appendChild(badge);
let nb = 0, chipT = null, raf = 0;
const setBadge = n => { nb = n; badge.textContent = n ? (n > 99 ? '99+' : String(n)) : ''; };
function topDay() {
  const c = msgBox.children, st = msgBox.scrollTop + 10, base = msgBox.offsetTop;
  let lo = 0, hi = c.length - 1, k = c.length;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].offsetTop - base + c[mid].offsetHeight > st) { k = mid; hi = mid - 1; } else lo = mid + 1; }
  for (let i = k; i < c.length && i < k + 6; i++) {
    const n = c[i];
    if (n.dataset && n.dataset.day) return dayLabel(new Date(n.dataset.day).toISOString());
    const m = n.dataset && msgs[n.dataset.id];
    if (m) return dayLabel(m.created_at);
  }
  return '';
}
msgBox.addEventListener('scroll', () => {
  if (nearBottom()) setBadge(0);
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const l = topDay();
    if (!l) return;
    chip.textContent = l; chip.style.top = (msgBox.offsetTop + 10) + 'px'; chip.classList.add('show');
    clearTimeout(chipT); chipT = setTimeout(() => chip.classList.remove('show'), 1100);
  });
}, { passive: true });
tb.addEventListener('click', () => setBadge(0));
new MutationObserver(list => {
  list.forEach(r => r.addedNodes.forEach(n => {
    if (n.classList && n.classList.contains('msg') && n.classList.contains('in') && !n.classList.contains('mine') && !nearBottom()) setBadge(nb + 1);
  }));
}).observe(msgBox, { childList: true });

// ---------- emoji keyboard + @mention suggestions in the composer ----------
const pill = $q('.inputpill'), cm = $('composerMain'), ta = $('msgInput');
const eb = el('button', 'iconbtn'); eb.id = 'emojiBtn'; eb.type = 'button'; eb.innerHTML = ico(SMILE); pill.prepend(eb);
const panel = el('div', 'emojipanel hidden'); panel.id = 'emojiPanel'; cm.appendChild(panel);
function insertEmoji(e) {
  const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, en = ta.selectionEnd == null ? s : ta.selectionEnd;
  ta.setRangeText(e, s, en, 'end');
  ta.dispatchEvent(new Event('input'));
  ls.set('j3_recent_emoji', [e, ...ls.get('j3_recent_emoji', []).filter(x => x !== e)].slice(0, 16));
}
function buildPanel() {
  panel.innerHTML = '';
  const add = (label, list) => {
    if (!list.length) return;
    panel.append(el('div', 'eplab', label));
    const grid = el('div', 'epgrid');
    list.forEach(e => { const b = el('button', 'ep', e); b.type = 'button'; b.onclick = () => insertEmoji(e); grid.append(b); });
    panel.append(grid);
  };
  add('Recent', ls.get('j3_recent_emoji', [])); add('Smileys and gestures', EM); add('Fun and food', EM2);
}
panel.addEventListener('mousedown', e => e.preventDefault());
eb.onclick = e => {
  e.stopPropagation();
  $('attachMenu').classList.add('hidden'); $('chatMenu').classList.add('hidden');
  const open = panel.classList.contains('hidden');
  if (open) buildPanel();
  panel.classList.toggle('hidden', !open); eb.classList.toggle('on', open);
};
document.addEventListener('click', e => {
  if (e.target.closest('#emojiPanel,#emojiBtn')) return;
  panel.classList.add('hidden'); eb.classList.remove('on');
});
$('attachBtn').addEventListener('click', () => { panel.classList.add('hidden'); eb.classList.remove('on'); });
const mb = el('div', 'mentionbox hidden'); mb.id = 'mentionBox'; cm.appendChild(mb);
ta.addEventListener('input', () => {
  if (!current || !current.isGroup) { mb.classList.add('hidden'); return; }
  const pos = ta.selectionStart, m = /(?:^|\s)@([a-z0-9_]*)$/i.exec(ta.value.slice(0, pos));
  if (!m) { mb.classList.add('hidden'); return; }
  const q = m[1].toLowerCase();
  const list = (members[current.gid] || []).map(r => r.user_id).filter(id => id !== me.id)
    .map(id => friends.find(f => f.id === id)).filter(f => f && f.username.toLowerCase().startsWith(q)).slice(0, 5);
  if (!list.length) { mb.classList.add('hidden'); return; }
  mb.innerHTML = '';
  list.forEach(f => {
    const b = el('button'); b.type = 'button'; b.append(avatar(f), el('span', '', f.username));
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { ta.setRangeText('@' + f.username + ' ', pos - q.length - 1, pos, 'end'); mb.classList.add('hidden'); ta.dispatchEvent(new Event('input')); ta.focus(); };
    mb.appendChild(b);
  });
  mb.classList.remove('hidden');
});

// ---------- chat list: long-press a chat for quick actions ----------
function actionSheet(title, items) {
  const prev = $q('.psheet'); if (prev) prev.remove();
  const o = el('div', 'psheet'), box = el('div', 'pbox'), t0 = Date.now();
  const close = () => { o.classList.add('out'); setTimeout(() => o.remove(), 190); };
  o.addEventListener('click', e => { if (tooSoon(t0)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  o.onclick = e => { if (e.target === o) close(); };
  box.append(el('div', 'grab'));
  if (title) box.append(el('div', 't', title));
  items.forEach(([ic, lb, fn, bad]) => {
    const b = el('button', bad ? 'red' : ''); b.innerHTML = `<i>${ic}</i><b></b>`; b.lastChild.textContent = lb;
    b.onclick = () => { close(); fn(); }; box.append(b);
  });
  o.append(box); document.body.append(o);
}
function chatActions(id) {
  const c = chatByKey(id); if (!c) return;
  const has = k => ls.get(k, []).includes(id);
  const flip = k => { const s = new Set(ls.get(k, [])); s.has(id) ? s.delete(id) : s.add(id); ls.set(k, [...s]); renderChats(); };
  const items = [['💬', 'Open chat', () => openChat(c)]];
  if (unread[id]) items.push(['✓', 'Mark as read', () => { unread[id] = 0; markSeen(id); renderChats(); }]);
  items.push(
    [has('j3_pinchats') ? '📍' : '📌', has('j3_pinchats') ? 'Unpin from top' : 'Pin to top', () => flip('j3_pinchats')],
    [has('j3_muted') ? '🔔' : '🔇', has('j3_muted') ? 'Unmute notifications' : 'Mute notifications', () => flip('j3_muted')],
    ['🗄', has('j3_archived') ? 'Unarchive chat' : 'Archive chat', () => { const was = has('j3_archived'); flip('j3_archived'); toast(was ? 'Chat unarchived' : 'Chat archived'); }]);
  actionSheet(c.username, items);
}
const _chatRow = chatRow;
chatRow = u => { const r = _chatRow(u); r.dataset.cid = u.id; return r; };
const ul = $('userList');
let rowT = null, rowDone = 0, rx = 0, ry = 0;
ul.addEventListener('touchstart', e => {
  const r = e.target.closest('.user[data-cid]'); if (!r) return;
  const t = e.touches[0]; rx = t.clientX; ry = t.clientY;
  clearTimeout(rowT);
  rowT = setTimeout(() => { rowDone = Date.now(); buzz(14); chatActions(r.dataset.cid); }, 480);
}, { passive: true });
ul.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.abs(t.clientX - rx) > 8 || Math.abs(t.clientY - ry) > 8) clearTimeout(rowT); }, { passive: true });
['touchend', 'touchcancel'].forEach(n => ul.addEventListener(n, () => clearTimeout(rowT), { passive: true }));
ul.addEventListener('click', e => { if (Date.now() - rowDone < 800) { e.stopPropagation(); e.preventDefault(); } }, true);
ul.addEventListener('contextmenu', e => {
  const r = e.target.closest('.user[data-cid]'); if (!r) return;
  e.preventDefault();
  if (Date.now() - rowDone < 800) return;
  rowDone = Date.now(); chatActions(r.dataset.cid);
});

// ---------- status viewer: progress bars ----------
const bars = el('div'); bars.id = 'svBars'; $('statusView').appendChild(bars);
const _showStatus = showStatus;
showStatus = function () {
  _showStatus();
  bars.innerHTML = '';
  if (!svList[svIdx]) return;
  svList.forEach((_, i) => { const s = el('div', 'svseg' + (i < svIdx ? ' done' : i === svIdx ? ' cur' : '')); s.appendChild(document.createElement('i')); bars.appendChild(s); });
  const v = $q('#svBody video'), cur = $q('.svseg.cur');
  if (v && cur) { cur.classList.add('vid'); const bar = cur.firstChild; v.ontimeupdate = () => { if (v.duration) bar.style.width = (v.currentTime / v.duration * 100) + '%'; }; }
};

// ---------- desktop niceties: Esc, Ctrl+K, drag-and-drop files, offline banner ----------
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('searchInput').focus(); return; }
  if (e.key !== 'Escape') return;
  const ps = $q('.psheet');
  if (ps) return ps.remove();
  if (!$('lightbox').classList.contains('hidden')) return $('lightbox').classList.add('hidden');
  if (!$('statusView').classList.contains('hidden')) return $('svClose').click();
  if (!S.classList.contains('hidden')) return closeSheet();
  if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); eb.classList.remove('on'); return; }
  if (!$('replyBar').classList.contains('hidden')) return cancelBar();
  const ov = [...document.querySelectorAll('.overlay.dim:not(.hidden)')].pop();
  if (ov) ov.classList.add('hidden');
});
const cp = $('chatPane');
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !e.target.closest('#partyBox');
['dragenter', 'dragover'].forEach(n => cp.addEventListener(n, e => { if (hasFiles(e)) { e.preventDefault(); cp.classList.add('dropping'); } }));
cp.addEventListener('dragleave', e => { if (!cp.contains(e.relatedTarget)) cp.classList.remove('dropping'); });
cp.addEventListener('drop', e => {
  cp.classList.remove('dropping');
  if (e.target.closest('#partyBox')) return;
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) { e.preventDefault(); setPending(f); }
});
const net = el('div', 'hidden', '📡 Waiting for network…'); net.id = 'netBar'; document.body.appendChild(net);
const syncNet = () => net.classList.toggle('hidden', navigator.onLine);
window.addEventListener('online', () => { syncNet(); toast('Back online'); });
window.addEventListener('offline', syncNet);
syncNet();
})();
// ---------- stay put: no pull-to-refresh, reopen the same chat if the browser reloads ----------
document.documentElement.style.overscrollBehaviorY = 'none';
document.body.style.overscrollBehaviorY = 'none';
const _openChat = openChat;
openChat = function (u, j) { try { localStorage.setItem('j3_lastchat', u.id); } catch (e) {} return _openChat(u, j); };
const _closeChat = closeChat;
closeChat = function () { try { localStorage.removeItem('j3_lastchat'); } catch (e) {} return _closeChat(); };
let tries = 0;
const restore = setInterval(() => {
  if (++tries > 40) return clearInterval(restore);
  if (!me || !allChats().length) return;
  clearInterval(restore);
  const id = localStorage.getItem('j3_lastchat'), c = id && chatByKey(id);
  if (c && !current) openChat(c);
}, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) loadChats(); });