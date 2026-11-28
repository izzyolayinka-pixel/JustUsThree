'use strict';
// ===== Just Us Three · native glue (does NOTHING in a normal browser; runs only inside the Capacitor app) =====
(() => {
const C = window.Capacitor;
if (!C || !(C.isNativePlatform && C.isNativePlatform())) return;
const P = C.Plugins || {}, PN = P.PushNotifications, AppP = P.App, SB = P.StatusBar;
document.documentElement.classList.add('native');
const D = { plugins: Object.keys(P).join(', ') || 'none', perm: '?', push: 'waiting for login', token: 'none yet', saved: '-', mic: '-', errors: [] };
const err = (w, e) => D.errors.push(w + ': ' + ((e && (e.message || e.name)) || JSON.stringify(e)));
const haveMe = () => typeof me !== 'undefined' && me;

// status bar colour
(async () => { try { if (SB) { await SB.setBackgroundColor({ color: '#202c33' }); await SB.setStyle({ style: 'DARK' }); } } catch (e) {} })();

// Android back button: close the top-most thing, then leave the chat, then minimise
if (AppP) {
  AppP.addListener('backButton', () => {
    const q = s => document.querySelector(s), vis = s => { const e = q(s); return e && !e.classList.contains('hidden'); };
    const ps = q('.psheet'); if (ps) return ps.remove();
    if (vis('#lockScreen')) return;
    if (vis('#lightbox')) return q('#lightbox').classList.add('hidden');
    if (vis('#statusView')) return $('svClose').click();
    if (vis('#sheet')) return closeSheet();
    const ov = [...document.querySelectorAll('.overlay.dim:not(.hidden)')].pop();
    if (ov) return ov.classList.add('hidden');
    if (vis('#callUI')) return;
    if (typeof current !== 'undefined' && current) return closeChat();
    AppP.minimizeApp();
  });
  AppP.addListener('appStateChange', s => { if (s.isActive && PN) PN.removeAllDeliveredNotifications().catch(() => {}); });
}

// native share sheet (needs: npm install @capacitor/share). Does nothing if the plugin is not installed.
if (P.Share) navigator.share = o => P.Share.share({ title: o.title, text: o.text, url: o.url, dialogTitle: 'Share' });

// ---------- microphone / camera: ask once at the start, and report the real error if a call fails ----------
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = c => g(c).then(s => { D.mic = 'ok'; return s; },
    e => { D.mic = e.name + ': ' + e.message; toast('Mic/camera problem: ' + e.name); throw e; });
}
async function askMedia() {
  if (ls.get('j3_permasked', false)) return;
  ls.set('j3_permasked', true);
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach(t => t.stop()); }
  catch (e) { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch (e2) {} }
}

// ---------- push notifications ----------
function showDiag() {
  alert(['NOTIFICATION STATUS', 'Permission: ' + D.perm, 'Status: ' + D.push,
    'Phone token: ' + (D.token === 'none yet' ? 'none yet' : D.token.slice(0, 14) + '...'), 'Saved on server: ' + D.saved,
    'Mic/camera: ' + D.mic, 'Plugins found: ' + D.plugins,
    ...(D.errors.length ? ['', 'PROBLEMS:', ...D.errors.slice(-4)] : [])].join('\n'));
}
async function setupPush() {
  if (!PN) { D.push = 'Push plugin NOT found in the app'; return; }
  try {
    let perm = await PN.checkPermissions(); D.perm = perm.receive;
    if (perm.receive !== 'granted') { perm = await PN.requestPermissions(); D.perm = perm.receive; }
    if (perm.receive !== 'granted') { D.push = 'Permission is ' + perm.receive; return; }
  } catch (e) { err('permission', e); }
  try {
    for (const [id, name] of [['messages', 'Direct messages'], ['groups', 'Group chats'], ['media', 'Media']]) {
      await PN.createChannel({ id, name, description: name, importance: 5, visibility: 1, sound: 'default', vibration: true, lights: true });
    }
  } catch (e) { err('channels', e); }
  try { await PN.register(); D.push = 'registered with Firebase, waiting for token'; } catch (e) { err('register', e); D.push = 'register failed'; }
}
if (PN) {
  const openByKey = (key, tries = 0) => {
    const c = typeof chatByKey === 'function' && chatByKey(key);
    if (c) return openChat(c);
    if (tries < 20) setTimeout(() => openByKey(key, tries + 1), 500);
  };
  PN.addListener('registration', async t => {
    D.token = t.value; D.push = 'token received';
    try { const { error } = await db.rpc('register_push_token', { t: t.value, p: 'android' }); D.saved = error ? 'ERROR: ' + error.message : 'yes'; }
    catch (e) { D.saved = 'ERROR'; err('save token', e); }
  });
  PN.addListener('registrationError', e => { D.push = 'Firebase refused'; err('Firebase', e); });
  PN.addListener('pushNotificationReceived', n => {
    const key = n.data && n.data.chat;
    if (typeof current !== 'undefined' && current && String(current.id) === String(key)) return;
    toast((n.title || '') + ': ' + (n.body || ''));
  });
  PN.addListener('pushNotificationActionPerformed', a => {
    const key = a.notification && a.notification.data && a.notification.data.chat;
    if (key) openByKey(key);
  });
}
const t0 = setInterval(() => { if (haveMe()) { clearInterval(t0); askMedia().finally(setupPush); } }, 500);

// buttons in your profile
const holder = document.createElement('div');
holder.innerHTML = '<div class="lab">Notifications</div><div class="wallrow"><button type="button" class="secondary" id="pushFix">Fix notifications</button><button type="button" class="secondary" id="pushDiag">Check status</button></div>';
const anchor = ($('lockToggle') && $('lockToggle').closest('label')) || $('fsRange');
if (anchor) anchor.after(holder);
$('pushFix').onclick = async () => { await setupPush(); setTimeout(showDiag, 1500); };
$('pushDiag').onclick = showDiag;
})();
