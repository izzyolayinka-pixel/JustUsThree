'use strict';
// ===== Just Us Three · voice and video calls (1-to-1) =====
// Signals travel through the same live channel as typing. Audio and video go
// directly between the two phones using free Google STUN servers.

let call = null, ringT = null;
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function sig(to, payload) {
  if (presenceCh) presenceCh.send({ type: 'broadcast', event: 'call', payload: { ...payload, from: me.id, to } });
}
function startRing() { stopRing(); beep(); ringT = setInterval(beep, 1500); }
function stopRing() { clearInterval(ringT); ringT = null; }
function hideIncoming() { $('incoming').classList.add('hidden'); }

function showCallUI(status) {
  $('callName').textContent = call.peer.username;
  $('callStatus').textContent = status;
  $('callUI').classList.toggle('audio', !call.video);
  $('callCam').classList.toggle('hidden', !call.video);
  $('callMute').textContent = '🎙';
  $('callCam').textContent = '📷';
  $('localVid').srcObject = call.local || null;
  $('callUI').classList.remove('hidden');
}

function setupPC() {
  const pc = new RTCPeerConnection(ICE);
  call.pc = pc;
  pc.onicecandidate = e => { if (e.candidate && call) sig(call.peer.id, { type: 'ice', cand: e.candidate }); };
  pc.ontrack = e => { $('remoteVid').srcObject = e.streams[0]; };
  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    const s = pc.connectionState;
    if (s === 'connected' && !call.connected) {
      call.connected = true;
      call.start = Date.now();
      clearTimeout(call.ring);
      $('callStatus').textContent = '00:00';
      call.timer = setInterval(() => { if (call) $('callStatus').textContent = fmtDur(Date.now() - call.start); }, 1000);
    }
    if (s === 'failed' || s === 'closed') endCall(call.connected ? 'ended' : 'failed');
    if (s === 'disconnected') setTimeout(() => { if (call && call.pc === pc && pc.connectionState === 'disconnected') endCall('ended'); }, 8000);
  };
}
async function flushIce() {
  if (!call || !call.pc) return;
  const list = call.pendingIce.splice(0);
  for (const c of list) { try { await call.pc.addIceCandidate(c); } catch (e) {} }
}

async function startCall(video) {
  if (!current || current.isGroup || call) return;
  if (!window.RTCPeerConnection) return alert('Calls are not supported on this browser.');
  if (!online.has(current.id)) toast(current.username + ' may not be online. Ringing anyway…');
  const peer = current;
  let local;
  try {
    local = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
  } catch (e) { return alert('Allow microphone' + (video ? ' and camera' : '') + ' access to make calls.'); }
  call = { peer, video, caller: true, connected: false, pendingIce: [], local };
  setupPC();
  local.getTracks().forEach(t => call.pc.addTrack(t, local));
  showCallUI('Calling…');
  const offer = await call.pc.createOffer();
  await call.pc.setLocalDescription(offer);
  sig(peer.id, { type: 'offer', sdp: offer, video });
  call.ring = setTimeout(() => { if (call && !call.connected) endCall('missed'); }, 45000);
}

async function handleSignal(p) {
  if (!me || p.to !== me.id) return;
  if (p.type === 'offer') {
    if (call) { sig(p.from, { type: 'busy' }); return; }
    const peer = friends.find(f => f.id === p.from);
    if (!peer || blocked.has(p.from)) return;
    call = { peer, video: !!p.video, caller: false, connected: false, pendingIce: [], offer: p.sdp };
    $('incAv').innerHTML = '';
    $('incAv').appendChild(avatar(peer, true));
    $('incName').textContent = peer.username;
    $('incText').textContent = 'Incoming ' + (p.video ? 'video' : 'voice') + ' call';
    $('incoming').classList.remove('hidden');
    startRing();
    notify('Incoming call', peer.username);
    call.ring = setTimeout(() => { if (call && !call.connected && !call.caller) endCall('silent'); }, 45000);
    return;
  }
  if (!call || call.peer.id !== p.from) return;
  if (p.type === 'answer') {
    if (call.pc) { await call.pc.setRemoteDescription(p.sdp); flushIce(); }
  } else if (p.type === 'ice') {
    if (call.pc && call.pc.remoteDescription) { try { await call.pc.addIceCandidate(p.cand); } catch (e) {} }
    else call.pendingIce.push(p.cand);
  } else if (p.type === 'hangup') endCall('remote');
  else if (p.type === 'decline') endCall('declined');
  else if (p.type === 'busy') endCall('busy');
}

$('incAccept').onclick = async () => {
  if (!call || call.caller) return;
  stopRing(); hideIncoming(); clearTimeout(call.ring);
  let local;
  try {
    local = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.video ? { facingMode: 'user' } : false });
  } catch (e) {
    alert('Allow microphone access to answer calls.');
    sig(call.peer.id, { type: 'decline' });
    endCall('silent');
    return;
  }
  call.local = local;
  setupPC();
  local.getTracks().forEach(t => call.pc.addTrack(t, local));
  showCallUI('Connecting…');
  await call.pc.setRemoteDescription(call.offer);
  flushIce();
  const ans = await call.pc.createAnswer();
  await call.pc.setLocalDescription(ans);
  sig(call.peer.id, { type: 'answer', sdp: ans });
};
$('incDecline').onclick = () => {
  if (!call) return;
  sig(call.peer.id, { type: 'decline' });
  endCall('silent');
};
$('callEnd').onclick = () => endCall('hangup');
$('callMute').onclick = () => {
  if (!call || !call.local) return;
  const on = call.local.getAudioTracks().some(t => t.enabled);
  call.local.getAudioTracks().forEach(t => { t.enabled = !on; });
  $('callMute').textContent = on ? '🔇' : '🎙';
};
$('callCam').onclick = () => {
  if (!call || !call.local) return;
  const on = call.local.getVideoTracks().some(t => t.enabled);
  call.local.getVideoTracks().forEach(t => { t.enabled = !on; });
  $('callCam').textContent = on ? '🚫' : '📷';
};
$('voiceBtn').onclick = () => startCall(false);
$('videoBtn').onclick = () => startCall(true);

async function endCall(reason) {
  if (!call) return;
  const c = call;
  call = null;
  clearTimeout(c.ring); clearInterval(c.timer); stopRing();
  if (reason === 'hangup' || reason === 'missed') sig(c.peer.id, { type: 'hangup' });
  try { if (c.pc) c.pc.close(); } catch (e) {}
  if (c.local) c.local.getTracks().forEach(t => t.stop());
  $('callUI').classList.add('hidden');
  hideIncoming();
  $('remoteVid').srcObject = null;
  $('localVid').srcObject = null;
  if (!c.caller) return;
  const kind = c.video ? 'video' : 'voice';
  let text;
  if (c.connected) text = cap(kind) + ' call · ' + fmtDur(Date.now() - c.start);
  else if (reason === 'declined') text = cap(kind) + ' call declined';
  else if (reason === 'busy') text = cap(kind) + ' call · busy';
  else if (reason === 'failed') text = cap(kind) + ' call · could not connect';
  else text = 'Missed ' + kind + ' call';
  const { data } = await db.from('messages')
    .insert({ sender_id: me.id, receiver_id: c.peer.id, media_type: 'call', content: text }).select().single();
  if (data) {
    lastMsg[c.peer.id] = data;
    if (current && current.id === c.peer.id) { msgs[data.id] = data; addMsg(data); scrollDown(); }
    renderChats();
  }
}

// ---------- Calls tab ----------
async function loadCalls() {
  const list = $('callList');
  list.innerHTML = '';
  const note = t => { const d = document.createElement('div'); d.className = 'user muted'; d.textContent = t; list.appendChild(d); };
  const { data, error } = await db.from('messages').select('*').eq('media_type', 'call')
    .order('created_at', { ascending: false }).limit(60);
  if (error) return note('Could not load calls: ' + error.message);
  const rows = (data || []).filter(m => !hidden.has(m.id) && chatByKey(keyOf(m)));
  if (!rows.length) return note('No calls yet. Open a chat and tap 📞 or 🎥.');
  rows.forEach(m => {
    const c = chatByKey(keyOf(m));
    const row = document.createElement('div'); row.className = 'user';
    const mid = document.createElement('div'); mid.className = 'mid';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = c.username;
    const pv = document.createElement('div'); pv.className = 'pv';
    pv.textContent = (m.sender_id === me.id ? '↗ ' : '↙ ') + (m.content || 'Call');
    mid.append(nm, pv);
    const tm = document.createElement('div'); tm.className = 'tm'; tm.textContent = dayLabel(m.created_at) + ' ' + fmtTime(m.created_at);
    row.append(avatar(c), mid, tm);
    row.onclick = () => { showTab('chats'); openChat(c); };
    list.appendChild(row);
  });
}
