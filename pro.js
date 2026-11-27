'use strict';
// ===== Just Us Three · pro layer (loads AFTER polish.js; adds to the app, removes nothing) =====
(() => {
const $q = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const msgBox = $('messages');
const ta = $('msgInput');

// ---------- settings: vibration on/off, chat text size ----------
const _vib = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
if (_vib) navigator.vibrate = p => (ls.get('j3_haptics', true) ? _vib(p) : false);
const setFs = v => document.documentElement.style.setProperty('--fs', v + 'px');
setFs(ls.get('j3_fs', 15.5));
const rr = $('lsToggle').closest('label');
const hap = document.createElement('label'); hap.className = 'row';
hap.innerHTML = '<span>Vibration feedback</span><input type="checkbox" id="hapToggle">';
const fsLab = el('div', 'lab', 'Chat text size');
const fsR = el('input'); fsR.type = 'range'; fsR.min = 13; fsR.max = 20; fsR.step = 0.5; fsR.id = 'fsRange';
rr.after(hap, fsLab, fsR);
$('hapToggle').checked = ls.get('j3_haptics', true);
$('hapToggle').onchange = e => { ls.set('j3_haptics', e.target.checked); };
fsR.value = ls.get('j3_fs', 15.5);
fsR.oninput = () => { setFs(fsR.value); ls.set('j3_fs', Number(fsR.value)); };

// ---------- calls: use your TURN server (calls work across networks), flip camera, no mirror ----------
try { (CFG.turn || []).forEach(t => ICE.iceServers.push(t)); } catch (e) {}
let facing = 'user';
const flip = el('button', 'secondary round hidden', '🔄'); flip.id = 'callFlip';
$('callEnd').before(flip);
const _showCallUI = showCallUI;
showCallUI = function (status) {
  _showCallUI(status);
  facing = 'user';
  flip.classList.toggle('hidden', !call.video);
};
flip.onclick = async () => {
  if (!call || !call.local || !call.video) return;
  const want = facing === 'user' ? 'environment' : 'user';
  try {
    const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: want } }, audio: false });
    const nt = ns.getVideoTracks()[0];
    const sender = call.pc && call.pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(nt);
    call.local.getVideoTracks().forEach(t => { call.local.removeTrack(t); t.stop(); });
    call.local.addTrack(nt);
    $('localVid').srcObject = call.local;
    facing = want;
  } catch (e) { toast('Could not switch camera'); }
};
$('localVid').classList.toggle('mir', !!ls.get('j3_mirror', false));
$('localVid').onclick = () => { const m = $('localVid').classList.toggle('mir'); ls.set('j3_mirror', m); };

// ---------- instant sending with a pending clock, retry, and an offline outbox ----------
const CLOCK = '<svg viewBox="0 0 17 12"><circle cx="8.5" cy="6" r="4.6"/><path d="M8.5 3.5V6l1.8 1.2"/></svg>';
const jobs = [];
function drawPending(chat, text, rep) {
  const tmp = { id: 'tmp', sender_id: me.id, receiver_id: chat.isGroup ? null : chat.id, group_id: chat.isGroup ? chat.gid : null,
    content: text, created_at: new Date().toISOString(), reply_to: rep ? rep.id : null, media_type: null };
  addMsg(tmp, { fresh: true });
  const node = msgBox.lastElementChild;
  node.removeAttribute('data-id'); node.dataset.tmp = '1';
  const t = node.querySelector('.time');
  let k = node.querySelector('.tick');
  if (!k && t) { k = el('span', 'tick'); t.appendChild(k); }
  if (k) { k.className = 'tick pend'; k.innerHTML = CLOCK; }
  stickBottom = true; scrollDown();
  return node;
}
function failJob(job, e) {
  job.failed = true;
  const k = job.node.querySelector('.tick');
  if (k) { k.className = 'tick fail'; k.textContent = '⚠'; }
  job.node.classList.add('failed');
  if (!job.bound) { job.bound = true; job.node.addEventListener('click', () => { if (job.failed) retryJob(job); }); }
  toast(navigator.onLine ? friendly(e) + ' Tap the message to retry.' : 'Offline. It will send when you reconnect.');
}
function retryJob(job) {
  job.failed = false; job.node.classList.remove('failed');
  const k = job.node.querySelector('.tick');
  if (k) { k.className = 'tick pend'; k.innerHTML = CLOCK; }
  sendJob(job);
}
async function sendJob(job) {
  try {
    const row = { ...baseRow(job.chat), content: job.text, reply_to: job.reply };
    const { data, error } = await db.from('messages').insert(row).select().single();
    if (error) throw error;
    jobs.splice(jobs.indexOf(job), 1);
    lastMsg[job.chat.id] = data;
    if (current === job.chat && job.node.isConnected) {
      if (msgs[data.id] || msgBox.querySelector(`.msg[data-id="${data.id}"]`)) job.node.remove();
      else {
        msgs[data.id] = data;
        const n = buildMsg(data);
        if (job.node.classList.contains('tail')) n.classList.add('tail');
        job.node.replaceWith(n);
      }
    }
    renderChats();
  } catch (e) { failJob(job, e); }
}
const _sendText = sendText;
sendText = async function () {
  if (!current || editing || pendingFile) return _sendText();
  const text = ta.value.trim();
  if (!text) return;
  const chat = current, rep = replyTo;
  ta.value = ''; autosize(); updateAction();
  localStorage.removeItem('j3_draft_' + chat.id);
  replyTo = null; $('replyBar').classList.add('hidden');
  const job = { chat, text, reply: rep ? rep.id : null };
  job.node = drawPending(chat, text, rep);
  jobs.push(job);
  sendJob(job);
};
window.addEventListener('online', () => jobs.filter(j => j.failed).forEach(retryJob));

// ---------- "recording audio…" shown to the other person ----------
const _setSub = setSub;
setSub = function () {
  _setSub();
  if (!current) return;
  const t = typing[current.id];
  if (t && t.until > Date.now() && String(t.name).startsWith('🎙')) {
    const n = Array.from(t.name).slice(1).join('');
    $('chatSub').textContent = current.isGroup ? n + ' is recording audio…' : 'recording audio…';
  }
};
setInterval(() => {
  if (!current || !presenceCh || $('recBar').classList.contains('hidden')) return;
  presenceCh.send({ type: 'broadcast', event: 'typing', payload: { from: me.id, name: '🎙' + me.username, to: current.id } });
}, 2500);

// ---------- waveform voice notes + link preview cards ----------
function enhanceAudio(box) {
  if (box.dataset.w) return;
  const a = box.querySelector('audio'); if (!a) return;
  box.dataset.w = 1; a.controls = false; a.style.display = 'none';
  const btn = el('button', 'vn-play', '▶'); btn.type = 'button';
  const wave = el('div', 'vn-wave'), tm = el('span', 'vn-time', '0:00'), bars = [];
  let r = (a.src || '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  for (let i = 0; i < 34; i++) { r = (r * 1664525 + 1013904223) >>> 0; const s = el('i'); s.style.height = (22 + (r >>> 8) % 70) + '%'; wave.appendChild(s); bars.push(s); }
  box.prepend(btn, wave, tm);
  const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';
  const paint = () => {
    const d = a.duration, n = isFinite(d) && d ? Math.round(a.currentTime / d * bars.length) : 0;
    bars.forEach((b, i) => b.classList.toggle('on', i < n));
    tm.textContent = !a.currentTime && isFinite(d) ? fmt(d) : fmt(a.currentTime);
  };
  ['timeupdate', 'loadedmetadata', 'durationchange'].forEach(n => a.addEventListener(n, paint));
  a.addEventListener('play', () => { btn.textContent = '⏸'; document.querySelectorAll('.audiobox audio').forEach(o => { if (o !== a) o.pause(); }); });
  a.addEventListener('pause', () => { btn.textContent = '▶'; });
  a.addEventListener('ended', () => { a.currentTime = 0; btn.textContent = '▶'; paint(); });
  btn.onclick = e => { e.stopPropagation(); a.paused ? a.play() : a.pause(); };
  wave.onclick = e => {
    e.stopPropagation();
    const d = a.duration; if (!isFinite(d)) return;
    const rc = wave.getBoundingClientRect();
    a.currentTime = d * Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width)); paint();
  };
}
const lpCache = ls.get('j3_lp', {}), lpQ = []; let lpBusy = 0;
async function getLp(url) {
  if (lpCache[url] !== undefined) return lpCache[url];
  const j = await (await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))).json();
  const d = j.status === 'success' ? { t: j.data.title || '', d: (j.data.description || '').slice(0, 140), i: (j.data.image && j.data.image.url) || '', p: j.data.publisher || '' } : null;
  lpCache[url] = d;
  const k = Object.keys(lpCache); if (k.length > 60) delete lpCache[k[0]];
  ls.set('j3_lp', lpCache);
  return d;
}
function pump() {
  if (lpBusy >= 2 || !lpQ.length) return;
  const [node, url] = lpQ.shift(); lpBusy++;
  getLp(url).then(d => {
    if (!d || !node.isConnected || (!d.t && !d.i)) return;
    const c = el('a', 'lpcard'); c.href = url; c.target = '_blank'; c.rel = 'noopener noreferrer'; c.onclick = e => e.stopPropagation();
    if (d.i) { const im = el('img'); im.src = d.i; im.loading = 'lazy'; im.alt = ''; c.append(im); }
    const b = el('div', 'lpt'); b.append(el('b', '', d.t), el('span', '', d.d || d.p)); c.append(b);
    const t = node.querySelector('.txt'); if (t) t.before(c);
    if (stickBottom) scrollDown();
  }).catch(() => {}).finally(() => { lpBusy--; pump(); });
}
new MutationObserver(list => list.forEach(r => r.addedNodes.forEach(n => {
  if (!n.querySelectorAll) return;
  n.querySelectorAll('.audiobox').forEach(enhanceAudio);
  if (n.classList.contains('msg') && !n.dataset.lp && !n.dataset.tmp) {
    const a = n.querySelector('.txt a[href^="http"]');
    if (a) { n.dataset.lp = 1; lpQ.push([n, a.href]); pump(); }
  }
}))).observe(msgBox, { childList: true });

// ---------- select many messages: star, copy, forward, delete ----------
let selMode = false, fwdList = null;
const picked = new Set();
const bar = el('div', 'hidden'); bar.id = 'selBar';
bar.innerHTML = '<button class="iconbtn" data-a="x">✕</button><b id="selN">0</b><span class="grow"></span><button class="iconbtn" data-a="copy">⧉</button><button class="iconbtn" data-a="star">★</button><button class="iconbtn" data-a="fwd">↪</button><button class="iconbtn" data-a="del">🗑</button>';
$('chatPane').appendChild(bar);
function selOff() { selMode = false; picked.clear(); msgBox.querySelectorAll('.picked').forEach(n => n.classList.remove('picked')); bar.classList.add('hidden'); }
function toggle(id) {
  id = Number(id);
  const n = $q(`#messages .msg[data-id="${id}"]`); if (!n) return;
  if (picked.has(id)) { picked.delete(id); n.classList.remove('picked'); } else { picked.add(id); n.classList.add('picked'); }
  buzz(8); $('selN').textContent = picked.size;
  if (!picked.size) selOff(); else { selMode = true; bar.classList.remove('hidden'); }
}
msgBox.addEventListener('click', e => {
  if (!selMode) return;
  const n = e.target.closest('.msg[data-id]:not(.callmsg)');
  e.stopPropagation(); e.preventDefault();
  if (n) toggle(n.dataset.id);
}, true);
const _openFor = openFor;
openFor = function (n) { if (selMode) { if (n.dataset.id) toggle(n.dataset.id); return; } _openFor(n); };
const _openSheet = openSheet;
openSheet = function (m) {
  _openSheet(m);
  if (!$('selBtn')) {
    const b = el('button'); b.id = 'selBtn'; b.innerHTML = '<i>☑</i><b>Select</b>';
    b.onclick = () => { const x = sheetMsg; closeSheet(); toggle(x.id); };
    $('delMeBtn').before(b);
  }
};
bar.onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const a = b.dataset.a, ids = [...picked];
  if (a === 'x') return selOff();
  const list = ids.map(i => msgs[i]).filter(Boolean).sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
  if (a === 'copy') {
    try { await navigator.clipboard.writeText(list.map(m => m.content).filter(Boolean).join('\n')); toast('Copied'); } catch (er) {}
    selOff();
  } else if (a === 'star') {
    const add = list.filter(m => !starred.has(m.id));
    if (add.length) {
      const { error } = await db.from('stars').insert(add.map(m => ({ message_id: m.id, user_id: me.id })));
      if (error) return alert(error.message);
      add.forEach(m => starred.add(m.id));
    } else { await db.from('stars').delete().in('message_id', ids).eq('user_id', me.id); ids.forEach(i => starred.delete(i)); }
    selOff(); list.forEach(updateMsg); toast('Updated');
  } else if (a === 'fwd') {
    fwdList = list;
    getFwd = checkList($('fwdList'), allChats().filter(canSendTo).map(c => ({ id: c.id, label: c.username, av: c })));
    $('forward').classList.remove('hidden');
  } else if (a === 'del') {
    const everyone = list.every(m => m.sender_id === me.id) && confirm('Delete for everyone?\n\nPress Cancel to delete only for you.');
    if (everyone) {
      const { error } = await db.from('messages').delete().in('id', ids);
      if (error) return alert(error.message);
    } else {
      if (!confirm('Delete ' + ids.length + ' message(s) for you?')) return;
      const { error } = await db.from('hidden_messages').insert(ids.map(id => ({ message_id: id, user_id: me.id })));
      if (error) return alert(error.message);
      ids.forEach(id => hidden.add(id));
    }
    ids.forEach(removeMsg); selOff(); loadChats();
  }
};
const _fwdSend = $('fwdSend').onclick;
$('fwdSend').onclick = async () => {
  if (!fwdList) return _fwdSend();
  const ids = getFwd(); if (!ids.length) return;
  const list = fwdList; fwdList = null;
  let fail = 0;
  for (const id of ids) {
    const c = chatByKey(id); if (!c) continue;
    for (const m of list) {
      const row = { ...baseRow(c), content: m.content, media_url: m.media_url, media_type: m.media_type, media_name: m.media_name,
        media_size: m.media_size, lat: m.lat, lng: m.lng, poll: m.poll, forwarded: true };
      const { data, error } = await db.from('messages').insert(row).select().single();
      if (error) { fail++; continue; }
      lastMsg[c.id] = data;
      if (current && current.id === c.id) { msgs[data.id] = data; addMsg(data, { fresh: true }); scrollDown(); }
    }
  }
  $('forward').classList.add('hidden'); renderChats(); selOff();
  toast(fail ? 'Some messages could not be forwarded' : 'Forwarded');
};
$('fwdCancel').addEventListener('click', () => { fwdList = null; });
$('fwdBtn').addEventListener('click', () => { fwdList = null; });

// ---------- chat list: swipe left = archive, swipe right = mark read / unread ----------
const _chatRow = chatRow;
chatRow = u => {
  const r = _chatRow(u);
  if (!unread[u.id] && ls.get('j3_forced', []).includes(u.id)) { const right = r.querySelector('.right'); if (right) right.append(el('span', 'badge dot', ' ')); }
  return r;
};
function rowSwipe(id, kind) {
  const c = chatByKey(id); if (!c) return;
  if (kind === 'archive') {
    const s = new Set(ls.get('j3_archived', [])), was = s.has(id);
    was ? s.delete(id) : s.add(id); ls.set('j3_archived', [...s]);
    renderChats(); toast(was ? 'Chat unarchived' : 'Chat archived');
  } else {
    const f = new Set(ls.get('j3_forced', []));
    if (unread[id]) { unread[id] = 0; markSeen(id); f.delete(id); toast('Marked as read'); }
    else if (f.has(id)) { f.delete(id); toast('Marked as read'); }
    else { f.add(id); toast('Marked as unread'); }
    ls.set('j3_forced', [...f]); renderChats();
  }
}
const ul = $('userList'); let rs = null;
ul.addEventListener('touchstart', e => {
  const r = e.target.closest('.user[data-cid]');
  rs = r ? { r, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: false, hit: false } : null;
}, { passive: true });
ul.addEventListener('touchmove', e => {
  if (!rs) return;
  const t = e.touches[0], dx = t.clientX - rs.x, dy = t.clientY - rs.y;
  if (!rs.lock) {
    if (Math.abs(dy) > 10) { rs = null; return; }
    if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) { rs.lock = true; rs.r.style.transition = 'none'; } else return;
  }
  rs.dx = Math.max(-120, Math.min(120, dx));
  rs.r.style.transform = `translateX(${rs.dx}px)`;
  rs.r.classList.toggle('swl', rs.dx < -20); rs.r.classList.toggle('swr', rs.dx > 20);
  const hit = Math.abs(rs.dx) >= 90;
  if (hit !== rs.hit) { rs.hit = hit; if (hit) buzz(10); }
}, { passive: true });
function endRow() {
  if (!rs) return;
  const { r, dx, lock } = rs; rs = null;
  if (!lock) return;
  r.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)'; r.style.transform = ''; r.classList.remove('swl', 'swr');
  setTimeout(() => { r.style.transition = ''; }, 320);
  if (Math.abs(dx) >= 90) rowSwipe(r.dataset.cid, dx < 0 ? 'archive' : 'read');
}
ul.addEventListener('touchend', endRow, { passive: true });
ul.addEventListener('touchcancel', endRow, { passive: true });

// ---------- photo viewer: double-tap zoom, pinch, drag, swipe down to close ----------
const lb = $('lightbox'), li = $('lightImg');
let z = { s: 1, x: 0, y: 0 }, lt = 0, tapT = null, pinch = null, pan = null, noClick = 0;
const apply = () => { li.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`; };
const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
new MutationObserver(() => { if (lb.classList.contains('hidden')) { z = { s: 1, x: 0, y: 0 }; li.style.transition = ''; li.style.transform = ''; lb.style.background = ''; } })
  .observe(lb, { attributes: true, attributeFilter: ['class'] });
lb.addEventListener('click', e => {
  e.stopImmediatePropagation();
  if (Date.now() - noClick < 350) return;
  if (e.target === li) {
    const now = Date.now();
    if (now - lt < 280) {
      clearTimeout(tapT); lt = 0; li.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1)';
      if (z.s > 1) z = { s: 1, x: 0, y: 0 };
      else { const r = li.getBoundingClientRect(); z = { s: 2.5, x: (r.left + r.width / 2 - e.clientX) * 1.5, y: (r.top + r.height / 2 - e.clientY) * 1.5 }; }
      apply(); return;
    }
    lt = now; clearTimeout(tapT);
    tapT = setTimeout(() => { if (z.s === 1) lb.classList.add('hidden'); }, 280);
    return;
  }
  if (z.s === 1) lb.classList.add('hidden');
}, true);
lb.addEventListener('touchstart', e => {
  if (e.touches.length === 2) { pinch = { d: dist(e), s: z.s }; pan = null; }
  else if (e.touches.length === 1) pan = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: z.x, oy: z.y };
}, { passive: true });
lb.addEventListener('touchmove', e => {
  li.style.transition = 'none';
  if (pinch && e.touches.length === 2) { z.s = Math.min(5, Math.max(1, pinch.s * dist(e) / pinch.d)); noClick = Date.now(); apply(); }
  else if (pan && e.touches.length === 1) {
    const dx = e.touches[0].clientX - pan.x, dy = e.touches[0].clientY - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) noClick = Date.now();
    if (z.s > 1) { z.x = pan.ox + dx; z.y = pan.oy + dy; }
    else { z.x = 0; z.y = dy; lb.style.background = `rgba(0,0,0,${Math.max(.3, .92 - Math.abs(dy) / 500)})`; }
    apply();
  }
}, { passive: true });
lb.addEventListener('touchend', e => {
  if (e.touches.length < 2) pinch = null;
  if (e.touches.length === 0 && pan) {
    pan = null;
    if (z.s === 1) {
      const close = Math.abs(z.y) > 110;
      li.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1)'; z.y = 0; apply(); lb.style.background = '';
      if (close) lb.classList.add('hidden');
    }
  }
}, { passive: true });

// ---------- app badge, clear notifications when you open the chat, tidy selection ----------
const _openChat = openChat;
openChat = function (u, j) {
  try {
    selOff();
    const f = new Set(ls.get('j3_forced', [])); if (f.delete(u.id)) ls.set('j3_forced', [...f]);
    if (navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.getNotifications({ tag: 'j3' }).then(l => l.forEach(n => n.close()))).catch(() => {});
  } catch (e) {}
  return _openChat(u, j);
};
const titleEl = $q('title');
if (titleEl && navigator.setAppBadge) {
  new MutationObserver(() => {
    const n = Number((/^\((\d+)\)/.exec(document.title) || [0, 0])[1]);
    try { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) {}
  }).observe(titleEl, { childList: true });
}
})();
