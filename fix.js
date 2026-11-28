'use strict';
// ===== Just Us Three · fix layer (loads AFTER pro.js; adds only) =====
(() => {
// ---------- faster first connection to the server ----------
try { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = CFG.url; l.crossOrigin = ''; document.head.appendChild(l); } catch (e) {}
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

// ---------- pins, mutes and archive are saved to your account (they survive cleared storage) ----------
const KEYS = ['j3_pinchats', 'j3_archived', 'j3_muted', 'j3_forced'], TS = 'j3_prefs_ts';
const rawSet = ls.set.bind(ls);
let applying = false, pushT = null, lastPull = 0;
ls.set = (k, v) => {
  const ok = rawSet(k, v);
  if (!applying && KEYS.includes(k)) { rawSet(TS, Date.now()); clearTimeout(pushT); pushT = setTimeout(pushPrefs, 1500); }
  return ok;
};
async function pushPrefs() {
  if (typeof me === 'undefined' || !me || !navigator.onLine) return;
  let ts = ls.get(TS, 0); if (!ts) { ts = Date.now(); rawSet(TS, ts); }
  const p = { ts }; KEYS.forEach(k => { p[k] = ls.get(k, []); });
  try { await db.auth.updateUser({ data: { j3_prefs: p } }); } catch (e) {}
}
async function pullPrefs() {
  lastPull = Date.now();
  try {
    const { data } = await db.auth.getUser();
    const r = data && data.user && data.user.user_metadata && data.user.user_metadata.j3_prefs;
    const lts = ls.get(TS, 0), localEmpty = KEYS.every(k => !(ls.get(k, []) || []).length);
    if (r && ((r.ts || 0) > lts || localEmpty)) {
      applying = true;
      KEYS.forEach(k => { if (Array.isArray(r[k])) rawSet(k, r[k]); });
      rawSet(TS, r.ts || 0); applying = false;
      renderChats();
    } else if (!r || (r.ts || 0) < lts) pushPrefs();
  } catch (e) { applying = false; }
}
const bootT = setInterval(() => { if (typeof me !== 'undefined' && me) { clearInterval(bootT); pullPrefs(); } }, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden && me && Date.now() - lastPull > 30000) pullPrefs(); });

// ---------- keep the connection warm so sending is quick ----------
let lastWarm = 0;
const warm = () => {
  if (typeof me === 'undefined' || !me || document.hidden || Date.now() - lastWarm < 20000) return;
  lastWarm = Date.now();
  db.from('profiles').select('id').eq('id', me.id).limit(1).then(() => {}, () => {});
};
document.addEventListener('visibilitychange', warm);
window.addEventListener('online', warm);
$('msgInput').addEventListener('focus', warm);
setInterval(warm, 240000);

// ---------- scrolling: stay at the bottom when the keyboard opens or images finish loading ----------
const mb = $('messages');
let wasNear = true;
mb.addEventListener('scroll', () => { wasNear = nearBottom(); }, { passive: true });
const keep = () => { if (wasNear) scrollDown(); };
if (window.visualViewport) visualViewport.addEventListener('resize', () => { keep(); requestAnimationFrame(keep); });
$('msgInput').addEventListener('focus', () => setTimeout(keep, 300));
mb.addEventListener('load', e => { if (e.target.tagName === 'IMG') keep(); }, true);
mb.addEventListener('loadedmetadata', keep, true);
})();
