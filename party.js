'use strict';
// ===== Just Us Three · Watch Party =====
// One person (the host) picks a movie file from their own phone/computer. The file is
// NEVER uploaded: the host's <video> plays it locally, video.captureStream() grabs the
// live picture + sound, and that stream is sent peer-to-peer (WebRTC) to everyone else
// in the chat. Signalling (invites, offers, answers, ICE) travels over presenceCh, the
// same Supabase Realtime channel the 1-to-1 calls and typing indicators already use,
// under its own event name: 'party'. Play / pause / seek / subtitles travel over a
// WebRTC data channel, so they cost nothing on Supabase.
//
// Playback engine (host only), tried in this order:
//   1. native    : URL.createObjectURL(file) straight into <video>. Instant.
//   2. sidecar   : picture plays natively but the sound can't be decoded (AC3/DTS/...).
//                  ffmpeg.wasm turns ONLY the audio into AAC; a hidden <audio> plays it
//                  in lock-step with the video and both are captured together.
//   3. remux     : the browser can't open the container/picture at all (AVI, FLV, WMV,
//                  odd codecs). ffmpeg.wasm repacks to MP4 (video copied, audio -> AAC),
//                  and only if that still won't play, re-encodes the picture to H.264.
// Everything lives inside one function so it can't clash with names in your other files.
// It uses these globals from your other files: $ me friends members current blocked online
// presenceCh chatByKey openChat toast nameOf deliver replyTo beep notify ICE.

(function () {

// ---------- settings you may want to change ----------
const FF_VER = '0.12.10';                 // @ffmpeg/ffmpeg (JS side)
const CORE_VER = '0.12.6';                // @ffmpeg/core   (single-threaded wasm, no special headers needed)
const FF_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FF_VER}/dist/umd`;
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VER}/dist/umd`;
const TRANSCODE_H = 480;                  // last-resort picture re-encode height (small = faster)
const STREAM_LAG = 0.25;                  // seconds the picture trails the data channel (subtitle timing)
const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|flv|wmv|ts|m2ts|mts|mpg|mpeg|3gp|ogv|divx|vob|asf|rmvb)$/i;
const SAFE_COPY = ['h264', 'vp8', 'vp9', 'av1'];   // picture codecs browsers play inside MP4/WebM

// ---------- state ----------
// party = { key, chat, role: 'idle'|'prep'|'host'|'viewer', pid, hostId, hostName, title, mode, file,
//           peers:{uid:{pc,dc,pending,name}}, stream, job, pc, dc, sync, dur, cues, vtt, subsOn, ... }
let party = null;
let blobUrls = [];            // every blob: URL we create, revoked on cleanup
let ffInst = null, ffLogHook = null, ffUrls = [];
let outQ = [], outT = null;   // gentle pacing for signalling messages
let seekDrag = false, quietT = null, tickN = 0, inviteInfo = null, dragDepth = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);
const extOf = n => ((n || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const nameNoExt = n => (n || 'Movie').replace(/\.[a-z0-9]+$/i, '');
const trackUrl = u => { blobUrls.push(u); return u; };
const canCapture = () => !!(HTMLMediaElement.prototype.captureStream || HTMLMediaElement.prototype.mozCaptureStream);
function fmtT(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
// STUN alone fails on many phone networks (carrier NAT). A TURN relay fixes that. Add ONE of these to config.js:
//   turnApi: 'https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOURKEY'   (free key from metered.ca/tools/openrelay)
//   turn:    [{ urls: 'turn:host:443', username: '..', credential: '..' }]
let iceCache = null;
async function getIce() {
  if (iceCache && Date.now() - iceCache.at < 10 * 60000) return iceCache;
  const base = (typeof ICE !== 'undefined' && ICE.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }];
  const C = window.J3_CONFIG || {};
  let extra = Array.isArray(C.turn) ? C.turn.slice() : [];
  if (C.turnApi) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      const j = await (await fetch(C.turnApi, { signal: ctl.signal })).json();
      clearTimeout(t);
      if (Array.isArray(j)) extra = extra.concat(j);
    } catch (e) { console.warn('[party] could not fetch TURN credentials', e); }
  }
  iceCache = { cfg: { iceServers: [...base, ...extra], iceCandidatePoolSize: 2 }, turn: extra.length > 0, at: Date.now() };
  return iceCache;
}

// ---------- signalling over presenceCh (event name: 'party') ----------
// to = a user id (one person) or 'g:<groupId>' (everyone in that group). Paced so a burst of
// ICE candidates can't trip Supabase's per-second broadcast limit.
function psig(to, payload, now) {
  if (!presenceCh || !me) return;
  const msg = { ...payload, from: me.id, to, pid: payload.pid || (party && party.pid) || null };
  const send = () => presenceCh.send({ type: 'broadcast', event: 'party', payload: msg });
  if (now) return send();
  outQ.push(send);
  if (!outT) outT = setInterval(() => { const f = outQ.shift(); if (f) f(); else { clearInterval(outT); outT = null; } }, 60);
}
const inChat = uid => party && (party.chat.isGroup ? (members[party.chat.gid] || []).some(r => r.user_id === uid) : party.chat.id === uid);

// every signal that reaches us lands here (wired up in extras.js → startRealtime)
function partySignal(p) {
  if (!me || !p || p.from === me.id) return;
  const group = typeof p.to === 'string' && p.to.startsWith('g:');
  let key = null;
  if (group) {
    const g = chatByKey(p.to);
    if (g && (members[g.gid] || []).some(r => r.user_id === p.from)) key = p.to;
  } else if (p.to === me.id) {
    const f = friends.find(x => x.id === p.from);
    if (f && !blocked.has(f.id)) key = p.from;
  }
  if (!key) return;
  switch (p.type) {
    case 'invite': return onInvite(p, key);
    case 'who':
      if (party && party.key === key) { if (party.role === 'host') sendInvite(); else if (party.opener) psig(party.chat.id, { type: 'open', name: me.username }); }
      return;
    case 'open': return onOpen(p, key);
    case 'lobbyend': if (party && party.role === 'idle' && party.lobbyBy === p.from) partyClose(); return;
    case 'end': return onEnd(p);
  }
  // everything below is one-to-one and must belong to the party we are in
  if (!party || party.pid !== p.pid) return;
  if (p.type === 'join') hostAddPeer(p.from, p.name);
  else if (p.type === 'answer') hostAnswer(p);
  else if (p.type === 'bye') { hostDropPeer(p.from); uiWho(); }
  else if (p.type === 'offer') viewerOffer(p);
  else if (p.type === 'ice') addIce(p);
}

// ---------- small UI helpers ----------
function showBox(on) { $('partyBox').classList.toggle('hidden', !on); }
function setRole(role) {
  party.role = role;
  const b = $('partyBox');
  ['idle', 'prep', 'host', 'viewer'].forEach(r => b.classList.toggle(r, r === role));
  b.classList.remove('quiet');
  uiTitle(); uiWho();
  $('partyChangeBtn').classList.toggle('hidden', role === 'prep');
}
function uiTitle() {
  $('partyTitle').textContent = party && party.title ? '🎬 ' + party.title : '🎬 Watch Party';
}
function uiWho() {
  if (!party) return;
  let s = '';
  if (party.role === 'host') {
    const n = Object.values(party.peers).filter(p => p.connected).length;
    s = n ? 'You are hosting · ' + n + ' watching' : 'You are hosting · waiting for friends to join…';
  } else if (party.role === 'viewer') s = 'Hosted by ' + (party.hostName || 'a friend');
  else if (party.role === 'idle') s = party.lobbyBy ? (party.lobbyName || 'A friend') + ' opened this · waiting for a movie (or drop one yourself)' : 'Waiting for a movie…';
  $('partyWho').textContent = s;
}
function busy(text, frac) {
  $('partyBusy').classList.remove('hidden');
  $('partyBusyText').textContent = text;
  const w = $('partyBarWrap');
  if (frac == null) w.classList.add('indet');
  else { w.classList.remove('indet'); $('partyBarFill').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; }
}
const unbusy = () => $('partyBusy').classList.add('hidden');
function wake() {                     // show controls, hide them again after 3 s while playing
  const b = $('partyBox');
  b.classList.remove('quiet');
  clearTimeout(quietT);
  quietT = setTimeout(() => {
    if (party && (party.role === 'host' || party.role === 'viewer') && isPlaying()) b.classList.add('quiet');
  }, 3000);
}
function isPlaying() {
  if (!party) return false;
  const v = $('partyVid');
  return party.role === 'host' ? (!v.paused && !v.ended) : !!(party.sync && party.sync.playing);
}

// ---------- subtitles: .srt / .vtt -> WebVTT -> cues ----------
function srtToVtt(srt) {
  const txt = srt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const body = txt.replace(/(\d{1,2}):(\d{2}):(\d{2}),(\d{1,3})/g, (_, h, m, s, ms) => h.padStart(2, '0') + ':' + m + ':' + s + '.' + ms.padEnd(3, '0'));
  return 'WEBVTT\n\n' + body + '\n';
}
function parseVtt(vtt) {
  const ts = s => {
    const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : NaN;
  };
  const cues = [];
  vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/).forEach(block => {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) return;
    const [a, rest] = lines[i].split('-->');
    const s = ts(a), e = ts(rest.trim().split(/\s+/)[0]);
    if (isNaN(s) || isNaN(e)) return;
    const t = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\an?\d\}/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    if (t) cues.push({ s, e, t });
  });
  return cues.sort((x, y) => x.s - y.s);
}
async function readText(file) {             // UTF-8 first, then Windows-1252 (very common for old .srt files)
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}
async function loadSubs(file) {
  if (!party) return;
  try {
    const text = await readText(file);
    const vtt = /^\uFEFF?WEBVTT/.test(text) ? text : srtToVtt(text);
    const cues = parseVtt(vtt);
    if (!cues.length) return toast('No subtitles found in that file');
    party.cues = cues; party.vtt = vtt; party.subsOn = true;
    $('partyCC').classList.remove('off');
    if (party.role === 'host') sendSubs();           // viewers get them too
    toast('Subtitles loaded (' + cues.length + ' lines)');
  } catch (e) { alert('Could not read that subtitle file.'); }
}
function renderSub(t) {
  const box = $('partySub');
  let txt = '';
  if (party && party.subsOn && party.cues && party.cues.length) {
    const c = party.cues;
    let lo = 0, hi = c.length - 1, idx = -1;          // last cue that starts at or before t
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    for (let k = idx; k >= 0 && k > idx - 4; k--) if (c[k].e > t) { txt = c[k].t; break; }
  }
  if (box.dataset.t === txt) return;
  box.dataset.t = txt;
  box.textContent = '';
  if (txt) { const s = document.createElement('span'); s.textContent = txt; box.appendChild(s); }
}
function sendSubs(peer) {
  if (!party || !party.vtt) return hostSend({ k: 'nosubs' }, peer);
  const id = rid(), size = 12000, n = Math.ceil(party.vtt.length / size);
  for (let i = 0; i < n; i++) hostSend({ k: 'subs', id, i, n, d: party.vtt.slice(i * size, (i + 1) * size) }, peer);
}

// ---------- ffmpeg.wasm (single-threaded core, loaded from the CDN only when needed) ----------
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.FFmpegWASM) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not download the converter. Check your internet.'));
    document.head.appendChild(s);
  });
}
// Browsers refuse to start a Worker from another website's URL, so we download the files
// and hand ffmpeg local blob: copies instead. (The service worker caches them after the first time.)
async function blobUrl(url, type, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed (' + res.status + ')');
  const reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (label) busy(label + ' ' + (got / 1048576).toFixed(0) + ' MB', null);
  }
  const u = URL.createObjectURL(new Blob(parts, { type }));
  ffUrls.push(u);
  return u;
}
async function ffLoad() {
  if (ffInst) return ffInst;
  let lastErr = null;
  for (const host of ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com']) {
    try { return await ffLoadFrom(host); }
    catch (e) { lastErr = e; console.warn('[party] converter download failed from', host, e); ffStop(); }
  }
  throw new Error('Could not load the video converter (' + ((lastErr && lastErr.message) || 'network problem') + '). Check your internet and try again.');
}
async function ffLoadFrom(host) {
  const ffBase = host + '/@ffmpeg/ffmpeg@' + FF_VER + '/dist/umd';
  const coreBase = host + '/@ffmpeg/core@' + CORE_VER + '/dist/umd';
  busy('Downloading the video converter (one-time, about 30 MB)…', null);
  await loadScript(ffBase + '/ffmpeg.js');
  let chunk = '814.ffmpeg.js';
  try { const m = (await (await fetch(ffBase + '/ffmpeg.js')).text()).match(/(\d+\.ffmpeg\.js)/); if (m) chunk = m[1]; } catch (e) {}
  const coreURL = await blobUrl(coreBase + '/ffmpeg-core.js', 'text/javascript');
  const wasmURL = await blobUrl(coreBase + '/ffmpeg-core.wasm', 'application/wasm', 'Downloading the video converter…');
  const classWorkerURL = await blobUrl(ffBase + '/' + chunk, 'text/javascript');
  const ff = new window.FFmpegWASM.FFmpeg();
  ff.on('log', e => { if (ffLogHook) ffLogHook(e.message); });
  busy('Starting the converter…', null);
  await ff.load({ coreURL, wasmURL, classWorkerURL });
  ffInst = ff;
  return ff;
}
function ffStop() {                                   // kills the worker and frees its memory
  if (ffInst) { try { ffInst.terminate(); } catch (e) {} ffInst = null; }
  ffLogHook = null;
  ffUrls.forEach(u => URL.revokeObjectURL(u));
  ffUrls = [];
}
// Mount the picked file read-only (WORKERFS) so even a 3 GB movie is read lazily, not copied into memory.
async function ffMount(ff, file) {
  const ext = extOf(file.name) || 'bin';
  const wrapped = new File([file], 'input.' + ext);   // plain ASCII name, no copy
  try {
    await ff.createDir('/in');
    await ff.mount('WORKERFS', { files: [wrapped] }, '/in');
    return { path: '/in/input.' + ext, done: async () => { try { await ff.unmount('/in'); await ff.deleteDir('/in'); } catch (e) {} } };
  } catch (e) {
    if (file.size > 900 * 1048576) throw new Error('This file is too large to convert in the browser.');
    await ff.writeFile('/input.' + ext, new Uint8Array(await file.arrayBuffer()));
    return { path: '/input.' + ext, done: async () => { try { await ff.deleteFile('/input.' + ext); } catch (e) {} } };
  }
}
// ask ffmpeg what is inside the file: duration, picture codec(s), audio codec(s)
async function ffProbe(ff, path) {
  const info = { dur: 0, v: [], a: [] };
  let finished = false;
  ffLogHook = line => {
    if (finished) return;
    if (/^Output #0/.test(line)) { finished = true; return; }
    let m;
    if ((m = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/))) info.dur = +m[1] * 3600 + +m[2] * 60 + +m[3];
    if ((m = line.match(/Stream #\d+:\d+.*?: Video: (\w+)/)) && !/attached pic/.test(line)) info.v.push(m[1].toLowerCase());
    if ((m = line.match(/Stream #\d+:\d+.*?: Audio: (\w+)/))) info.a.push(m[1].toLowerCase());
  };
  try { await ff.exec(['-i', path, '-t', '0.01', '-f', 'null', '-']); } finally { ffLogHook = null; }
  return info;
}
async function ffRun(ff, args, dur, label) {
  const onP = ({ progress, time }) => {
    const f = dur && time > 0 ? time / 1e6 / dur : progress;
    busy(label + ' ' + Math.round(Math.max(0, Math.min(1, f)) * 100) + '%', f);
  };
  busy(label, null);
  ff.on('progress', onP);
  try { const code = await ff.exec(args); if (code !== 0) throw new Error('The converter could not read this file.'); }
  finally { ff.off('progress', onP); }
}

// ---------- loading media into the elements ----------
function loadInto(el, url, ms) {
  return new Promise(res => {
    let done = false;
    const fin = ok => {
      if (done) return; done = true; clearTimeout(t);
      el.removeEventListener('loadeddata', good); el.removeEventListener('error', bad);
      res(ok);
    };
    const good = () => fin(true), bad = () => fin(false);
    const t = setTimeout(() => fin(false), ms || 15000);
    el.addEventListener('loadeddata', good); el.addEventListener('error', bad);
    el.srcObject = null; el.src = url; el.load();
  });
}
function hasDecodedAudio(v) {                       // does the browser actually decode this file's sound?
  if (typeof v.webkitAudioDecodedByteCount === 'number') return v.webkitAudioDecodedByteCount > 0;
  if (typeof v.mozHasAudio === 'boolean') return v.mozHasAudio;
  if (v.audioTracks && typeof v.audioTracks.length === 'number') return v.audioTracks.length > 0;
  return true;                                      // cannot tell, so trust it
}
async function audioWorks(v) {
  try { await v.play(); } catch (e) { return true; }
  await sleep(1600);
  const ok = hasDecodedAudio(v);
  v.pause(); v.currentTime = 0;
  return ok;
}
function clearMedia() {
  const v = $('partyVid'), a = $('partyAud');
  [v, a].forEach(el => { try { el.pause(); } catch (e) {} el.srcObject = null; el.removeAttribute('src'); el.load(); });
  v.muted = false;
  blobUrls.forEach(u => URL.revokeObjectURL(u));
  blobUrls = [];
  $('partySub').textContent = ''; $('partySub').dataset.t = '';
}
function stopStream() {
  if (party && party.stream) { party.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); party.stream = null; }
}

// Decide HOW to play this file. Returns 'native' | 'sidecar' | 'remux'
async function prepareMedia(file, job, force) {
  const v = $('partyVid');
  const ext = (extOf(file.name) || 'video').toUpperCase();
  clearMedia();
  if (!force) {
    busy('Opening ' + file.name + '…', null);
    const url = trackUrl(URL.createObjectURL(file));
    const ok = await loadInto(v, url);                 // fast path: ~0.1 s for normal files
    if (job.cancelled) return null;
    if (ok && v.videoWidth > 0) {
      busy('Checking the sound…', null);
      if (await audioWorks(v)) return 'native';
      if (job.cancelled) return null;
      return await buildSidecar(file, job, ext);
    }
  }
  return await buildRemux(file, job, ext);
}
// picture plays, sound doesn't -> make just the audio playable
async function buildSidecar(file, job, ext) {
  const ff = await ffLoad();
  const m = await ffMount(ff, file);
  const info = await ffProbe(ff, m.path);
  if (job.cancelled) return null;
  if (!info.a.length) { await m.done(); ffStop(); toast('This file has no audio track'); return 'native'; }
  await ffRun(ff, ['-i', m.path, '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '/audio.m4a'],
    info.dur, 'Preparing ' + ext + ' audio for streaming…');
  const data = await ff.readFile('/audio.m4a');
  await ff.deleteFile('/audio.m4a'); await m.done(); ffStop();
  if (job.cancelled) return null;
  const url = trackUrl(URL.createObjectURL(new Blob([data], { type: 'audio/mp4' })));
  if (!(await loadInto($('partyAud'), url))) throw new Error('Could not play the converted audio.');
  const v = $('partyVid');
  v.currentTime = 0;
  return 'sidecar';
}
// container or picture not supported -> repack to MP4 (copy picture), re-encode picture only if needed
async function buildRemux(file, job, ext) {
  const ff = await ffLoad();
  const m = await ffMount(ff, file);
  const info = await ffProbe(ff, m.path);
  if (job.cancelled) return null;
  if (!info.v.length) throw new Error('No video found in this file.');
  let copy = SAFE_COPY.includes(info.v[0]);
  const v = $('partyVid');
  for (;;) {
    const args = ['-i', m.path, '-map', '0:v:0', '-map', '0:a:0?', '-sn'];
    if (copy) args.push('-c:v', 'copy');
    else args.push('-vf', `scale=-2:'min(${TRANSCODE_H},ih)'`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p');
    args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '/out.mp4');
    await ffRun(ff, args, info.dur, copy ? 'Converting ' + ext + ' for streaming…' : 'Re-encoding the video (slow, long movies can take a while)…');
    const data = await ff.readFile('/out.mp4');
    await ff.deleteFile('/out.mp4');
    if (job.cancelled) return null;
    const url = trackUrl(URL.createObjectURL(new Blob([data], { type: 'video/mp4' })));
    busy('Almost ready…', null);
    if ((await loadInto(v, url)) && v.videoWidth > 0) break;
    if (!copy) throw new Error("This video format can't be converted in the browser.");
    copy = false;                                      // copy didn't play -> re-encode the picture
  }
  await m.done(); ffStop();
  return 'remux';
}

// ---------- host: capture the player and stream it ----------
function grab(el) { return el.captureStream ? el.captureStream() : el.mozCaptureStream ? el.mozCaptureStream() : null; }
function waitTrack(s, kind, ms) {
  const get = () => (kind === 'video' ? s.getVideoTracks() : s.getAudioTracks())[0];
  return new Promise(res => {
    if (get()) return res(get());
    const t = setTimeout(() => { s.removeEventListener('addtrack', on); res(null); }, ms || 2500);
    const on = () => { if (get()) { clearTimeout(t); s.removeEventListener('addtrack', on); res(get()); } };
    s.addEventListener('addtrack', on);
  });
}
async function buildStream(mode) {
  const v = $('partyVid'), a = $('partyAud');
  const vs = grab(v);
  if (!vs) throw new Error("This browser can't share a playing video. Host from Chrome, Edge or Firefox (friends can watch from any browser).");
  let vt = await waitTrack(vs, 'video', 1500);
  if (!vt) {                                           // some browsers only create tracks after the first play
    try { await v.play(); } catch (e) {}
    vt = await waitTrack(vs, 'video', 2000);
    v.pause(); v.currentTime = 0;
  }
  if (!vt) throw new Error('No picture could be captured from this file.');
  const out = new MediaStream([vt]);
  if (mode === 'sidecar') {
    const as = grab(a);
    const at = as && await waitTrack(as, 'audio', 1500);
    if (at) out.addTrack(at);
  } else {
    const at = await waitTrack(vs, 'audio', 800);
    if (at) out.addTrack(at);
  }
  return out;
}

async function partyLoadFile(file, opts) {
  opts = opts || {};
  if (!file || !party) return;
  if (!VIDEO_EXT.test(file.name) && !/^video\//.test(file.type)) return toast("That doesn't look like a video file");
  if (!canCapture()) return alert("This browser can only WATCH parties. To host, open the app in Chrome, Edge or Firefox.");
  if (party.role === 'viewer') {
    if (!confirm('Start your own movie? It replaces what is playing for everyone.')) return;
    viewerDetach(true);
  }
  if (party.role === 'host') hostStop('keep');
  cancelJob();
  const job = party.job = { cancelled: false };
  setRole('prep');
  try {
    const mode = await prepareMedia(file, job, opts.force);
    if (job.cancelled || !party) return;
    await hostGo(mode, file);
  } catch (e) {
    if (job.cancelled || !party) return;
    ffStop(); clearMedia(); unbusy(); setRole('idle');
    alert(e.message || 'Could not open that video.');
  }
}
function cancelJob() {
  if (party && party.job) { party.job.cancelled = true; party.job = null; }
}
async function hostGo(mode, file) {
  const v = $('partyVid');
  v.muted = mode === 'sidecar';                        // sidecar: the sound comes from the hidden <audio>
  v.pause(); v.currentTime = 0;
  party.stream = await buildStream(mode);
  party.mode = mode; party.file = file; party.title = nameNoExt(file.name);
  party.pid = rid(); party.peers = {}; party.sync = null;
  party.dur = v.duration || 0;
  setRole('host');
  unbusy();
  $('partyTap').classList.add('hidden');
  sendInvite();
  announce();
  wake();
  toast(mode === 'native' ? 'Ready. Press play when everyone has joined.' : 'Ready (compatibility mode). Press play when everyone has joined.');
}
function sendInvite() {
  if (!party || party.role !== 'host') return;
  psig(party.chat.id, { type: 'invite', title: party.title, name: me.username });
}
async function announce() {                            // one normal chat message, so people who are elsewhere get the usual notification
  if (!party || party.announced === party.title || !current || current.id !== party.key) return;
  party.announced = party.title;
  const keep = replyTo; replyTo = null;
  try { await deliver({ content: '🎬 Watch Party: ' + party.title + '\nOpen this chat to join while it plays.' }); } catch (e) {}
  replyTo = keep;
}
function hostStop(how) {                               // how: 'end' (everyone leaves), 'keep' (changing movie), 'silent'
  if (!party || party.role !== 'host') return;
  if (how !== 'silent') psig(party.chat.id, { type: 'end', keep: how === 'keep' }, true);
  Object.keys(party.peers).forEach(hostDropPeer);
  stopStream(); clearMedia();
  party.pid = null; party.mode = null; party.vtt = null; party.cues = [];
  setRole('idle');
}

// one RTCPeerConnection per viewer, all fed by the same captured tracks
async function hostAddPeer(uid, name) {
  if (!party || party.role !== 'host' || !party.stream || !inChat(uid)) return;
  hostDropPeer(uid);
  const ice = await getIce();
  if (!party || party.role !== 'host' || !party.stream) return;
  hostDropPeer(uid);
  const pc = new RTCPeerConnection(ice.cfg);
  const peer = { pc, dc: null, pending: [], name: name || nameOf(uid), connected: false };
  party.peers[uid] = peer;
  peer.dc = pc.createDataChannel('party');
  peer.dc.onopen = () => { hostSend({ k: 'meta', title: party.title, dur: $('partyVid').duration || 0 }, peer); sendSubs(peer); pushSync(peer); };
  party.stream.getTracks().forEach(t => {
    try { t.contentHint = t.kind === 'video' ? 'motion' : 'music'; } catch (e) {}
    pc.addTrack(t, party.stream);
  });
  pc.onicecandidate = e => { if (e.candidate) psig(uid, { type: 'ice', cand: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (!party || party.peers[uid] !== peer) return;
    const s = pc.connectionState;
    if (s === 'connected') {
      peer.connected = true;
      uiWho(); applyLimits();
      toast(peer.name + ' joined');
      const v = $('partyVid');
      if (v.paused) v.currentTime = Math.max(0, v.currentTime - 0.001);   // nudge so a paused picture reaches the newcomer
    }
    if (s === 'failed' || s === 'closed') {
      if (!peer.connected) toast(peer.name + " couldn't connect" + (ice.turn ? '.' : ' (their network needs a TURN relay, see setup)'));
      hostDropPeer(uid); uiWho();
    }
    if (s === 'disconnected') setTimeout(() => { if (party && party.peers[uid] === peer && pc.connectionState === 'disconnected') { hostDropPeer(uid); uiWho(); } }, 8000);
  };
  const offer = await pc.createOffer();
  offer.sdp = tuneOpus(offer.sdp);
  await pc.setLocalDescription(offer);
  psig(uid, { type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
}
async function hostAnswer(p) {
  const peer = party && party.peers[p.from];
  if (!peer) return;
  try { await peer.pc.setRemoteDescription(p.sdp); } catch (e) { return; }
  for (const c of peer.pending.splice(0)) { try { await peer.pc.addIceCandidate(c); } catch (e) {} }
}
function hostDropPeer(uid) {
  const peer = party && party.peers && party.peers[uid];
  if (!peer) return;
  delete party.peers[uid];
  try { peer.dc && peer.dc.close(); } catch (e) {}
  try { peer.pc.close(); } catch (e) {}
  applyLimits();
}
function applyLimits() {                               // share the host's upload fairly between viewers
  if (!party || party.role !== 'host') return;
  const peers = Object.values(party.peers);
  const n = Math.max(1, peers.length);
  const cap = n <= 1 ? 3.5e6 : n === 2 ? 2.5e6 : 1.6e6;
  const h = $('partyVid').videoHeight;
  const scale = h > 720 ? h / 720 : 1;
  peers.forEach(p => p.pc.getSenders().forEach(s => {
    if (!s.track || s.track.kind !== 'video') return;
    try {
      const prm = s.getParameters();
      if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
      prm.encodings[0].maxBitrate = cap;
      prm.encodings[0].scaleResolutionDownBy = scale;
      s.setParameters(prm).catch(() => {});
    } catch (e) {}
  }));
}
const tuneOpus = sdp => sdp.replace(/a=fmtp:\d+ [^\r\n]*useinbandfec=1/g,
  m => /stereo=1/.test(m) ? m : m + ';stereo=1;sprop-stereo=1;maxaveragebitrate=128000');   // proper stereo movie sound
function hostSend(obj, peer) {
  if (!party || !party.peers) return;
  const str = JSON.stringify(obj);
  (peer ? [peer] : Object.values(party.peers)).forEach(p => { if (p.dc && p.dc.readyState === 'open') { try { p.dc.send(str); } catch (e) {} } });
}
function pushSync(peer) {                              // tell viewers where the movie is (play / pause / seek / speed)
  if (!party || party.role !== 'host') return;
  const v = $('partyVid');
  hostSend({ k: 'sync', t: v.currentTime, playing: !v.paused && !v.ended, rate: v.playbackRate, dur: v.duration || 0 }, peer);
}

// ---------- viewer ----------
function onInvite(p, key) {
  const chat = chatByKey(key);
  if (!chat) return;
  if (party && party.key !== key) return;              // we are busy in another chat
  if (party && party.pid === p.pid) return;            // already in this one
  const open = current && current.id === key;
  if (party || open) {
    if (!party) openTheater(chat);
    if (party.role === 'host') hostStop('silent');     // somebody else just took over as host
    else if (party.role === 'viewer') viewerDetach(true);
    cancelJob(); ffStop();
    viewerJoin(p);
  } else {
    inviteInfo = { p, key };
    $('partyInviteText').textContent = '🎬 ' + (p.name || 'A friend') + ' started a Watch Party in ' + chat.username + ': ' + (p.title || 'a movie');
    $('partyInvite').classList.remove('hidden');
    beep(); notify('Watch Party', (p.name || 'A friend') + ' is watching ' + (p.title || 'a movie'));
  }
}
// someone tapped 🎬 and has not picked a movie yet: open the empty theater for everybody right away
function onOpen(p, key) {
  const chat = chatByKey(key);
  if (!chat) return;
  if (party) { if (party.key === key && party.role === 'idle' && !party.lobbyBy) { party.lobbyBy = p.from; party.lobbyName = p.name; uiWho(); } return; }
  if (current && current.id === key) {
    openTheater(chat);
    party.lobbyBy = p.from; party.lobbyName = p.name;
    uiWho();
    toast((p.name || 'A friend') + ' opened a Watch Party');
    beep();
  } else {
    inviteInfo = { p, key };
    $('partyInviteText').textContent = '🎬 ' + (p.name || 'A friend') + ' opened a Watch Party in ' + chat.username;
    $('partyInvite').classList.remove('hidden');
    beep(); notify('Watch Party', (p.name || 'A friend') + ' opened a Watch Party');
  }
}
function onEnd(p) {
  if (!party || party.role !== 'viewer' || party.pid !== p.pid) return;
  viewerDetach(false);
  if (p.keep) { setRole('idle'); busy((party.hostName || 'The host') + ' is picking another movie…', null); $('partyBarWrap').classList.add('indet'); party.waiting = true; }
  else { toast((party.hostName || 'The host') + ' ended the Watch Party'); partyClose(); }
}
function viewerJoin(p) {
  party.pid = p.pid; party.hostId = p.from; party.hostName = p.name || nameOf(p.from); party.title = p.title || 'Movie';
  party.tries = 0; party.connected = false; party.sync = null; party.dur = 0; party.cues = []; party.vtt = null; party.waiting = false;
  clearMedia();
  setRole('viewer');
  busy('Connecting to ' + party.hostName + '…', null);
  joinTry();
}
function joinTry() {
  if (!party || party.role !== 'viewer' || party.connected) return;
  if (party.tries++ >= 3) return busy("Couldn't connect to " + party.hostName + '. Are they still online?', 0);
  psig(party.hostId, { type: 'join', name: me.username });
  clearTimeout(party.joinT);
  party.joinT = setTimeout(joinTry, 10000);
}
async function viewerOffer(p) {
  if (!party || party.role !== 'viewer' || p.from !== party.hostId) return;
  closeViewerPC();
  const ice = await getIce();
  if (!party || party.role !== 'viewer') return;
  closeViewerPC();
  const pc = new RTCPeerConnection(ice.cfg);
  party.pc = pc; party.pendingIce = [];
  clearTimeout(party.slowT);
  party.slowT = setTimeout(() => {
    if (party && party.pc === pc && !party.connected) {
      busy(ice.turn ? 'Still connecting through the relay…' : "Can't connect directly from this network. A TURN relay is needed (see setup).", null);
    }
  }, 15000);
  pc.oniceconnectionstatechange = () => console.log('[party] ice', pc.iceConnectionState);
  pc.onicecandidate = e => { if (e.candidate) psig(party.hostId, { type: 'ice', cand: e.candidate }); };
  pc.ontrack = e => {
    const v = $('partyVid');
    if (v.srcObject !== e.streams[0]) v.srcObject = e.streams[0];
    tryPlay(v);
  };
  pc.ondatachannel = e => { party.dc = e.channel; e.channel.onmessage = ev => viewerMsg(ev.data); };
  pc.onconnectionstatechange = () => {
    if (!party || party.pc !== pc) return;
    const s = pc.connectionState;
    if (s === 'connected') { party.connected = true; party.reconnects = 0; clearTimeout(party.joinT); clearTimeout(party.slowT); unbusy(); wake(); }
    if (s === 'disconnected') setTimeout(() => { if (party && party.pc === pc && pc.connectionState === 'disconnected') pc.onconnectionstatechange = null, viewerRetry(ice); }, 6000);
    if (s === 'failed') viewerRetry(ice);
  };
  try {
    await pc.setRemoteDescription(p.sdp);
    for (const c of party.pendingIce.splice(0)) { try { await pc.addIceCandidate(c); } catch (e) {} }
    const ans = await pc.createAnswer();
    ans.sdp = tuneOpus(ans.sdp);
    await pc.setLocalDescription(ans);
    psig(party.hostId, { type: 'answer', sdp: { type: ans.type, sdp: ans.sdp } });
  } catch (e) { busy('Could not connect. Try joining again.', 0); }
}
function viewerRetry(ice) {
  if (!party || party.role !== 'viewer') return;
  party.connected = false;
  closeViewerPC();
  if ((party.reconnects = (party.reconnects || 0) + 1) > 3) {
    return busy(ice.turn ? "Couldn't connect to " + party.hostName + '. Check both internet connections.' : "Couldn't connect directly. Both phones need a TURN relay (see setup).", 0);
  }
  busy('Connection lost. Reconnecting…', null);
  party.tries = 0;
  joinTry();
}
function addIce(p) {                                   // candidates can arrive before the description, so queue them
  const pc = party.role === 'host' ? (party.peers[p.from] || {}).pc : party.pc;
  const q = party.role === 'host' ? (party.peers[p.from] || {}).pending : party.pendingIce;
  if (!pc || !q) return;
  if (pc.remoteDescription) pc.addIceCandidate(p.cand).catch(() => {});
  else q.push(p.cand);
}
function viewerMsg(raw) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (!party || party.role !== 'viewer') return;
  if (m.k === 'meta') { party.title = m.title || party.title; party.dur = m.dur || party.dur; uiTitle(); }
  else if (m.k === 'sync') { party.sync = { t: m.t, playing: !!m.playing, rate: m.rate || 1, at: performance.now() }; if (m.dur) party.dur = m.dur; wake(); }
  else if (m.k === 'nosubs') { party.cues = []; party.vtt = null; }
  else if (m.k === 'subs') {
    if (!party.subBuf || party.subBuf.id !== m.id) party.subBuf = { id: m.id, n: m.n, got: 0, parts: [] };
    const b = party.subBuf;
    if (!b.parts[m.i]) { b.parts[m.i] = m.d; b.got++; }
    if (b.got === b.n) { party.vtt = b.parts.join(''); party.cues = parseVtt(party.vtt); party.subBuf = null; party.subsOn = true; $('partyCC').classList.remove('off'); toast('Subtitles received'); }
  }
}
async function tryPlay(v) {                            // browsers may block sound until a tap: fall back to muted + "tap" button
  try { await v.play(); $('partyTap').classList.add('hidden'); }
  catch (e) {
    v.muted = true;
    try { await v.play(); } catch (e2) {}
    $('partyTap').textContent = '🔊 Tap for sound';
    $('partyTap').classList.remove('hidden');
  }
}
function closeViewerPC() {
  if (!party) return;
  try { party.dc && party.dc.close(); } catch (e) {}
  try { party.pc && party.pc.close(); } catch (e) {}
  party.pc = null; party.dc = null;
}
function viewerDetach(sayBye) {
  if (!party || party.role !== 'viewer') return;
  clearTimeout(party.joinT);
  if (sayBye && party.hostId) psig(party.hostId, { type: 'bye' }, true);
  closeViewerPC();
  $('partyVid').srcObject = null;
  party.connected = false; party.cues = []; party.vtt = null;
}

// ---------- open / close ----------
function newParty(chat) {
  return { key: chat.id, chat, role: 'idle', pid: null, peers: {}, cues: [], subsOn: true, sync: null, dur: 0 };
}
function openTheater(chat) {
  party = newParty(chat);
  showBox(true);
  clearMedia();
  unbusy();
  $('partyTap').classList.add('hidden');
  $('partyCC').classList.remove('off');
  setRole('idle');
  wake();
}
function partyOpen() {                                 // the "🎬 Watch Party" button in the attach menu
  if (!current) return;
  if (party && party.key !== current.id) return alert('Close your current Watch Party first.');
  if (!party) {
    openTheater(current);
    party.opener = true;
    psig(current.id, { type: 'open', name: me.username });   // friends see the theater straight away
    getIce();                                                  // warm up TURN credentials
  }
  $('partyBox').scrollIntoView({ block: 'nearest' });
}
function partyClose() {                                // stop everything: peers, ffmpeg, streams, blob URLs
  if (!party) return;
  if (party.role === 'host') hostStop('end');
  else if (party.role === 'viewer') viewerDetach(true);
  else if (party.opener && party.role === 'idle') psig(party.chat.id, { type: 'lobbyend' }, true);
  cancelJob();
  ffStop();
  stopStream();
  clearMedia();
  clearTimeout(quietT);
  party = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('partyBox').classList.remove('fs', 'quiet');
  $('partyTap').classList.add('hidden');
  unbusy();
  showBox(false);
}
// called from app.js whenever another chat is opened
function partyOnSwitch(u) {
  if (party && party.key !== u.id) { if (party.role !== 'idle') toast('Watch Party closed'); partyClose(); }
  if (!party && presenceCh && (u.isGroup || online.has(u.id))) psig(u.id, { type: 'who' });   // joined late? ask the host to re-invite
}

// ---------- controls ----------
function toggleFs() {
  const box = $('partyBox');
  if (document.fullscreenElement === box || box.classList.contains('fs')) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    box.classList.remove('fs');
  } else if (box.requestFullscreen) box.requestFullscreen().catch(() => box.classList.add('fs'));
  else box.classList.add('fs');                        // iPhone Safari: fall back to a full-window theater
  wake();
}
document.addEventListener('fullscreenchange', () => { $('partyFs').textContent = document.fullscreenElement ? '✕' : '⛶'; });

function partyTime() {
  const v = $('partyVid');
  if (party.role === 'host') return v.currentTime;
  const s = party.sync;
  if (!s) return 0;
  return Math.max(0, s.t + (s.playing ? (performance.now() - s.at) / 1000 * s.rate : 0) - STREAM_LAG);
}
function tick() {                                      // ~5 times a second: time label, seek bar, subtitles, drift fix, sync
  if (!party || !party.role || party.role === 'idle' || party.role === 'prep') return;
  const v = $('partyVid'), host = party.role === 'host';
  const t = partyTime();
  const dur = host ? (isFinite(v.duration) ? v.duration : 0) : party.dur;
  $('partyPlay').textContent = isPlaying() ? '⏸' : '▶';
  if (!seekDrag) $('partySeek').value = dur ? Math.round(t / dur * 1000) : 0;
  $('partyTime').textContent = fmtT(t) + (dur ? ' / ' + fmtT(dur) : '');
  renderSub(t);
  if (host) {
    if (party.mode === 'sidecar' && !v.paused) {       // keep the hidden audio locked to the picture
      const a = $('partyAud');
      if (Math.abs(a.currentTime - v.currentTime) > 0.25) a.currentTime = v.currentTime;
    }
    if (++tickN % 10 === 0) pushSync();
  }
}
setInterval(tick, 200);

// ---------- wiring (runs once at startup) ----------
(function init() {
  const v = $('partyVid'), a = $('partyAud');
  // sidecar: the <video> is the master, the hidden <audio> follows
  const side = () => party && party.mode === 'sidecar';
  ['play', 'playing'].forEach(ev => v.addEventListener(ev, () => { if (side()) a.play().catch(() => {}); }));
  ['pause', 'waiting'].forEach(ev => v.addEventListener(ev, () => { if (side()) a.pause(); }));
  ['seeking', 'seeked'].forEach(ev => v.addEventListener(ev, () => { if (side()) a.currentTime = v.currentTime; }));
  v.addEventListener('ratechange', () => { if (side()) a.playbackRate = v.playbackRate; });
  // host: every play / pause / seek goes to the viewers right away
  ['play', 'pause', 'seeked', 'ratechange', 'ended', 'playing', 'waiting'].forEach(ev => v.addEventListener(ev, () => { pushSync(); wake(); }));
  // a native file that fails to decode half-way -> quietly redo it with ffmpeg
  v.addEventListener('error', () => {
    if (party && party.role === 'host' && party.mode === 'native' && party.file && v.error) {
      toast('Switching to compatibility mode…');
      partyLoadFile(party.file, { force: true });
    }
  });

  $('amParty').onclick = () => { $('attachMenu').classList.add('hidden'); partyOpen(); };
  $('partyCloseBtn').onclick = partyClose;
  $('partyFs').onclick = toggleFs;
  $('partyChangeBtn').onclick = () => $('partyFile').click();
  $('partyDrop').onclick = () => $('partyFile').click();
  $('partySubBtn').onclick = () => $('partySubFile').click();
  $('partyFile').onchange = () => { const f = $('partyFile').files[0]; $('partyFile').value = ''; if (f) partyLoadFile(f); };
  $('partySubFile').onchange = () => { const f = $('partySubFile').files[0]; $('partySubFile').value = ''; if (f) loadSubs(f); };
  $('partyCancel').onclick = () => {
    if (!party) return;
    if (party.role === 'prep') { cancelJob(); ffStop(); clearMedia(); unbusy(); setRole('idle'); }
    else partyClose();
  };
  $('partyPlay').onclick = () => { if (party && party.role === 'host') (v.paused ? v.play() : v.pause()); };
  $('partyBack').onclick = () => { if (party && party.role === 'host') v.currentTime = Math.max(0, v.currentTime - 10); };
  $('partyFwd').onclick = () => { if (party && party.role === 'host') v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); };
  $('partySeek').oninput = () => { seekDrag = true; const d = v.duration || 0; if (d) $('partyTime').textContent = fmtT($('partySeek').value / 1000 * d) + ' / ' + fmtT(d); };
  $('partySeek').onchange = () => { seekDrag = false; if (party && party.role === 'host' && v.duration) v.currentTime = $('partySeek').value / 1000 * v.duration; };
  $('partyCC').onclick = () => { if (!party) return; party.subsOn = !party.subsOn; $('partyCC').classList.toggle('off', !party.subsOn); };
  $('partyVol').oninput = () => { v.volume = +$('partyVol').value; v.muted = false; $('partyMute').textContent = v.volume ? '🔊' : '🔇'; };
  $('partyMute').onclick = () => { v.muted = !v.muted; $('partyMute').textContent = v.muted ? '🔇' : '🔊'; };
  $('partyTap').onclick = () => { v.muted = false; v.play().catch(() => {}); $('partyTap').classList.add('hidden'); $('partyMute').textContent = '🔊'; };
  $('partyStage').addEventListener('pointermove', wake);
  $('partyStage').addEventListener('pointerdown', wake);
  $('partyInviteBtn').onclick = () => {
    $('partyInvite').classList.add('hidden');
    if (!inviteInfo) return;
    const { p, key } = inviteInfo; inviteInfo = null;
    const chat = chatByKey(key);
    if (chat) { openChat(chat); if (p.type === 'open') onOpen(p, key); else onInvite(p, key); }
  };
  $('partyInviteNo').onclick = () => { inviteInfo = null; $('partyInvite').classList.add('hidden'); };

  // drag and drop anywhere on the theater: a video starts a movie, an .srt/.vtt adds subtitles
  const box = $('partyBox');
  box.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; box.classList.add('drag'); });
  box.addEventListener('dragover', e => e.preventDefault());
  box.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; box.classList.remove('drag'); } });
  box.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; box.classList.remove('drag');
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    const sub = files.find(f => /\.(srt|vtt)$/i.test(f.name));
    const vid = files.find(f => VIDEO_EXT.test(f.name) || /^video\//.test(f.type));
    if (vid) partyLoadFile(vid);
    if (sub) { if (vid) setTimeout(() => loadSubs(sub), 0); else loadSubs(sub); }
  });
  window.addEventListener('pagehide', () => { if (party) partyClose(); });
})();

// the rest of the app calls these three
window.partySignal = partySignal;
window.partyOnSwitch = partyOnSwitch;
window.partyClose = partyClose;
})();
