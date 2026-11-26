'use strict';
// ===== Just Us Three · core: setup, login, chat list =====

const CFG = window.J3_CONFIG || {};
if (!CFG.url || !CFG.key || /PASTE/.test(CFG.url + CFG.key)) {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif;color:#fff">Open <b>config.js</b>, paste your Supabase URL and key, save, then refresh.</p>';
  throw new Error('Missing config.js values');
}
const db = supabase.createClient(CFG.url, CFG.key);
const $ = id => document.getElementById(id);

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EDIT_MS = 15 * 60 * 1000;
const PAGE = 50;

let me = null, current = null, friends = [], groups = [], members = {};
let lastMsg = {}, unread = {}, hidden = new Set(), starred = new Set(), blocked = new Set();
let msgs = {}, reacts = {}, votes = {}, pinned = new Set(), pinIdx = 0;
let online = new Set(), typing = {}, presenceCh = null, liveCh = null, lastTypingSent = 0;
let replyTo = null, editing = null, sheetMsg = null, pendingFile = null, lastDay = '';
let showArchived = false, chatFilter = 'all', reloadTimer = null, searchTimer = null, toastTimer = null, rcQueued = false;
let oldestTs = null, allLoaded = false, loadingOlder = false, stickBottom = true;

document.body.dataset.theme = localStorage.getItem('j3_theme') || 'dark';
setTimeout(() => $('splash').classList.add('gone'), 6000);

// ---------- crisp icons ----------
const ICONS = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  phone: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  video: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  group: 'M8 10H5V7H3v3H0v2h3v3h2v-3h3v-2zm10 1c1.66 0 2.99-1.34 2.99-3S19.66 5 18 5c-.32 0-.63.05-.91.14.57.81.9 1.79.9 2.86s-.34 2.04-.9 2.86c.28.09.59.14.91.14zm-5 0c1.66 0 2.99-1.34 2.99-3S14.66 5 13 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm6.62 2.16c.83.73 1.38 1.66 1.38 2.84v2h3v-2c0-1.54-2.37-2.49-4.38-2.84zM13 13c-2 0-6 1-6 3v2h12v-2c0-2-4-3-6-3z',
  attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'
};
const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(b => { b.innerHTML = icon(b.dataset.icon); });

// ---------- small helpers ----------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const say = t => { $('authMsg').textContent = t; };
const fakeEmail = u => u + '@mychat.app';
const hideSplash = () => $('splash').classList.add('gone');
function showAuth() { $('auth').classList.remove('hidden'); hideSplash(); }
function toast(t) {
  const e = $('toast');
  e.textContent = t; e.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => e.classList.add('hidden'), 2600);
}
function scrollDown() { const m = $('messages'); m.scrollTop = m.scrollHeight; }
function nearBottom() { const m = $('messages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 200; }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function dayLabel(iso) {
  const d = new Date(iso), n = new Date(), y = new Date();
  y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  return Math.floor(m / 60) + ' h ago';
}
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function friendly(e) {
  const t = (e && e.message) || String(e);
  return /row-level security|violates/i.test(t) ? "You can't send messages here (you may be blocked, or only admins can send)." : t;
}
const keyOf = m => m.group_id ? 'g:' + m.group_id : (m.sender_id === me.id ? m.receiver_id : m.sender_id);
const allChats = () => [...groups, ...friends];
const chatByKey = k => allChats().find(c => c.id === k);
const isAdminOf = g => (members[g.gid] || []).some(r => r.user_id === me.id && r.role === 'admin');
const canSendTo = c => c.isGroup ? (!c.only_admins_send || isAdminOf(c)) : !blocked.has(c.id);
function nameOf(id) {
  if (me && id === me.id) return 'You';
  const f = friends.find(x => x.id === id);
  return f ? f.username : 'Someone';
}
function snip(m) {
  if (m.media_type === 'poll') return '📊 ' + ((m.poll && m.poll.q) || 'Poll');
  if (m.media_type === 'location') return '📍 Location';
  if (m.media_type === 'call') return '📞 ' + (m.content || 'Call');
  const k = m.media_type === 'video' ? '🎥 Video' : m.media_type === 'audio' ? '🎤 Voice message'
    : m.media_type === 'image' ? '📷 Photo' : m.media_type === 'file' ? '📄 ' + (m.media_name || 'File') : '';
  const t = (m.content || '').replace(/\s+/g, ' ').slice(0, 60);
  return k && t ? k + ' ' + t : (k || t);
}
function avatar(u, big) {
  const d = document.createElement('div');
  d.className = 'av' + (big ? ' big' : '');
  if (u.isGroup && !u.icon_url) { d.textContent = '👥'; return d; }
  const src = u.isGroup ? u.icon_url : u.avatar_url;
  if (src) {
    const i = document.createElement('img');
    i.src = src; i.alt = ''; i.decoding = 'async';
    d.appendChild(i);
    return d;
  }
  d.textContent = (u.username || '?')[0].toUpperCase();
  let h = 0;
  for (const c of u.username || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  d.style.background = `hsl(${h} 45% 40%)`;
  return d;
}
function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.1, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25);
    o.start(); o.stop(c.currentTime + 0.25);
  } catch (e) {}
}
async function notify(title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, { body, icon: 'icon-192.png', tag: 'j3' });
  } catch (e) {}
}
const isMuted = k => ls.get('j3_muted', []).includes(k);
const mentionsMe = m => !!(m.content && me && new RegExp('@' + me.username + '\\b', 'i').test(m.content));
const seenMap = () => ls.get('j3_seen', {});
function markSeen(key) { const s = seenMap(); s[key] = Date.now(); ls.set('j3_seen', s); }
function isUnreadMsg(m, key) {
  if (m.sender_id === me.id || hidden.has(m.id) || m.media_type === 'call') return false;
  if (!m.group_id && me.read_receipts !== false) return !m.read_at;
  return new Date(m.created_at).getTime() > (seenMap()[key] || 0);
}
function chatQuery(q, u) {
  return u.isGroup ? q.eq('group_id', u.gid)
    : q.is('group_id', null).or(`and(sender_id.eq.${me.id},receiver_id.eq.${u.id}),and(sender_id.eq.${u.id},receiver_id.eq.${me.id})`);
}

// ---------- sign up / log in ----------
$('signupBtn').onclick = async () => {
  const u = $('username').value.trim().toLowerCase();
  const p = $('password').value;
  const code = $('invite').value.trim();
  if (!/^[a-z0-9_]{3,20}$/.test(u)) return say('Username: 3-20 letters, numbers or _');
  if (p.length < 6) return say('Password must be at least 6 characters');
  if (!code) return say('Enter the invite code');
  say('Creating account...');
  const { data, error } = await db.auth.signUp({ email: fakeEmail(u), password: p, options: { data: { invite: code } } });
  if (error) return say(error.message.includes('Database error') ? 'Wrong invite code' : error.message);
  if (!data.session) return say('Turn OFF "Confirm email" in Supabase.');
  const { error: e2 } = await db.from('profiles').insert({ id: data.user.id, username: u });
  if (e2) return say(e2.message);
  start(data.user);
};
$('loginBtn').onclick = async () => {
  const u = $('username').value.trim().toLowerCase();
  say('Logging in...');
  const { data, error } = await db.auth.signInWithPassword({ email: fakeEmail(u), password: $('password').value });
  if (error) return say('Wrong username or password');
  start(data.user);
};

// ---------- start ----------
async function start(user) {
  try {
    const { data: prof } = await db.from('profiles').select('*').eq('id', user.id).single();
    if (!prof) { showAuth(); return say('Profile not found. Delete this user in Supabase and sign up again.'); }
    me = prof;
    $('auth').classList.add('hidden');
    $('app').classList.remove('hidden');
    renderMe();
    hideSplash();
    await loadChats();
    startRealtime();
    touchSeen();
    setInterval(touchSeen, 60000);
    document.addEventListener('click', () => {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }, { once: true });
  } catch (e) { showAuth(); say('Could not connect. Check your internet.'); }
}
function touchSeen() {
  if (!document.hidden && me && me.show_last_seen !== false) {
    db.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', me.id).then(() => {});
  }
}
function renderMe() {
  $('meAv').innerHTML = '';
  $('meAv').appendChild(avatar(me));
  $('meName').textContent = me.username;
}

// ---------- chat list ----------
async function loadChats() {
  const [pf, gr, gm, rm, hd, st, bl] = await Promise.all([
    db.from('profiles').select('*').neq('id', me.id).order('username'),
    db.from('groups').select('*'),
    db.from('group_members').select('*'),
    db.from('messages').select('*').order('created_at', { ascending: false }).limit(500),
    db.from('hidden_messages').select('message_id'),
    db.from('stars').select('message_id'),
    db.from('blocks').select('blocked')
  ]);
  friends = pf.data || [];
  members = {};
  (gm.data || []).forEach(r => { (members[r.group_id] = members[r.group_id] || []).push(r); });
  groups = (gr.data || []).map(g => ({ ...g, id: 'g:' + g.id, gid: g.id, isGroup: true, username: g.name }));
  hidden = new Set((hd.data || []).map(x => x.message_id));
  starred = new Set((st.data || []).map(x => x.message_id));
  blocked = new Set((bl.data || []).map(x => x.blocked));

  const s = seenMap();
  let changed = false;
  allChats().forEach(c => { if (!s[c.id]) { s[c.id] = Date.now(); changed = true; } });
  if (changed) ls.set('j3_seen', s);

  lastMsg = {}; unread = {};
  (rm.data || []).forEach(m => {
    if (hidden.has(m.id)) return;
    const key = keyOf(m);
    if (!lastMsg[key]) lastMsg[key] = m;
    if (isUnreadMsg(m, key)) unread[key] = (unread[key] || 0) + 1;
  });

  if (current) {
    const f = chatByKey(current.id);
    if (f) { Object.assign(current, f); unread[current.id] = 0; headerInfo(); updateComposerState(); }
    else if (current.isGroup) { closeChat(); toast('You are no longer in that group'); }
  }
  renderChats();
  markDelivered();
}
function markDelivered() {
  db.from('messages').update({ delivered_at: new Date().toISOString() })
    .eq('receiver_id', me.id).is('delivered_at', null).then(() => {});
}

function previewOf(m) {
  if (!m) return '';
  const who = m.sender_id === me.id ? 'You: ' : (m.group_id ? nameOf(m.sender_id) + ': ' : '');
  return who + snip(m);
}

function chatRow(u) {
  const row = document.createElement('div');
  row.className = 'user' + (current && current.id === u.id ? ' active' : '') + (unread[u.id] ? ' unr' : '');
  const av = avatar(u);
  if (online.has(u.id)) av.classList.add('on');
  row.appendChild(av);
  const mid = document.createElement('div'); mid.className = 'mid';
  const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = u.username;
  const pv = document.createElement('div'); pv.className = 'pv';
  const draft = (!current || current.id !== u.id) ? localStorage.getItem('j3_draft_' + u.id) : null;
  if (draft) {
    const d = document.createElement('span'); d.className = 'draft'; d.textContent = 'Draft: ';
    pv.append(d, draft.replace(/\s+/g, ' ').slice(0, 50));
  } else pv.textContent = previewOf(lastMsg[u.id]) || u.about || (u.isGroup ? 'Group' : '');
  mid.append(nm, pv);
  row.appendChild(mid);
  const right = document.createElement('div'); right.className = 'right';
  if (lastMsg[u.id]) {
    const tm = document.createElement('div'); tm.className = 'tm' + (unread[u.id] ? ' unread' : '');
    tm.textContent = fmtTime(lastMsg[u.id].created_at);
    right.appendChild(tm);
  }
  const icons = (ls.get('j3_pinchats', []).includes(u.id) ? '📌' : '') + (isMuted(u.id) ? '🔇' : '');
  if (unread[u.id]) {
    const b = document.createElement('span'); b.className = 'badge'; b.textContent = unread[u.id];
    right.appendChild(b);
  } else if (icons) {
    const ic = document.createElement('span'); ic.textContent = icons;
    right.appendChild(ic);
  }
  row.appendChild(right);
  row.onclick = () => openChat(u);
  return row;
}

// drawing is batched into one frame, so many events never make the list jump
function renderChats() {
  if (rcQueued) return;
  rcQueued = true;
  requestAnimationFrame(() => { rcQueued = false; drawChats(); });
}
function drawChats() {
  const q = $('searchInput').value.trim().toLowerCase();
  const archived = new Set(ls.get('j3_archived', []));
  const pinnedC = new Set(ls.get('j3_pinchats', []));
  const list = $('userList');
  const frag = document.createDocumentFragment();
  let all = allChats().filter(u => u.username.toLowerCase().includes(q));
  const archCount = all.filter(u => archived.has(u.id)).length;
  all = all.filter(u => showArchived ? archived.has(u.id) : !archived.has(u.id));
  if (chatFilter === 'unread') all = all.filter(u => unread[u.id]);
  if (chatFilter === 'groups') all = all.filter(u => u.isGroup);
  const t = u => lastMsg[u.id] ? new Date(lastMsg[u.id].created_at).getTime() : 0;
  all.sort((a, b) => (pinnedC.has(b.id) - pinnedC.has(a.id)) || (t(b) - t(a)));
  $('archivedRow').classList.toggle('hidden', !(archCount || showArchived));
  $('archivedRow').textContent = showArchived ? '← Back to chats' : `🗄 Archived (${archCount})`;
  all.forEach(u => frag.appendChild(chatRow(u)));
  if (!all.length && !q) {
    const d = document.createElement('div'); d.className = 'user muted';
    d.textContent = showArchived ? 'No archived chats.' : chatFilter === 'unread' ? 'No unread chats.' : 'No chats yet.';
    frag.appendChild(d);
  }
  list.replaceChildren(frag);
  const total = Object.values(unread).reduce((a, b) => a + b, 0);
  document.title = (total ? `(${total}) ` : '') + 'Just Us Three';
}
$('archivedRow').onclick = () => { showArchived = !showArchived; renderChats(); };
document.querySelectorAll('#chips .chip').forEach(b => {
  b.onclick = () => {
    chatFilter = b.dataset.f;
    document.querySelectorAll('#chips .chip').forEach(x => x.classList.toggle('active', x === b));
    renderChats();
  };
});

// global search: chat names + message text
$('searchInput').oninput = () => {
  renderChats();
  clearTimeout(searchTimer);
  const q = $('searchInput').value.trim();
  searchTimer = setTimeout(() => searchMessages(q), 300);
};
async function searchMessages(q) {
  const box = $('msgResults');
  box.innerHTML = '';
  if (q.length < 2) return;
  const { data } = await db.from('messages').select('*').ilike('content', '%' + q + '%')
    .order('created_at', { ascending: false }).limit(30);
  if ($('searchInput').value.trim() !== q) return;
  const rows = (data || []).filter(m => !hidden.has(m.id) && chatByKey(keyOf(m)));
  if (!rows.length) return;
  const h = document.createElement('div'); h.className = 'sechead'; h.textContent = 'Messages';
  box.appendChild(h);
  rows.forEach(m => {
    const c = chatByKey(keyOf(m));
    const row = document.createElement('div'); row.className = 'user';
    row.appendChild(avatar(c));
    const mid = document.createElement('div'); mid.className = 'mid';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = c.username;
    const pv = document.createElement('div'); pv.className = 'pv'; pv.textContent = nameOf(m.sender_id) + ': ' + snip(m);
    mid.append(nm, pv);
    const tm = document.createElement('div'); tm.className = 'tm'; tm.textContent = dayLabel(m.created_at);
    row.append(mid, tm);
    row.onclick = () => { $('searchInput').value = ''; box.innerHTML = ''; renderChats(); openChat(c, m.id); };
    box.appendChild(row);
  });
}

function showTab(t) {
  $('chatsPane').classList.toggle('hidden', t !== 'chats');
  $('statusPane').classList.toggle('hidden', t !== 'status');
  $('callsPane').classList.toggle('hidden', t !== 'calls');
  $('tabChats').classList.toggle('active', t === 'chats');
  $('tabStatus').classList.toggle('active', t === 'status');
  $('tabCalls').classList.toggle('active', t === 'calls');
}
$('tabChats').onclick = () => showTab('chats');
$('tabStatus').onclick = () => { showTab('status'); loadStatuses(); };
$('tabCalls').onclick = () => { showTab('calls'); loadCalls(); };

// ---------- open / close a chat ----------
async function openChat(u, jumpId) {
  if (typeof partyOnSwitch === 'function') partyOnSwitch(u);   // Watch Party: leave the old chat's party
  const wasOpen = $('app').classList.contains('chat-open');
  const oldSeen = seenMap()[u.id] || 0;
  const hadUnread = unread[u.id] || 0;
  current = u;
  unread[u.id] = 0;
  markSeen(u.id);
  cancelBar(); clearPending();
  $('chatMenu').classList.add('hidden');
  $('attachMenu').classList.add('hidden');
  $('chatSearch').classList.add('hidden');
  $('chatSearchInput').value = '';
  $('empty').classList.add('hidden');
  $('chatPane').classList.remove('hidden');
  $('app').classList.add('chat-open');
  if (!wasOpen) history.pushState({ chat: 1 }, '');
  $('msgInput').value = localStorage.getItem('j3_draft_' + u.id) || '';
  autosize(); updateAction();
  headerInfo();
  updateComposerState();
  $('messages').innerHTML = '<div class="loadmsg"><div class="spinner small"></div></div>';
  msgs = {}; reacts = {}; votes = {}; pinned = new Set(); pinIdx = 0; lastDay = '';
  oldestTs = null; allLoaded = false; loadingOlder = false; stickBottom = true;
  renderPinBar();
  applyStyle();
  renderChats();

  const { data } = await chatQuery(db.from('messages').select('*').order('created_at', { ascending: false }).limit(PAGE), u);
  if (current !== u) return;
  const rows = data || [];
  allLoaded = rows.length < PAGE;
  const list = rows.slice().reverse();
  if (list.length) oldestTs = list[0].created_at;

  const firstUnread = hadUnread ? list.find(m => m.sender_id !== me.id && !hidden.has(m.id) && m.media_type !== 'call'
    && (!m.group_id && me.read_receipts !== false ? !m.read_at : new Date(m.created_at).getTime() > oldSeen)) : null;
  const r = renderBatch(list, firstUnread ? { id: firstUnread.id, count: hadUnread } : null);
  const box = $('messages');
  box.innerHTML = '';
  box.appendChild(r.frag);
  lastDay = r.day;
  const line = $('unreadLine');
  if (line && !jumpId) { stickBottom = false; line.scrollIntoView({ block: 'start' }); }
  else scrollDown();
  await loadMeta();
  markRead();
  refreshHeader(u);
  if (jumpId) { await ensureLoaded(jumpId); jumpTo(jumpId); }
}

function closeChat() {
  if (typeof partyClose === 'function') partyClose();
  $('app').classList.remove('chat-open');
  current = null;
  $('chatPane').classList.add('hidden');
  $('empty').classList.remove('hidden');
  renderChats();
}
$('backBtn').onclick = () => { if (history.state && history.state.chat) history.back(); else closeChat(); };
window.addEventListener('popstate', () => { if (current) closeChat(); });

function headerInfo() {
  if (!current) return;
  $('chatAv').innerHTML = '';
  $('chatAv').appendChild(avatar(current));
  $('chatTitle').textContent = current.username;
  $('voiceBtn').classList.toggle('hidden', !!current.isGroup);
  $('videoBtn').classList.toggle('hidden', !!current.isGroup);
  setSub();
}
$('chatAv').onclick = () => {
  if (!current) return;
  if (current.isGroup) openGroupInfo(); else openContactInfo();
};
$('chatTitle').onclick = () => $('chatAv').onclick();

function openContactInfo() {
  const u = current;
  if (!u || u.isGroup) return;
  $('infoTitle').textContent = 'Contact info';
  const b = $('infoBody');
  b.innerHTML = '';
  const head = document.createElement('div'); head.className = 'gihead';
  const nm = document.createElement('b'); nm.textContent = u.username;
  const ab = document.createElement('div'); ab.className = 'pv'; ab.textContent = u.about || 'Hey there!';
  const st = document.createElement('div'); st.className = 'pv'; st.textContent = $('chatSub').textContent;
  head.append(avatar(u, true), nm, ab, st);
  b.appendChild(head);
  const row = document.createElement('div'); row.className = 'quickrow';
  [['📞 Voice', () => startCall(false)], ['🎥 Video', () => startCall(true)], ['🖼 Media', () => openMedia()]].forEach(([l, f]) => {
    const x = document.createElement('button');
    x.className = 'secondary'; x.textContent = l;
    x.onclick = () => { $('infoCard').classList.add('hidden'); f(); };
    row.appendChild(x);
  });
  b.appendChild(row);
  $('infoCard').classList.remove('hidden');
}

async function refreshHeader(u) {
  if (u.isGroup) return;
  const { data } = await db.from('profiles').select('*').eq('id', u.id).single();
  if (data && current === u) Object.assign(u, data);
  setSub();
}
function setSub() {
  if (!current) return;
  const t = typing[current.id];
  const isTyping = !!(t && t.until > Date.now());
  let s = '';
  if (isTyping) s = current.isGroup ? t.name + ' is typing…' : 'typing…';
  else if (current.isGroup) s = (members[current.gid] || []).length + ' members';
  else if (online.has(current.id)) s = 'online';
  else if (current.show_last_seen !== false && current.last_seen) {
    const l = dayLabel(current.last_seen);
    s = 'last seen ' + (l === 'Today' ? 'today' : l === 'Yesterday' ? 'yesterday' : l) + ' at ' + fmtTime(current.last_seen);
  }
  $('chatSub').textContent = s;
  $('chatSub').classList.toggle('typing', isTyping || (!current.isGroup && online.has(current.id)));
}

function updateComposerState() {
  let note = '';
  if (current) {
    if (!current.isGroup && blocked.has(current.id)) note = 'You blocked this contact. Open the ⋮ menu to unblock.';
    else if (current.isGroup && !canSendTo(current)) note = 'Only admins can send messages in this group.';
  }
  $('notice').textContent = note;
  $('notice').classList.toggle('hidden', !note);
  $('composer').classList.toggle('hidden', !!note);
}

async function markRead() {
  if (!current || current.isGroup || document.hidden || me.read_receipts === false) return;
  await db.from('messages').update({ read_at: new Date().toISOString() })
    .eq('receiver_id', me.id).eq('sender_id', current.id).is('read_at', null);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { markRead(); touchSeen(); if (current) markSeen(current.id); }
});

// ---------- chat menu ----------
$('menuBtn').onclick = e => { e.stopPropagation(); $('attachMenu').classList.add('hidden'); openMenu(); };
document.addEventListener('click', () => { $('chatMenu').classList.add('hidden'); $('attachMenu').classList.add('hidden'); });
function openMenu() {
  const m = $('chatMenu');
  if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
  m.innerHTML = '';
  const k = current.id;
  const add = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'plain'; b.textContent = label;
    b.onclick = () => { m.classList.add('hidden'); fn(); };
    m.appendChild(b);
  };
  const has = key => ls.get(key, []).includes(k);
  const toggle = key => {
    const s = new Set(ls.get(key, []));
    s.has(k) ? s.delete(k) : s.add(k);
    ls.set(key, [...s]);
    renderChats();
  };
  add(current.isGroup ? 'Group info' : 'Contact info', () => $('chatAv').onclick());
  add('Search in chat', () => { $('chatSearch').classList.remove('hidden'); $('chatSearchInput').focus(); });
  add('Media, links and docs', openMedia);
  add('Wallpaper and colors', () => openChatStyle(current.id));
  add(has('j3_pinchats') ? 'Unpin chat' : 'Pin chat to top', () => toggle('j3_pinchats'));
  add(has('j3_muted') ? 'Unmute notifications' : 'Mute notifications', () => toggle('j3_muted'));
  add(has('j3_archived') ? 'Unarchive chat' : 'Archive chat', () => {
    const was = has('j3_archived');
    toggle('j3_archived');
    if (!was) { closeChat(); toast('Chat archived'); }
  });
  add('Export chat (.txt)', exportChat);
  add('Clear chat', clearChat);
  if (!current.isGroup) add(blocked.has(k) ? 'Unblock' : 'Block', toggleBlock);
  m.classList.remove('hidden');
}
$('chatSearchClose').onclick = () => { $('chatSearch').classList.add('hidden'); $('chatSearchInput').value = ''; filterChat(); };
$('chatSearchInput').oninput = filterChat;
function filterChat() {
  const q = $('chatSearchInput').value.trim().toLowerCase();
  document.querySelectorAll('#messages .msg').forEach(el => {
    el.classList.toggle('hidden', !!q && !el.textContent.toLowerCase().includes(q));
  });
  document.querySelectorAll('#messages .day').forEach(el => el.classList.toggle('hidden', !!q));
}

$('newGroupBtn').onclick = () => openNewGroup();
$('starBtn').onclick = () => openStarred();
