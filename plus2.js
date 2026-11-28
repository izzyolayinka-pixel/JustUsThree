'use strict';
// ===== Just Us Three · plus2 layer (loads AFTER plus.js; adds only) =====
(() => {
// ---------- opening a chat shows the LAST message (no jumping up to the first unread one) ----------
const _siv = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function (o) {
  if (this.id === 'unreadLine') { stickBottom = true; scrollDown(); return; }
  return _siv.call(this, o);
};

// ---------- long-press never highlights text ----------
document.addEventListener('selectstart', e => {
  const t = e.target.nodeType === 3 ? e.target.parentElement : e.target;
  if (!t || !t.closest || t.closest('input,textarea')) return;
  if (t.closest('#sheet,.psheet,#selBar,#userList,.topbar,#partyBox')) e.preventDefault();
}, true);
const _openSheet = openSheet;
openSheet = function (m) { try { getSelection().removeAllRanges(); } catch (e) {} _openSheet(m); };

// ---------- coming back to the app: fetch what you missed in the open chat ----------
let busyCatch = false;
async function catchUp() {
  if (busyCatch || !me) return;
  busyCatch = true;
  try {
    loadChats();
    const chat = current; if (!chat) return;
    let ts = null; Object.values(msgs).forEach(m => { if (!ts || m.created_at > ts) ts = m.created_at; });
    if (!ts) return;
    const { data } = await chatQuery(db.from('messages').select('*').gt('created_at', ts).order('created_at', { ascending: true }).limit(100), chat);
    if (current !== chat || !data) return;
    let added = false;
    data.forEach(m => { if (msgs[m.id] || hidden.has(m.id)) return; msgs[m.id] = m; addMsg(m, { fresh: false }); added = true; });
    if (added) { if (nearBottom() || stickBottom) scrollDown(); markRead(); loadMeta(); renderChats(); }
  } catch (e) {} finally { busyCatch = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });
window.addEventListener('online', catchUp);

// ---------- Watch Party: anyone can play / pause / skip / seek (the host's player still does the work) ----------
const box = $('partyBox'), stage = $('partyStage');
const isHost = () => box.classList.contains('host'), isViewer = () => box.classList.contains('viewer');
function hostCtl(raw) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || m.k !== 'ctl' || !isHost()) return;
  const v = $('partyVid');
  if (m.a === 'play') v.play().catch(() => {});
  else if (m.a === 'pause') v.pause();
  else if (m.a === 'seek' && isFinite(m.t)) v.currentTime = Math.max(0, Math.min(v.duration || m.t, m.t));
  else if (m.a === 'skip' && isFinite(m.d)) v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + m.d));
  else return;
  const what = { play: 'pressed play', pause: 'paused', seek: 'skipped ahead', skip: m.d < 0 ? 'went back 10s' : 'skipped 10s' }[m.a];
  toast((m.n || 'Someone') + ' ' + what);
}
const RPC = window.RTCPeerConnection;
if (RPC) {
  const cdc = RPC.prototype.createDataChannel;
  RPC.prototype.createDataChannel = function (label, o) {
    const dc = cdc.call(this, label, o);
    if (label === 'party') dc.addEventListener('message', ev => hostCtl(ev.data));
    return dc;
  };
  const d = Object.getOwnPropertyDescriptor(RPC.prototype, 'ondatachannel');
  if (d && d.set) {
    const seen = new WeakSet();
    Object.defineProperty(RPC.prototype, 'ondatachannel', {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(fn) {
        if (!seen.has(this)) { seen.add(this); this.addEventListener('datachannel', e => { if (e.channel.label === 'party') window.__j3pc = e.channel; }); }
        d.set.call(this, fn);
      }
    });
  }
}
function viewerCtl(o) {
  const dc = window.__j3pc;
  if (!dc || dc.readyState !== 'open') { toast('Still connecting…'); return; }
  try { dc.send(JSON.stringify({ k: 'ctl', n: me.username, ...o })); } catch (e) {}
}
const secs = s => (s || '').split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
$('partyPlay').addEventListener('click', () => { if (isViewer()) viewerCtl({ a: $('partyPlay').textContent === '⏸' ? 'pause' : 'play' }); });
$('partyBack').addEventListener('click', () => { if (isViewer()) viewerCtl({ a: 'skip', d: -10 }); });
$('partyFwd').addEventListener('click', () => { if (isViewer()) viewerCtl({ a: 'skip', d: 10 }); });
$('partySeek').addEventListener('change', () => {
  if (!isViewer()) return;
  const dur = secs($('partyTime').textContent.split(' / ')[1]);
  if (dur) viewerCtl({ a: 'seek', t: $('partySeek').value / 1000 * dur });
});

// double-tap the picture: left = back 10s, right = forward 10s, middle = play / pause
let lt = 0, lx = 0;
stage.addEventListener('pointerup', e => {
  if (e.target.closest('#partyTop,#partyCtl,#partyDrop,#partyBusy,#partyTap,button,input')) return;
  if (box.classList.contains('idle') || box.classList.contains('prep')) return;
  const now = Date.now();
  if (now - lt < 300 && Math.abs(e.clientX - lx) < 70) {
    lt = 0;
    const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    const side = x < .33 ? 'l' : x > .67 ? 'r' : 'c';
    $(side === 'l' ? 'partyBack' : side === 'r' ? 'partyFwd' : 'partyPlay').click();
    const f = document.createElement('div'); f.className = 'pflash ' + side;
    f.textContent = side === 'l' ? '⏪ 10s' : side === 'r' ? '10s ⏩' : '⏯';
    stage.appendChild(f); setTimeout(() => f.remove(), 650);
  } else { lt = now; lx = e.clientX; }
});
document.addEventListener('keydown', e => {
  if (box.classList.contains('hidden') || box.classList.contains('idle') || box.classList.contains('prep')) return;
  if (/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); $('partyPlay').click(); }
  else if (k === 'arrowleft') $('partyBack').click();
  else if (k === 'arrowright') $('partyFwd').click();
  else if (k === 'f') $('partyFs').click();
  else if (k === 'm') $('partyMute').click();
});

// keep the screen awake while watching (a sleeping phone drops the connection)
let wl = null;
const wantWake = () => !box.classList.contains('hidden') && (isHost() || isViewer());
async function wakeSync() {
  try {
    if (wantWake() && !wl && navigator.wakeLock) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); }
    else if (!wantWake() && wl) { wl.release(); wl = null; }
  } catch (e) {}
}
new MutationObserver(wakeSync).observe(box, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeSync(); });
// ---------- after opening a chat, hold the view on the LAST message until you scroll yourself ----------
const mbox = $('messages');
let settleId = 0;
const _oc2 = openChat;
openChat = function (u, j) {
  const p = _oc2(u, j);
  if (!j) {
    const id = ++settleId, end = Date.now() + 3500;
    let moved = false;
    const stop = () => { moved = true; };
    ['touchstart', 'wheel', 'mousedown'].forEach(n => mbox.addEventListener(n, stop, { once: true, passive: true, capture: true }));
    const t = setInterval(() => {
      if (moved || id !== settleId || Date.now() > end || current !== u) return clearInterval(t);
      if (mbox.scrollHeight - mbox.scrollTop - mbox.clientHeight > 4) { stickBottom = true; scrollDown(); }
    }, 120);
  }
  return p;
};
})();
