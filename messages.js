'use strict';
// ===== Just Us Three · messages =====

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\p{Extended_Pictographic}]*\s*){1,3}$/u;
const visibleIds = () => [...document.querySelectorAll('#messages .msg[data-id]')].map(e => Number(e.dataset.id));
const baseRow = c => ({ sender_id: me.id, receiver_id: c.isGroup ? null : c.id, group_id: c.isGroup ? c.gid : null });
let lpFired = 0, selEl = null;

function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function linkify(el, text) {
  text.split(/(https?:\/\/[^\s]+|@[a-z0-9_]{3,20}\b)/gi).forEach(part => {
    if (/^https?:\/\//i.test(part)) {
      const a = document.createElement('a');
      a.href = part; a.textContent = part; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.onclick = e => e.stopPropagation();
      el.appendChild(a);
    } else if (/^@[a-z0-9_]{3,20}$/i.test(part)) {
      const s = document.createElement('span');
      s.className = 'mention' + (part.slice(1).toLowerCase() === me.username ? ' me' : '');
      s.textContent = part;
      el.appendChild(s);
    } else el.appendChild(document.createTextNode(part));
  });
}

// WhatsApp-style ticks: one = sent, two = delivered, blue = read
const TICK1 = '<svg viewBox="0 0 17 12"><path d="M1 6.5L4.5 10 11 2.5"/></svg>';
const TICK2 = '<svg viewBox="0 0 17 12"><path d="M1 6.5L4.5 10 11 2.5"/><path d="M6 6.5L9.5 10 16 2.5"/></svg>';
function setTick(k, m) {
  const rd = !!m.read_at, dl = !!m.delivered_at || rd;
  k.className = 'tick' + (rd ? ' read' : '');
  k.innerHTML = dl ? TICK2 : TICK1;
}

function daySep(iso) {
  const s = document.createElement('div');
  s.className = 'day'; s.textContent = dayLabel(iso);
  s.dataset.day = new Date(iso).toDateString();
  return s;
}

// ---------- one message bubble ----------
function buildMsg(m) {
  const mine = m.sender_id === me.id;
  const d = document.createElement('div');
  d.dataset.id = m.id;

  if (m.media_type === 'call') {
    d.className = 'msg callmsg';
    d.textContent = (mine ? '↗ ' : '↙ ') + (m.content || 'Call') + ' · ' + fmtTime(m.created_at);
    return d;
  }
  d.className = 'msg' + (mine ? ' mine' : '');
  if (m.media_url && (m.media_type === 'image' || m.media_type === 'video')) d.classList.add('media');

  if (m.group_id && !mine) {
    const w = document.createElement('div'); w.className = 'who'; w.textContent = nameOf(m.sender_id);
    d.appendChild(w);
  }
  if (m.forwarded) {
    const f = document.createElement('div'); f.className = 'fwd'; f.textContent = '↪ Forwarded';
    d.appendChild(f);
  }
  if (m.reply_to) {
    const o = msgs[m.reply_to];
    const q = document.createElement('div'); q.className = 'quote';
    q.textContent = o ? nameOf(o.sender_id) + ': ' + snip(o) : '↩ Original message';
    q.onclick = e => { e.stopPropagation(); jumpTo(m.reply_to); };
    d.appendChild(q);
  }

  if (m.media_url) {
    if (m.media_type === 'video') {
      const v = document.createElement('video');
      v.src = m.media_url; v.controls = true; v.preload = 'metadata'; v.playsInline = true;
      v.onloadedmetadata = () => { if (stickBottom) scrollDown(); };
      d.appendChild(v);
    } else if (m.media_type === 'audio') {
      const box = document.createElement('div'); box.className = 'audiobox';
      const a = document.createElement('audio');
      a.src = m.media_url; a.controls = true; a.preload = 'metadata';
      const sp = document.createElement('button'); sp.className = 'speed'; sp.textContent = '1x';
      sp.onclick = () => {
        const rates = [1, 1.5, 2];
        const next = rates[(rates.indexOf(a.playbackRate) + 1) % 3];
        a.playbackRate = next; sp.textContent = next + 'x';
      };
      box.append(a, sp);
      d.appendChild(box);
    } else if (m.media_type === 'file') {
      const a = document.createElement('a');
      a.className = 'filecard'; a.href = m.media_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      const ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = '📄';
      const tx = document.createElement('div');
      const fn = document.createElement('div'); fn.className = 'fn'; fn.textContent = m.media_name || 'File';
      const fs = document.createElement('div'); fs.className = 'fs'; fs.textContent = fmtSize(m.media_size);
      tx.append(fn, fs);
      a.append(ic, tx);
      d.appendChild(a);
    } else {
      const i = document.createElement('img');
      i.src = m.media_url; i.alt = ''; i.loading = 'lazy'; i.decoding = 'async';
      i.onload = () => { if (stickBottom) scrollDown(); };
      i.onclick = () => { $('lightImg').src = m.media_url; $('lightbox').classList.remove('hidden'); };
      d.appendChild(i);
    }
  }
  if (m.media_type === 'location' && m.lat != null) {
    const w = document.createElement('div'); w.className = 'loc';
    const f = document.createElement('iframe');
    f.loading = 'lazy';
    f.src = `https://www.openstreetmap.org/export/embed.html?bbox=${m.lng - 0.004}%2C${m.lat - 0.0025}%2C${m.lng + 0.004}%2C${m.lat + 0.0025}&layer=mapnik&marker=${m.lat}%2C${m.lng}`;
    const a = document.createElement('a');
    a.href = `https://www.google.com/maps?q=${m.lat},${m.lng}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = '📍 Open in Maps';
    w.append(f, a);
    d.appendChild(w);
  }
  if (m.media_type === 'poll') {
    const pb = document.createElement('div'); pb.className = 'poll';
    fillPoll(pb, m);
    d.appendChild(pb);
  }

  // time + ticks
  const tm = document.createElement('span'); tm.className = 'time';
  tm.append((pinned.has(m.id) ? '📌 ' : '') + (starred.has(m.id) ? '⭐ ' : '') + (m.edited_at ? 'edited · ' : '') + fmtTime(m.created_at));
  if (mine && !m.group_id) {
    const k = document.createElement('span');
    setTick(k, m);
    tm.appendChild(k);
  }

  let timeInside = false;
  if (m.content) {
    const clamp = m.content.length > 600;
    const big = !m.media_url && EMOJI_ONLY.test(m.content);
    const t = document.createElement('div');
    t.className = 'txt' + (big ? ' big' : '');
    linkify(t, m.content);
    d.appendChild(t);
    if (clamp) {
      t.classList.add('clamp');
      const more = document.createElement('a');
      more.className = 'more'; more.textContent = 'Read more';
      more.onclick = e => {
        e.stopPropagation();
        const c = t.classList.toggle('clamp');
        more.textContent = c ? 'Read more' : 'Show less';
      };
      d.appendChild(more);
    }
    if (!clamp && !big) { t.appendChild(tm); timeInside = true; }
  }
  const rc = document.createElement('div'); rc.className = 'reacts';
  d.appendChild(rc);
  if (!timeInside) d.appendChild(tm);
  return d;
}

// tail on the first bubble of a run from the same sender
function tailNeeded(m, prev) {
  if (m.media_type === 'call') return false;
  return !(prev && prev.sender_id === m.sender_id && prev.media_type !== 'call');
}

// build many bubbles at once (fast): used for first load and older history
function renderBatch(list, unreadInfo) {
  const frag = document.createDocumentFragment();
  let day = '', prev = null;
  list.forEach(m => {
    msgs[m.id] = m;
    if (hidden.has(m.id)) return;
    const d = new Date(m.created_at).toDateString();
    if (d !== day) { frag.appendChild(daySep(m.created_at)); day = d; prev = null; }
    if (unreadInfo && unreadInfo.id === m.id) {
      const u = document.createElement('div');
      u.className = 'unreadline'; u.id = 'unreadLine';
      u.textContent = unreadInfo.count + ' unread message' + (unreadInfo.count === 1 ? '' : 's');
      frag.appendChild(u);
      prev = null;
    }
    const el = buildMsg(m);
    if (tailNeeded(m, prev)) el.classList.add('tail');
    frag.appendChild(el);
    prev = m;
  });
  return { frag, day };
}

function addMsg(m, opts) {
  const box = $('messages');
  const day = new Date(m.created_at).toDateString();
  if (day !== lastDay) { box.appendChild(daySep(m.created_at)); lastDay = day; }
  const prevEl = box.lastElementChild;
  const prev = prevEl && prevEl.classList.contains('msg') ? msgs[prevEl.dataset.id] : null;
  const el = buildMsg(m);
  if (tailNeeded(m, prev)) el.classList.add('tail');
  if (opts && opts.fresh) el.classList.add('in');
  box.appendChild(el);
}
function updateMsg(m) {
  const el = document.querySelector(`.msg[data-id="${m.id}"]`);
  if (!el) return;
  const n = buildMsg(m);
  if (el.classList.contains('tail')) n.classList.add('tail');
  el.replaceWith(n);
  renderReacts(m.id);
}
function removeMsg(id) {
  const el = document.querySelector(`.msg[data-id="${id}"]`);
  if (el) el.remove();
  delete msgs[id];
}
function jumpTo(id) {
  const el = document.querySelector(`.msg[data-id="${id}"]`);
  if (!el) return toast('That message is not loaded');
  stickBottom = false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1500);
}

// older history loads as you scroll up
async function loadOlder() {
  if (loadingOlder || allLoaded || !current || !oldestTs) return;
  loadingOlder = true;
  const u = current;
  const { data } = await chatQuery(db.from('messages').select('*').lt('created_at', oldestTs)
    .order('created_at', { ascending: false }).limit(PAGE), u);
  if (current !== u) { loadingOlder = false; return; }
  const rows = data || [];
  if (rows.length < PAGE) allLoaded = true;
  if (rows.length) {
    const list = rows.slice().reverse();
    oldestTs = list[0].created_at;
    const box = $('messages');
    const r = renderBatch(list, null);
    const first = box.firstElementChild;
    if (first && first.classList.contains('day') && first.dataset.day === r.day) first.remove();
    const prevH = box.scrollHeight, prevT = box.scrollTop;
    box.insertBefore(r.frag, box.firstChild);
    box.scrollTop = prevT + (box.scrollHeight - prevH);
    await loadMeta();
  }
  loadingOlder = false;
}
async function ensureLoaded(id) {
  let n = 0;
  while (!document.querySelector(`.msg[data-id="${id}"]`) && !allLoaded && n++ < 12) await loadOlder();
}
$('lightbox').onclick = () => $('lightbox').classList.add('hidden');

// ---------- polls ----------
function fillPoll(box, m) {
  const p = m.poll || {}, vs = votes[m.id] || [];
  box.innerHTML = '';
  const q = document.createElement('div'); q.className = 'pq'; q.textContent = '📊 ' + (p.q || '');
  box.appendChild(q);
  const voters = new Set(vs.map(v => v.user_id)).size;
  (p.options || []).forEach((o, i) => {
    const n = vs.filter(v => v.option_idx === i).length;
    const mineV = vs.some(v => v.option_idx === i && v.user_id === me.id);
    const r = document.createElement('div'); r.className = 'popt' + (mineV ? ' sel' : '');
    const bar = document.createElement('div'); bar.className = 'pbar'; bar.style.width = (voters ? Math.round(n * 100 / voters) : 0) + '%';
    const lab = document.createElement('span'); lab.className = 'plab'; lab.textContent = (mineV ? '✓ ' : '') + o;
    const cnt = document.createElement('span'); cnt.className = 'pcnt'; cnt.textContent = n;
    r.append(bar, lab, cnt);
    r.onclick = () => vote(m, i);
    box.appendChild(r);
  });
  const f = document.createElement('div'); f.className = 'pfoot';
  f.textContent = voters + ' vote' + (voters === 1 ? '' : 's') + (p.multi ? ' · multiple answers' : '');
  box.appendChild(f);
}
function refillPoll(id) {
  const box = document.querySelector(`.msg[data-id="${id}"] .poll`);
  if (box && msgs[id]) fillPoll(box, msgs[id]);
}
async function vote(m, i) {
  const vs = votes[m.id] || [];
  const mineV = vs.some(v => v.option_idx === i && v.user_id === me.id);
  if (mineV) {
    await db.from('poll_votes').delete().eq('message_id', m.id).eq('user_id', me.id).eq('option_idx', i);
  } else {
    if (!(m.poll && m.poll.multi)) await db.from('poll_votes').delete().eq('message_id', m.id).eq('user_id', me.id);
    const { error } = await db.from('poll_votes').insert({ message_id: m.id, user_id: me.id, option_idx: i });
    if (error) return alert(error.message);
  }
  loadVotes();
}
async function loadVotes() {
  const ids = Object.values(msgs).filter(m => m.media_type === 'poll').map(m => m.id);
  votes = {};
  if (!ids.length) return;
  const { data } = await db.from('poll_votes').select('*').in('message_id', ids);
  (data || []).forEach(v => { (votes[v.message_id] = votes[v.message_id] || []).push(v); });
  ids.forEach(refillPoll);
}

// ---------- reactions, pins ----------
async function loadReactions() {
  const ids = visibleIds();
  reacts = {};
  if (ids.length) {
    const { data } = await db.from('reactions').select('*').in('message_id', ids);
    (data || []).forEach(r => { (reacts[r.message_id] = reacts[r.message_id] || []).push(r); });
  }
  ids.forEach(renderReacts);
}
function renderReacts(id) {
  const el = document.querySelector(`.msg[data-id="${id}"] .reacts`);
  if (!el) return;
  el.innerHTML = '';
  const groupsR = {};
  (reacts[id] || []).forEach(r => {
    const g = groupsR[r.emoji] || (groupsR[r.emoji] = { n: 0, mine: false });
    g.n++;
    if (r.user_id === me.id) g.mine = true;
  });
  Object.entries(groupsR).forEach(([e, g]) => {
    const s = document.createElement('span');
    s.className = 'pill' + (g.mine ? ' mine' : '');
    s.textContent = e + (g.n > 1 ? ' ' + g.n : '');
    el.appendChild(s);
  });
  el.closest('.msg').classList.toggle('hasr', el.children.length > 0);
}
async function react(id, emoji) {
  closeSheet();
  const mineR = (reacts[id] || []).find(r => r.user_id === me.id);
  if (mineR && mineR.emoji === emoji) await db.from('reactions').delete().eq('message_id', id).eq('user_id', me.id);
  else await db.from('reactions').upsert({ message_id: id, user_id: me.id, emoji }, { onConflict: 'message_id,user_id' });
  loadReactions();
}
async function loadPins() {
  const ids = visibleIds();
  const old = new Set(pinned);
  pinned = new Set();
  if (ids.length) {
    const { data } = await db.from('pins').select('message_id').in('message_id', ids);
    (data || []).forEach(r => pinned.add(r.message_id));
  }
  new Set([...old, ...pinned]).forEach(id => {
    if (old.has(id) !== pinned.has(id) && msgs[id]) updateMsg(msgs[id]);
  });
  renderPinBar();
}
async function loadMeta() {
  await Promise.all([loadReactions(), loadVotes(), loadPins()]);
}
function renderPinBar() {
  const arr = [...pinned].filter(id => msgs[id]).sort((a, b) => b - a);
  const bar = $('pinBar');
  if (!arr.length) { bar.classList.add('hidden'); return; }
  pinIdx = pinIdx % arr.length;
  const m = msgs[arr[pinIdx]];
  bar.textContent = '📌 ' + (arr.length > 1 ? `${pinIdx + 1}/${arr.length} · ` : '') + snip(m);
  bar.classList.remove('hidden');
  bar.onclick = () => { jumpTo(m.id); pinIdx = (pinIdx + 1) % arr.length; renderPinBar(); };
}

// ---------- long-press menu ----------
function openSheet(m) {
  sheetMsg = m;
  const mine = m.sender_id === me.id;
  const row = $('emojiRow');
  row.innerHTML = '';
  EMOJIS.forEach(e => {
    const b = document.createElement('button');
    b.className = 'emo'; b.textContent = e;
    b.onclick = () => react(m.id, e);
    row.appendChild(b);
  });
  $('copyBtn').classList.toggle('hidden', !m.content);
  $('sStar').querySelector('b').textContent = starred.has(m.id) ? 'Remove star' : 'Star';
  $('sPin').querySelector('b').textContent = pinned.has(m.id) ? 'Unpin' : 'Pin';
  $('editBtn').classList.toggle('hidden', !(mine && m.content && !m.media_type && Date.now() - new Date(m.created_at) < EDIT_MS));
  $('delAllBtn').classList.toggle('hidden', !mine);
  selEl = document.querySelector(`.msg[data-id="${m.id}"]`);
  if (selEl) selEl.classList.add('sel');
  $('sheet').classList.remove('hidden');
}
function closeSheet() {
  $('sheet').classList.add('hidden');
  if (selEl) { selEl.classList.remove('sel'); selEl = null; }
}
$('sheet').onclick = e => { if (e.target.id === 'sheet' || e.target.id === 'sheetBox') { if (Date.now() - lpFired > 600) closeSheet(); } };

function setReply(m) {
  cancelBar();
  replyTo = m;
  $('replyText').textContent = 'Replying to ' + nameOf(m.sender_id) + ': ' + snip(m);
  $('replyBar').classList.remove('hidden');
  $('msgInput').focus();
}
$('replyBtn').onclick = () => { const m = sheetMsg; closeSheet(); setReply(m); };
$('editBtn').onclick = () => {
  const m = sheetMsg; closeSheet(); cancelBar();
  editing = m;
  $('replyText').textContent = 'Editing message';
  $('replyBar').classList.remove('hidden');
  $('msgInput').value = m.content;
  autosize(); updateAction();
  $('msgInput').focus();
};
function cancelBar() {
  if (editing) { $('msgInput').value = ''; autosize(); }
  replyTo = null; editing = null;
  $('replyBar').classList.add('hidden');
  updateAction();
}
$('replyClose').onclick = cancelBar;

$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(sheetMsg.content); toast('Copied'); } catch (e) {}
  closeSheet();
};
$('sStar').onclick = async () => {
  const m = sheetMsg; closeSheet();
  if (starred.has(m.id)) {
    await db.from('stars').delete().eq('message_id', m.id).eq('user_id', me.id);
    starred.delete(m.id); toast('Removed from starred');
  } else {
    const { error } = await db.from('stars').insert({ message_id: m.id, user_id: me.id });
    if (error) return alert(error.message);
    starred.add(m.id); toast('Starred ⭐');
  }
  updateMsg(m);
};
$('sPin').onclick = async () => {
  const m = sheetMsg; closeSheet();
  if (pinned.has(m.id)) {
    const { error } = await db.from('pins').delete().eq('message_id', m.id);
    if (error) return alert(error.message);
    toast('Unpinned');
  } else {
    const { error } = await db.from('pins').insert({ message_id: m.id, pinned_by: me.id });
    if (error) return alert(error.message);
    toast('Pinned 📌');
  }
  loadPins();
};
$('infoBtn').onclick = () => {
  const m = sheetMsg; closeSheet();
  const f = iso => new Date(iso).toLocaleString();
  const lines = ['Sent by: ' + nameOf(m.sender_id), 'Sent: ' + f(m.created_at)];
  if (!m.group_id && m.sender_id === me.id) {
    lines.push('Delivered: ' + (m.delivered_at ? f(m.delivered_at) : (m.read_at ? f(m.read_at) : '—')));
    lines.push('Read: ' + (m.read_at ? f(m.read_at) : '—'));
  }
  if (m.edited_at) lines.push('Edited: ' + f(m.edited_at));
  if (m.forwarded) lines.push('This is a forwarded message');
  $('infoTitle').textContent = 'Message info';
  const body = $('infoBody');
  body.innerHTML = '';
  lines.forEach(t => { const d = document.createElement('div'); d.textContent = t; body.appendChild(d); });
  $('infoCard').classList.remove('hidden');
};
$('infoClose').onclick = () => $('infoCard').classList.add('hidden');

$('delMeBtn').onclick = async () => {
  const id = sheetMsg.id; closeSheet();
  const { error } = await db.from('hidden_messages').insert({ message_id: id, user_id: me.id });
  if (error) return alert(error.message);
  hidden.add(id);
  removeMsg(id);
  loadChats();
};
$('delAllBtn').onclick = async () => {
  const id = sheetMsg.id; closeSheet();
  if (!confirm('Delete this message for everyone?')) return;
  const { error } = await db.from('messages').delete().eq('id', id);
  if (error) return alert(error.message);
  removeMsg(id);
  loadChats();
};

// ---------- forward ----------
function checkList(el, items) {
  el.innerHTML = '';
  const boxes = [];
  if (!items.length) {
    const d = document.createElement('div'); d.className = 'user muted'; d.textContent = 'Nobody to pick.';
    el.appendChild(d);
  }
  items.forEach(it => {
    const row = document.createElement('label'); row.className = 'user';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = it.id;
    boxes.push(cb);
    const n = document.createElement('div'); n.className = 'mid nm'; n.textContent = it.label;
    row.append(avatar(it.av), n, cb);
    el.appendChild(row);
  });
  return () => boxes.filter(b => b.checked).map(b => b.value);
}
let fwdMsg = null, getFwd = () => [];
$('fwdBtn').onclick = () => {
  fwdMsg = sheetMsg; closeSheet();
  getFwd = checkList($('fwdList'), allChats().filter(canSendTo).map(c => ({ id: c.id, label: c.username, av: c })));
  $('forward').classList.remove('hidden');
};
$('fwdCancel').onclick = () => $('forward').classList.add('hidden');
$('fwdSend').onclick = async () => {
  const ids = getFwd();
  if (!ids.length) return;
  const m = fwdMsg;
  let fail = 0;
  for (const id of ids) {
    const c = chatByKey(id);
    if (!c) continue;
    const row = { ...baseRow(c), content: m.content, media_url: m.media_url, media_type: m.media_type,
      media_name: m.media_name, media_size: m.media_size, lat: m.lat, lng: m.lng, poll: m.poll, forwarded: true };
    const { data, error } = await db.from('messages').insert(row).select().single();
    if (error) { fail++; continue; }
    lastMsg[c.id] = data;
    if (current && current.id === c.id) { msgs[data.id] = data; addMsg(data, { fresh: true }); scrollDown(); }
  }
  $('forward').classList.add('hidden');
  renderChats();
  toast(fail ? 'Some chats could not receive it' : 'Forwarded');
};

// ---------- starred messages ----------
async function openStarred() {
  const l = $('starList');
  l.innerHTML = '';
  $('starred').classList.remove('hidden');
  const ids = [...starred];
  const note = t => { const d = document.createElement('div'); d.className = 'user muted'; d.textContent = t; l.appendChild(d); };
  if (!ids.length) return note('No starred messages yet. Long-press a message and choose Star.');
  const { data } = await db.from('messages').select('*').in('id', ids).order('created_at', { ascending: false });
  const rows = (data || []).filter(m => chatByKey(keyOf(m)));
  if (!rows.length) return note('No starred messages yet.');
  rows.forEach(m => {
    const c = chatByKey(keyOf(m));
    const row = document.createElement('div'); row.className = 'user';
    const mid = document.createElement('div'); mid.className = 'mid';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = nameOf(m.sender_id) + ' → ' + c.username;
    const pv = document.createElement('div'); pv.className = 'pv'; pv.textContent = snip(m);
    mid.append(nm, pv);
    const tm = document.createElement('div'); tm.className = 'tm'; tm.textContent = dayLabel(m.created_at);
    row.append(mid, tm);
    row.onclick = () => { $('starred').classList.add('hidden'); openChat(c, m.id); };
    l.appendChild(row);
  });
}
$('starClose').onclick = () => $('starred').classList.add('hidden');

// ---------- media, links and docs ----------
function openMedia() {
  const body = $('mdBody');
  body.innerHTML = '';
  const list = Object.values(msgs).filter(m => !hidden.has(m.id)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const section = t => { const h = document.createElement('div'); h.className = 'lab'; h.textContent = t; body.appendChild(h); };
  const pics = list.filter(m => m.media_url && (m.media_type === 'image' || m.media_type === 'video'));
  const files = list.filter(m => m.media_type === 'file' && m.media_url);
  const links = list.filter(m => m.content && /https?:\/\/\S+/.test(m.content));
  if (!pics.length && !files.length && !links.length) {
    const d = document.createElement('div'); d.className = 'pv'; d.textContent = 'Nothing shared in this chat yet.';
    body.appendChild(d);
  }
  if (pics.length) {
    section('Photos and videos');
    const g = document.createElement('div'); g.className = 'mgrid';
    pics.forEach(m => {
      const el = document.createElement(m.media_type === 'video' ? 'video' : 'img');
      el.src = m.media_url;
      if (m.media_type === 'video') { el.preload = 'metadata'; el.muted = true; }
      el.onclick = () => {
        if (m.media_type === 'video') window.open(m.media_url, '_blank', 'noopener');
        else { $('lightImg').src = m.media_url; $('lightbox').classList.remove('hidden'); }
      };
      g.appendChild(el);
    });
    body.appendChild(g);
  }
  if (files.length) {
    section('Documents');
    files.forEach(m => {
      const a = document.createElement('a'); a.className = 'mrow'; a.href = m.media_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = '📄 ' + (m.media_name || 'File') + ' ' + fmtSize(m.media_size);
      body.appendChild(a);
    });
  }
  if (links.length) {
    section('Links');
    links.forEach(m => {
      const u = m.content.match(/https?:\/\/\S+/)[0];
      const a = document.createElement('a'); a.className = 'mrow'; a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = u;
      body.appendChild(a);
    });
  }
  $('mediaView').classList.remove('hidden');
}
$('mdClose').onclick = () => $('mediaView').classList.add('hidden');

// ---------- chat menu actions ----------
function exportChat() {
  const lines = Object.values(msgs).filter(m => !hidden.has(m.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map(m => `[${new Date(m.created_at).toLocaleString()}] ${nameOf(m.sender_id)}: ${m.content || ''}${m.media_type ? ' (' + snip(m) + ')' : ''}${m.media_url ? ' ' + m.media_url : ''}`);
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (current.username || 'chat') + '-chat.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Chat exported');
}
async function clearChat() {
  if (!confirm('Clear this chat? It only clears it for you.')) return;
  const rows = Object.keys(msgs).map(Number).filter(id => !hidden.has(id)).map(id => ({ message_id: id, user_id: me.id }));
  if (rows.length) {
    const { error } = await db.from('hidden_messages').insert(rows);
    if (error) return alert(error.message);
    rows.forEach(r => hidden.add(r.message_id));
  }
  $('messages').innerHTML = ''; lastDay = '';
  delete lastMsg[current.id];
  renderChats();
}
async function toggleBlock() {
  const id = current.id;
  if (blocked.has(id)) {
    await db.from('blocks').delete().eq('blocker', me.id).eq('blocked', id);
    blocked.delete(id); toast('Unblocked');
  } else {
    if (!confirm('Block ' + current.username + '? They will not be able to message you.')) return;
    const { error } = await db.from('blocks').insert({ blocker: me.id, blocked: id });
    if (error) return alert(error.message);
    blocked.add(id); toast('Blocked');
  }
  updateComposerState();
}

// ---------- uploads ----------
async function prep(file, max) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc);
    c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.84));
    return blob || file;
  } catch (e) { return file; }
}
async function uploadMedia(file, max) {
  if (file.size > 50 * 1024 * 1024) throw new Error('File too big. Max is 50 MB.');
  const body = await prep(file, max || 1800);
  const ct = (body.type || file.type || 'application/octet-stream').split(';')[0];
  const rawExt = body !== file ? 'jpg' : ((file.name || '').split('.').pop() || 'bin');
  const ext = rawExt.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || 'bin';
  const path = `${me.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await db.storage.from('media').upload(path, body, { contentType: ct });
  if (error) throw error;
  const t = file.type || '';
  return {
    url: db.storage.from('media').getPublicUrl(path).data.publicUrl,
    type: t.startsWith('video') ? 'video' : t.startsWith('audio') ? 'audio' : t.startsWith('image') ? 'image' : 'file',
    name: file.name || null,
    size: file.size || null
  };
}

// ---------- composer ----------
function autosize() {
  const t = $('msgInput');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}
function updateAction() {
  const has = $('msgInput').value.trim() || pendingFile || editing;
  $('actionBtn').innerHTML = icon(has ? 'send' : 'mic');
}
function setPending(f) {
  pendingFile = f;
  $('previewName').textContent = (f.name || 'Attachment') + (f.size ? ' · ' + fmtSize(f.size) : '');
  const img = $('previewImg');
  if (f.type.startsWith('image/')) { img.src = URL.createObjectURL(f); img.classList.remove('hidden'); }
  else img.classList.add('hidden');
  $('previewBar').classList.remove('hidden');
  updateAction();
}
function clearPending() {
  pendingFile = null;
  $('previewBar').classList.add('hidden');
  updateAction();
}
$('previewClose').onclick = clearPending;

$('attachBtn').onclick = e => { e.stopPropagation(); $('chatMenu').classList.add('hidden'); $('attachMenu').classList.toggle('hidden'); };
[['amGallery', 'fileGallery'], ['amCamera', 'fileCamera'], ['amVideo', 'fileVideo'], ['amDoc', 'fileDoc']].forEach(([btn, inp]) => {
  $(btn).onclick = () => { $('attachMenu').classList.add('hidden'); $(inp).click(); };
  $(inp).onchange = () => { const f = $(inp).files[0]; $(inp).value = ''; if (f) setPending(f); };
});
$('amLoc').onclick = () => {
  $('attachMenu').classList.add('hidden');
  if (!navigator.geolocation) return alert('Location is not supported on this device.');
  toast('Getting your location…');
  navigator.geolocation.getCurrentPosition(async pos => {
    try { await deliver({ lat: pos.coords.latitude, lng: pos.coords.longitude, media_type: 'location' }); }
    catch (e) { alert(friendly(e)); }
  }, () => alert('Could not get your location. Allow location access for this site.'), { enableHighAccuracy: true, timeout: 15000 });
};
$('amPoll').onclick = () => {
  $('attachMenu').classList.add('hidden');
  $('pollQ').value = '';
  $('pollOpts').innerHTML = '';
  addPollOpt(); addPollOpt();
  $('pollMulti').checked = false;
  $('pollOverlay').classList.remove('hidden');
};
function addPollOpt() {
  const box = $('pollOpts');
  if (box.children.length >= 8) return;
  const i = document.createElement('input');
  i.placeholder = 'Option ' + (box.children.length + 1);
  box.appendChild(i);
}
$('pollAdd').onclick = addPollOpt;
$('pollCancel').onclick = () => $('pollOverlay').classList.add('hidden');
$('pollSend').onclick = async () => {
  const q = $('pollQ').value.trim();
  const opts = [...$('pollOpts').children].map(i => i.value.trim()).filter(Boolean);
  if (!q || opts.length < 2) return alert('Add a question and at least 2 options.');
  $('pollOverlay').classList.add('hidden');
  try { await deliver({ poll: { q, options: opts, multi: $('pollMulti').checked }, media_type: 'poll' }); }
  catch (e) { alert(friendly(e)); }
};

$('msgInput').addEventListener('paste', e => {
  const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
  if (f) { e.preventDefault(); setPending(f); }
});
$('msgInput').addEventListener('input', () => {
  autosize(); updateAction();
  if (!current) return;
  if (!editing) {
    const v = $('msgInput').value;
    if (v) localStorage.setItem('j3_draft_' + current.id, v); else localStorage.removeItem('j3_draft_' + current.id);
  }
  if (presenceCh && Date.now() - lastTypingSent > 2500) {
    lastTypingSent = Date.now();
    presenceCh.send({ type: 'broadcast', event: 'typing', payload: { from: me.id, name: me.username, to: current.id } });
  }
});
$('msgInput').addEventListener('keydown', e => {
  const desktop = !('ontouchstart' in window);
  if (e.key === 'Enter' && !e.shiftKey && desktop) { e.preventDefault(); sendText(); }
});
$('actionBtn').onclick = () => {
  if ($('msgInput').value.trim() || pendingFile || editing) sendText(); else startRec();
};

async function deliver(x) {
  const chat = current;
  let media = {};
  if (x.file) media = await uploadMedia(x.file);
  const row = {
    ...baseRow(chat),
    content: x.content || null,
    media_url: media.url || null,
    media_type: media.type || x.media_type || null,
    media_name: media.name || null,
    media_size: media.size || null,
    lat: x.lat != null ? x.lat : null,
    lng: x.lng != null ? x.lng : null,
    poll: x.poll || null,
    reply_to: replyTo ? replyTo.id : null
  };
  const { data, error } = await db.from('messages').insert(row).select().single();
  if (error) throw error;
  lastMsg[chat.id] = data;
  if (current === chat) { msgs[data.id] = data; addMsg(data, { fresh: true }); stickBottom = true; scrollDown(); }
  renderChats();
  return data;
}

async function sendText() {
  if (!current) return;
  const text = $('msgInput').value.trim();
  if (editing) {
    if (!text) return;
    const { data, error } = await db.from('messages')
      .update({ content: text, edited_at: new Date().toISOString() }).eq('id', editing.id).select().single();
    if (error) return alert(error.message.includes('Too late') ? 'You can only edit within 15 minutes.' : error.message);
    msgs[data.id] = data; updateMsg(data);
    Object.keys(lastMsg).forEach(k => { if (lastMsg[k].id === data.id) lastMsg[k] = data; });
    cancelBar(); renderChats();
    return;
  }
  if (!text && !pendingFile) return;
  const chat = current;
  $('actionBtn').disabled = true;
  try {
    await deliver({ content: text, file: pendingFile });
    $('msgInput').value = ''; autosize();
    clearPending();
    replyTo = null; $('replyBar').classList.add('hidden');
    localStorage.removeItem('j3_draft_' + chat.id);
  } catch (e) { alert(friendly(e)); }
  $('actionBtn').disabled = false;
  updateAction();
}

// ---------- voice notes ----------
let rec = null, recChunks = [], recCancelled = false, recMs = 0, recSeg = 0, recTick = null;
async function startRec() {
  if (!current) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = []; recCancelled = false; recMs = 0;
    const mt = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
    rec.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recTick);
      $('recBar').classList.add('hidden');
      $('composerMain').classList.remove('hidden');
      if (recCancelled || !recChunks.length) return;
      const type = rec.mimeType || 'audio/webm';
      const file = new File([new Blob(recChunks, { type })], 'voice.' + (type.includes('mp4') ? 'm4a' : 'webm'), { type });
      try { await deliver({ file }); } catch (e) { alert(friendly(e)); }
    };
    rec.start();
    recSeg = Date.now();
    $('recPause').textContent = '⏸';
    $('recTime').textContent = '0:00';
    recTick = setInterval(() => {
      const ms = recMs + (rec.state === 'recording' ? Date.now() - recSeg : 0);
      const s = Math.floor(ms / 1000);
      $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 300);
    $('composerMain').classList.add('hidden');
    $('recBar').classList.remove('hidden');
  } catch (e) { alert('Could not use the microphone. Allow microphone access for this site.'); }
}
$('recPause').onclick = () => {
  if (!rec) return;
  if (rec.state === 'recording') { rec.pause(); recMs += Date.now() - recSeg; $('recPause').textContent = '▶'; }
  else if (rec.state === 'paused') { rec.resume(); recSeg = Date.now(); $('recPause').textContent = '⏸'; }
};
$('recCancel').onclick = () => { recCancelled = true; if (rec) rec.stop(); };
$('recSend').onclick = () => { recCancelled = false; if (rec) rec.stop(); };

// ---------- touch: long-press for options, swipe right to reply ----------
const msgBox = $('messages');
let lpTimer = null, lpX = 0, lpY = 0, sw = null;

function openFor(el) {
  const m = msgs[el.dataset.id];
  if (!m || m.media_type === 'call') return;
  lpFired = Date.now();
  if (navigator.vibrate) navigator.vibrate(12);
  openSheet(m);
}
msgBox.addEventListener('touchstart', e => {
  clearTimeout(lpTimer);
  const el = e.target.closest('.msg');
  if (!el || el.classList.contains('callmsg')) { sw = null; return; }
  const t = e.touches[0];
  lpX = t.clientX; lpY = t.clientY;
  sw = { el, x: t.clientX, y: t.clientY, dx: 0, locked: false };
  lpTimer = setTimeout(() => { sw = null; el.style.transform = ''; openFor(el); }, 450);
}, { passive: true });
msgBox.addEventListener('touchmove', e => {
  const t = e.touches[0];
  if (Math.abs(t.clientX - lpX) > 10 || Math.abs(t.clientY - lpY) > 10) clearTimeout(lpTimer);
  if (!sw) return;
  const dx = t.clientX - sw.x, dy = t.clientY - sw.y;
  if (!sw.locked) {
    if (Math.abs(dy) > 12) { sw = null; return; }
    if (dx > 12 && Math.abs(dx) > Math.abs(dy)) sw.locked = true; else return;
  }
  sw.dx = Math.min(Math.max(dx, 0), 80);
  sw.el.style.transform = `translateX(${sw.dx}px)`;
}, { passive: true });
function endTouch() {
  clearTimeout(lpTimer);
  if (!sw) return;
  sw.el.style.transform = '';
  if (sw.dx > 55) { const m = msgs[sw.el.dataset.id]; if (m) setReply(m); }
  sw = null;
}
msgBox.addEventListener('touchend', endTouch);
msgBox.addEventListener('touchcancel', () => { clearTimeout(lpTimer); if (sw) sw.el.style.transform = ''; sw = null; });

// right-click on a laptop (and the phone's own long-press) also opens the menu
msgBox.addEventListener('contextmenu', e => {
  const el = e.target.closest('.msg');
  if (!el) return;
  e.preventDefault();
  if (Date.now() - lpFired < 800) return;
  openFor(el);
});
// a plain tap does nothing; swallow the tap that ends a long-press
document.addEventListener('click', e => {
  if (Date.now() - lpFired < 700 && e.target.closest && e.target.closest('#messages')) { e.stopPropagation(); e.preventDefault(); }
}, true);

// ---------- scrolling: stay at bottom, load history on the way up ----------
msgBox.addEventListener('scroll', () => {
  stickBottom = nearBottom();
  const far = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight > 300;
  $('toBottom').classList.toggle('hidden', !far);
  if (msgBox.scrollTop < 200) loadOlder();
}, { passive: true });
$('toBottom').onclick = () => {
  msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });
  $('toBottom').classList.add('hidden');
};
