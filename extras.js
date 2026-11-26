'use strict';
// ===== Just Us Three · themes, wallpapers, statuses, live updates, startup =====

const THEMES = [
  { id: 'dark', name: 'Classic', p: '#202c33', a: '#00a884' },
  { id: 'light', name: 'Light', p: '#f0f2f5', a: '#00a884' },
  { id: 'amoled', name: 'Black', p: '#0e0e0e', a: '#00a884' },
  { id: 'midnight', name: 'Midnight', p: '#141b33', a: '#4d7cff' },
  { id: 'violet', name: 'Violet', p: '#1e1630', a: '#9b6dff' },
  { id: 'forest', name: 'Forest', p: '#16271e', a: '#2fbf71' },
  { id: 'rose', name: 'Rose', p: '#2c1820', a: '#ff5c8a' },
  { id: 'sunset', name: 'Sunset', p: '#2d1d16', a: '#ff8a3d' },
  { id: 'ocean', name: 'Ocean', p: '#12282e', a: '#18c5d8' },
  { id: 'mocha', name: 'Mocha', p: '#261e18', a: '#d29a5b' },
  { id: 'sky', name: 'Sky', p: '#eef4fb', a: '#1e88e5' },
  { id: 'sand', name: 'Sand', p: '#f6eee2', a: '#c8862b' }
];
const WALLS = ['', '#0b141a', '#1f2c34', '#183a37', '#2b2540', '#3a2a1f', '#efeae2', '#d9e6f2',
  'linear-gradient(160deg,#0f2027,#203a43,#2c5364)', 'linear-gradient(160deg,#42275a,#734b6d)',
  'linear-gradient(160deg,#141e30,#243b55)', 'linear-gradient(160deg,#ff9966,#ff5e62)',
  'linear-gradient(160deg,#134e5e,#71b280)', 'linear-gradient(160deg,#3a1c71,#d76d77,#ffaf7b)',
  'radial-gradient(rgba(255,255,255,.07) 1.2px, transparent 1.2px) 0 0 / 22px 22px, #0b141a',
  'radial-gradient(rgba(0,0,0,.08) 1.2px, transparent 1.2px) 0 0 / 22px 22px, #efeae2'];
const BUBBLES = ['', '#005c4b', '#1565c0', '#6a1b9a', '#c62828', '#ef6c00', '#00838f', '#37474f', '#ad1457', '#2e7d32'];
const STATUS_COLORS = ['#005c4b', '#6a1b9a', '#1565c0', '#c62828', '#ef6c00', '#37474f'];
let svList = [], svIdx = 0, svTimer = null, statusBg = STATUS_COLORS[0], csScope = 'global';

const profOf = id => id === me.id ? me : (friends.find(f => f.id === id) || { username: 'Someone' });

// ---------- app themes ----------
function applyTheme(id) {
  if (!THEMES.some(t => t.id === id)) id = 'dark';
  document.body.dataset.theme = id;
  localStorage.setItem('j3_theme', id);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--panel').trim() || '#202c33';
}
function buildThemeGrid() {
  const g = $('themeGrid');
  g.innerHTML = '';
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.className = 'themeitem' + (document.body.dataset.theme === t.id ? ' sel' : '');
    const c = document.createElement('span'); c.className = 'themedot';
    c.style.background = `linear-gradient(135deg, ${t.p} 50%, ${t.a} 50%)`;
    const n = document.createElement('span'); n.textContent = t.name;
    b.append(c, n);
    b.onclick = () => { applyTheme(t.id); buildThemeGrid(); };
    g.appendChild(b);
  });
}
applyTheme(document.body.dataset.theme);

// ---------- wallpapers and bubble colors (for all chats, or just one) ----------
const styleStore = () => ls.get('j3_style', {});
function effStyle(key) {
  const s = styleStore(), g = s.global || {}, c = s[key] || {};
  return {
    wall: c.wall !== undefined ? c.wall : (g.wall || ''),
    bubble: c.bubble !== undefined ? c.bubble : (g.bubble || '')
  };
}
function applyStyle() {
  if (!current) return;
  const st = effStyle(current.id), m = $('messages'), pane = $('chatPane');
  if (st.wall.startsWith('img:')) m.style.background = `center / cover url("${st.wall.slice(4)}")`;
  else m.style.background = st.wall;
  if (st.bubble) {
    pane.style.setProperty('--mine', st.bubble);
    pane.style.setProperty('--mine-text', '#fff');
    pane.style.setProperty('--mine-sub', 'rgba(255,255,255,.72)');
  } else ['--mine', '--mine-text', '--mine-sub'].forEach(p => pane.style.removeProperty(p));
}
function buildSwatches(box, colors, selected, onPick) {
  box.innerHTML = '';
  colors.forEach(c => {
    const b = document.createElement('button');
    b.className = 'sw' + (c === selected ? ' sel' : '');
    b.style.background = c || 'var(--chatbg)';
    b.title = c || 'Default';
    b.onclick = () => { onPick(c); buildSwatches(box, colors, c, onPick); };
    box.appendChild(b);
  });
}
function renderCs() {
  const st = csScope === 'global' ? (styleStore().global || {}) : effStyle(csScope);
  const wall = st.wall || '';
  buildSwatches($('csWall'), WALLS, wall.startsWith('img:') ? '__img' : wall, c => setStyle({ wall: c }));
  buildSwatches($('csBubble'), BUBBLES, st.bubble || '', c => setStyle({ bubble: c }));
}
function setStyle(patch) {
  const s = styleStore();
  s[csScope] = Object.assign({}, s[csScope] || {}, patch);
  if (!ls.set('j3_style', s)) alert('Not enough space on this device to save that.');
  applyStyle();
}
function openChatStyle(scope) {
  csScope = scope;
  $('csTitle').textContent = scope === 'global' ? 'all chats' : 'this chat';
  renderCs();
  $('chatStyle').classList.remove('hidden');
}
$('csFile').onchange = async () => {
  const f = $('csFile').files[0];
  $('csFile').value = '';
  if (!f) return;
  try {
    const blob = await prep(f, 1080);
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    setStyle({ wall: 'img:' + url });
    renderCs();
    toast('Wallpaper set');
  } catch (e) { alert('That photo could not be used as a wallpaper.'); }
};
$('csReset').onclick = () => {
  const s = styleStore();
  delete s[csScope];
  ls.set('j3_style', s);
  applyStyle(); renderCs();
  toast('Reset');
};
$('csClose').onclick = () => $('chatStyle').classList.add('hidden');
$('globalStyleBtn').onclick = () => openChatStyle('global');

// ---------- statuses ----------
async function loadStatuses() {
  const list = $('statusList');
  list.innerHTML = '';
  const note = t => { const d = document.createElement('div'); d.className = 'user muted'; d.textContent = t; list.appendChild(d); };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await db.from('statuses').select('*').gte('created_at', since).order('created_at', { ascending: true });
  if (error) return note('Could not load statuses: ' + error.message);
  const byUser = {};
  (data || []).forEach(s => { (byUser[s.user_id] = byUser[s.user_id] || []).push(s); });
  const lastT = id => new Date(byUser[id][byUser[id].length - 1].created_at);
  const ids = Object.keys(byUser).sort((a, b) => a === me.id ? -1 : b === me.id ? 1 : lastT(b) - lastT(a));
  if (!ids.length) return note('No statuses right now.');
  ids.forEach(id => {
    const arr = byUser[id];
    const row = document.createElement('div'); row.className = 'user ring';
    row.appendChild(avatar(profOf(id)));
    const mid = document.createElement('div'); mid.className = 'mid';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = id === me.id ? 'My status' : profOf(id).username;
    const pv = document.createElement('div'); pv.className = 'pv'; pv.textContent = timeAgo(arr[arr.length - 1].created_at);
    mid.append(nm, pv);
    row.appendChild(mid);
    row.onclick = () => { svList = arr; svIdx = 0; $('statusView').classList.remove('hidden'); showStatus(); };
    list.appendChild(row);
  });
}
function showStatus() {
  clearTimeout(svTimer);
  const s = svList[svIdx];
  if (!s) return closeStatus();
  const mine = s.user_id === me.id;
  $('svName').textContent = mine ? 'My status' : profOf(s.user_id).username;
  $('svTime').textContent = `${svIdx + 1}/${svList.length} · ${timeAgo(s.created_at)}`;
  $('svDel').classList.toggle('hidden', !mine);
  $('svReplyRow').classList.toggle('hidden', mine);
  $('svViews').classList.toggle('hidden', !mine);
  $('svViews').textContent = '';
  const b = $('svBody');
  b.innerHTML = '';
  if (s.media_url && s.media_type === 'video') {
    const v = document.createElement('video');
    v.src = s.media_url; v.autoplay = true; v.controls = true; v.playsInline = true;
    v.onended = nextStatus; v.onclick = e => e.stopPropagation();
    b.appendChild(v);
  } else {
    if (s.media_url) { const i = document.createElement('img'); i.src = s.media_url; i.alt = ''; b.appendChild(i); }
    svTimer = setTimeout(nextStatus, 6000);
  }
  if (s.content) {
    const t = document.createElement('div');
    t.className = s.media_url ? 'cap' : 'big';
    if (!s.media_url && s.bg) t.style.background = s.bg;
    t.textContent = s.content;
    b.appendChild(t);
  }
  if (mine) loadViews(s);
  else db.from('status_views').upsert({ status_id: s.id, viewer_id: me.id }, { onConflict: 'status_id,viewer_id', ignoreDuplicates: true }).then(() => {});
}
async function loadViews(s) {
  const { data } = await db.from('status_views').select('viewer_id').eq('status_id', s.id);
  if (svList[svIdx] !== s) return;
  const n = (data || []).length;
  $('svViews').textContent = n ? `👁 ${n}: ` + data.map(v => profOf(v.viewer_id).username).join(', ') : '👁 No views yet';
}
function nextStatus() { svIdx++; showStatus(); }
function closeStatus() {
  clearTimeout(svTimer);
  $('statusView').classList.add('hidden');
  $('svBody').innerHTML = '';
  $('svReplyInput').value = '';
  loadStatuses();
}
$('svClose').onclick = closeStatus;
$('svBody').onclick = e => {
  if (e.clientX < window.innerWidth / 2) { svIdx = Math.max(0, svIdx - 1); showStatus(); } else nextStatus();
};
$('svDel').onclick = async () => {
  const s = svList[svIdx];
  if (!confirm('Delete this status?')) return;
  const { error } = await db.from('statuses').delete().eq('id', s.id);
  if (error) return alert(error.message);
  svList.splice(svIdx, 1);
  showStatus();
};
$('svReplyInput').onfocus = () => clearTimeout(svTimer);
$('svReplySend').onclick = async () => {
  const s = svList[svIdx];
  const t = $('svReplyInput').value.trim();
  if (!s || !t) return;
  const quote = '↩ Status: ' + (s.content ? s.content.slice(0, 40) : (s.media_type === 'video' ? '🎥 Video' : '📷 Photo'));
  const { data, error } = await db.from('messages')
    .insert({ sender_id: me.id, receiver_id: s.user_id, content: quote + '\n' + t }).select().single();
  if (error) return alert(friendly(error));
  $('svReplyInput').value = '';
  toast('Reply sent');
  lastMsg[s.user_id] = data;
  renderChats();
};

function closeAdd() {
  $('statusAdd').classList.add('hidden');
  $('statusText').value = ''; $('statusFile').value = ''; $('statusFileName').textContent = '';
}
$('addStatusRow').onclick = () => {
  buildSwatches($('statusColors'), STATUS_COLORS, statusBg, c => { statusBg = c; });
  $('statusAdd').classList.remove('hidden');
};
$('statusCancel').onclick = closeAdd;
$('statusFile').onchange = () => { const f = $('statusFile').files[0]; $('statusFileName').textContent = f ? f.name : ''; };
$('statusPost').onclick = async () => {
  const text = $('statusText').value.trim();
  const file = $('statusFile').files[0];
  if (!text && !file) return alert('Write something or add a photo or video.');
  $('statusPost').disabled = true;
  try {
    let media = {};
    if (file) media = await uploadMedia(file);
    const { error } = await db.from('statuses').insert({
      user_id: me.id, content: text || null, media_url: media.url || null, media_type: media.type || null,
      bg: file ? null : statusBg
    });
    if (error) throw error;
    closeAdd();
    toast('Status posted');
    loadStatuses();
  } catch (e) { alert('Status failed: ' + (e.message || e)); }
  $('statusPost').disabled = false;
};

// ---------- profile and settings ----------
$('meBtn').onclick = () => {
  $('pAv').innerHTML = ''; $('pAv').appendChild(avatar(me, true));
  $('pName').textContent = me.username;
  $('aboutInput').value = me.about || '';
  $('rrToggle').checked = me.read_receipts !== false;
  $('lsToggle').checked = me.show_last_seen !== false;
  buildThemeGrid();
  $('profileModal').classList.remove('hidden');
};
$('closeProfile').onclick = () => $('profileModal').classList.add('hidden');
$('rrToggle').onchange = async e => {
  me.read_receipts = e.target.checked;
  await db.from('profiles').update({ read_receipts: me.read_receipts }).eq('id', me.id);
};
$('lsToggle').onchange = async e => {
  me.show_last_seen = e.target.checked;
  const patch = { show_last_seen: me.show_last_seen };
  if (!me.show_last_seen) patch.last_seen = null;
  await db.from('profiles').update(patch).eq('id', me.id);
  if (presenceCh) {
    if (me.show_last_seen) { await presenceCh.track({ at: Date.now() }); touchSeen(); }
    else await presenceCh.untrack();
  }
};
$('avatarFile').onchange = async () => {
  const f = $('avatarFile').files[0];
  $('avatarFile').value = '';
  if (!f) return;
  try {
    const up = await uploadMedia(f, 400);
    const { error } = await db.from('profiles').update({ avatar_url: up.url }).eq('id', me.id);
    if (error) throw error;
    me.avatar_url = up.url;
    $('pAv').innerHTML = ''; $('pAv').appendChild(avatar(me, true));
    renderMe();
  } catch (e) { alert(e.message); }
};
$('saveProfile').onclick = async () => {
  const about = $('aboutInput').value.trim();
  const { error } = await db.from('profiles').update({ about }).eq('id', me.id);
  if (error) return alert(error.message);
  me.about = about;
  $('profileModal').classList.add('hidden');
  toast('Saved');
};
$('logoutBtn').onclick = async () => { await db.auth.signOut(); location.reload(); };

// ---------- live updates ----------
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await loadChats();
    if (!$('groupInfo').classList.contains('hidden')) openGroupInfo();
  }, 400);
}

function alertFor(m, key) {
  if (m.media_type === 'call') return;
  const mentioned = mentionsMe(m);
  if (isMuted(key) && !mentioned) return;
  beep();
  const g = m.group_id ? chatByKey(key) : null;
  notify(g ? g.username + ' · ' + nameOf(m.sender_id) : nameOf(m.sender_id), (mentioned ? '@ You were mentioned: ' : '') + snip(m));
}

function startRealtime() {
  presenceCh = db.channel('room', { config: { presence: { key: me.id } } });
  presenceCh.on('presence', { event: 'sync' }, () => {
    online = new Set(Object.keys(presenceCh.presenceState()));
    setSub(); renderChats();
  });
  presenceCh.on('broadcast', { event: 'typing' }, ({ payload }) => {
    const to = payload.to;
    let key;
    if (typeof to === 'string' && to.startsWith('g:')) { if (!chatByKey(to)) return; key = to; }
    else if (to === me.id) key = payload.from;
    else return;
    typing[key] = { until: Date.now() + 3000, name: payload.name };
    setSub();
    setTimeout(setSub, 3100);
  });
  presenceCh.on('broadcast', { event: 'call' }, ({ payload }) => handleSignal(payload));
  presenceCh.on('broadcast', { event: 'party' }, ({ payload }) => { if (window.partySignal) partySignal(payload); });
  presenceCh.subscribe(async s => {
    if (s === 'SUBSCRIBED' && me.show_last_seen !== false) await presenceCh.track({ at: Date.now() });
  });

  liveCh = db.channel('live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
      const m = p.new;
      if (msgs[m.id]) return;
      if (m.group_id && !chatByKey('g:' + m.group_id)) { scheduleReload(); return; }
      if (!m.group_id && m.receiver_id !== me.id && m.sender_id !== me.id) return;
      const key = keyOf(m);
      lastMsg[key] = m;
      const other = m.sender_id !== me.id;
      if (current && current.id === key) {
        const near = nearBottom();
        msgs[m.id] = m; addMsg(m, { fresh: true });
        if (near || !other) { stickBottom = true; scrollDown(); }
        if (other) { markSeen(key); if (!m.group_id) markRead(); }
      } else if (other && m.media_type !== 'call') unread[key] = (unread[key] || 0) + 1;
      if (other) {
        if (m.receiver_id === me.id) db.from('messages').update({ delivered_at: new Date().toISOString() }).eq('id', m.id).then(() => {});
        alertFor(m, key);
      }
      renderChats();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, p => {
      const n = p.new, o = msgs[n.id];
      if (!o) return;
      const changed = n.content !== o.content || n.edited_at !== o.edited_at;
      msgs[n.id] = n;
      if (changed) {
        updateMsg(n);
        Object.keys(lastMsg).forEach(k => { if (lastMsg[k].id === n.id) lastMsg[k] = n; });
        renderChats();
      } else {
        const el = document.querySelector(`.msg[data-id="${n.id}"] .tick`);
        if (el) setTick(el, n);
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => { removeMsg(p.old.id); loadChats(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => { if (current) loadReactions(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pins' }, () => { if (current) loadPins(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, () => { if (current) loadVotes(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, scheduleReload)
    .subscribe();
}

// ---------- boot ----------
db.auth.getSession()
  .then(({ data }) => { if (data.session) start(data.session.user); else showAuth(); })
  .catch(showAuth);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
