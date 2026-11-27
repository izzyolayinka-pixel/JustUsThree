const CACHE = 'j3-v8';
const SHELL = ['./', 'index.html', 'style.css', 'party.css', 'config.js', 'app.js', 'messages.js', 'groups.js', 'calls.js', 'party.js', 'extras.js', 'polish.css', 'polish.js', 'pro.css', 'pro.js', 'fix.css', 'fix.js', 'native.js',
  'manifest.json', 'just3.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // jsDelivr serves supabase-js AND the ffmpeg.wasm files used by Watch Party (cached after the first download)
  const isCdn = u.hostname === 'cdn.jsdelivr.net';
  if (u.origin !== location.origin && !isCdn) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (isCdn) {
      const hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok || res.type === 'opaque') c.put(r, res.clone()).catch(() => {});   // never fail playback if storage is full
      return res;
    }
    try {
      const res = await fetch(r);
      if (res.ok) c.put(r, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      return (await c.match(r)) || Response.error();
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(l => (l.length ? l[0].focus() : clients.openWindow('./'))));
});
