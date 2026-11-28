'use strict';
// ===== Just Us Three · plus layer (loads AFTER fix.js; adds only) =====
(() => {
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const msgBox = $('messages');

// ---------- you can pin up to 3 chats ----------
const _lsSet = ls.set;
ls.set = (k, v) => {
  if (k === 'j3_pinchats' && Array.isArray(v)) {
    const cur = ls.get('j3_pinchats', []);
    if (v.length > 3 && v.length > cur.length) { toast('You can pin up to 3 chats'); v = cur; }
  }
  return _lsSet(k, v);
};

// ---------- smooth scroll when you tap the down arrow ----------
$('toBottom').addEventListener('click', e => {
  e.stopImmediatePropagation();
  msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });
}, true);

// ---------- "typing…" / "recording…" shown in colour ----------
const _setSub = setSub;
setSub = function () { _setSub(); const s = $('chatSub'); s.classList.toggle('live', /typing|recording/.test(s.textContent)); };

// ---------- long messages fold with "Read more" ----------
new MutationObserver(list => list.forEach(r => r.addedNodes.forEach(n => {
  if (!n.classList || !n.classList.contains('msg') || n.dataset.rm) return;
  const t = n.querySelector('.txt');
  if (!t || t.textContent.length < 650) return;
  n.dataset.rm = 1; t.classList.add('clamp');
  const b = el('button', 'rm', 'Read more'); b.type = 'button';
  b.onclick = e => { e.stopPropagation(); const c = t.classList.toggle('clamp'); b.textContent = c ? 'Read more' : 'Show less'; };
  t.after(b);
}))).observe(msgBox, { childList: true });

// ---------- chat wallpapers ----------
const WALLS = [['Default', ''], ['Midnight', 'linear-gradient(160deg,#0b141a,#12303a)'], ['Jollof', 'linear-gradient(160deg,#3b1d0f,#8a3510)'],
  ['Forest', 'linear-gradient(160deg,#0c1f16,#1d4a33)'], ['Ocean', 'linear-gradient(160deg,#08202e,#14507a)'], ['Plum', 'linear-gradient(160deg,#1f0d28,#4b1d5c)'],
  ['Slate', '#1c2127'], ['Sand', 'linear-gradient(160deg,#d9cbb0,#efe4cf)']];
const applyWall = i => {
  const w = WALLS[i] || WALLS[0];
  document.documentElement.classList.toggle('hasWall', !!w[1]);
  document.documentElement.style.setProperty('--wall', w[1] || 'none');
};
applyWall(ls.get('j3_wall', 0));
const wl = el('div', 'lab', 'Chat wallpaper'), wr = el('div', 'wallrow');
WALLS.forEach((w, i) => {
  const b = el('button', 'wsw' + (ls.get('j3_wall', 0) === i ? ' on' : '')); b.type = 'button'; b.title = w[0];
  if (w[1]) b.style.background = w[1];
  b.onclick = () => { ls.set('j3_wall', i); applyWall(i); wr.querySelectorAll('.wsw').forEach((x, j) => x.classList.toggle('on', j === i)); };
  wr.appendChild(b);
});

// ---------- app lock (PIN) ----------
const lockEl = el('div', 'hidden'); lockEl.id = 'lockScreen';
lockEl.innerHTML = '<div class="lk-title" id="lkTitle"></div><div class="lk-dots" id="lkDots"><i></i><i></i><i></i><i></i></div><div class="lk-msg" id="lkMsg"></div><div class="lk-pad">'
  + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(k => k === '' ? '<span></span>' : `<button type="button" data-k="${k}">${k}</button>`).join('')
  + '</div><button type="button" class="lk-link hidden" id="lkForgot">Forgot PIN? Log out</button><button type="button" class="lk-link hidden" id="lkCancel">Cancel</button>';
document.body.appendChild(lockEl);
let digits = '', resolver = null, locked = false, hiddenAt = 0;
const paintDots = () => lockEl.querySelectorAll('#lkDots i').forEach((d, i) => d.classList.toggle('on', i < digits.length));
lockEl.querySelector('.lk-pad').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !resolver) return;
  const k = b.dataset.k;
  if (k === '⌫') digits = digits.slice(0, -1); else if (digits.length < 4) digits += k;
  paintDots();
  if (digits.length === 4) { const d = digits, r = resolver; digits = ''; resolver = null; setTimeout(() => { paintDots(); r(d); }, 120); }
});
function askPin(title, o = {}) {
  return new Promise(res => {
    digits = ''; paintDots();
    $('lkTitle').textContent = title; $('lkMsg').textContent = o.msg || '';
    $('lkCancel').classList.toggle('hidden', !o.cancel); $('lkForgot').classList.toggle('hidden', !o.forgot);
    lockEl.classList.remove('hidden'); resolver = res;
    $('lkCancel').onclick = () => { resolver = null; lockEl.classList.add('hidden'); res(null); };
  });
}
async function hash(p) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('j3lock:' + p)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return 'x' + p.split('').reverse().join('') + 'j3'; }
}
async function lockNow() {
  if (locked || !ls.get('j3_lock', null)) return;
  locked = true;
  let msg = '';
  for (;;) {
    const p = await askPin('Enter your PIN', { forgot: true, msg });
    if (p && await hash(p) === ls.get('j3_lock', null)) break;
    msg = 'Wrong PIN. Try again.';
  }
  lockEl.classList.add('hidden'); locked = false;
}
$('lkForgot').onclick = async () => {
  if (!confirm('Log out and remove the PIN? Your chats stay safe on your account.')) return;
  ls.set('j3_lock', null);
  try { await db.auth.signOut(); } catch (e) {}
  location.reload();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (ls.get('j3_lock', null) && Date.now() - hiddenAt > 15000) lockNow();
});
if (ls.get('j3_lock', null)) lockNow();
const lr = document.createElement('label'); lr.className = 'row';
lr.innerHTML = '<span>App lock (PIN)</span><input type="checkbox" id="lockToggle">';
$('fsRange').after(wl, wr, lr);
$('lockToggle').checked = !!ls.get('j3_lock', null);
$('lockToggle').onchange = async e => {
  const t = e.target;
  if (t.checked) {
    const a = await askPin('Choose a 4-digit PIN', { cancel: true });
    if (a == null) { t.checked = false; return; }
    const b = await askPin('Type it again to confirm', { cancel: true });
    lockEl.classList.add('hidden');
    if (b !== a) { if (b != null) toast('PINs did not match'); t.checked = false; return; }
    ls.set('j3_lock', await hash(a)); toast('App lock is on');
  } else {
    const p = await askPin('Enter your PIN to turn off', { cancel: true });
    lockEl.classList.add('hidden');
    if (p && await hash(p) === ls.get('j3_lock', null)) { ls.set('j3_lock', null); toast('App lock is off'); }
    else { t.checked = true; if (p) toast('Wrong PIN'); }
  }
};
})();
