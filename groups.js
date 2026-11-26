'use strict';
// ===== Just Us Three · groups =====

let getNg = () => [], getAm = () => [];

// ---------- create a group ----------
function openNewGroup() {
  $('ngName').value = '';
  getNg = checkList($('ngList'), friends.map(f => ({ id: f.id, label: f.username, av: f })));
  $('newGroup').classList.remove('hidden');
}
$('ngCancel').onclick = () => $('newGroup').classList.add('hidden');
$('ngCreate').onclick = async () => {
  const name = $('ngName').value.trim();
  const ids = getNg();
  if (!name) return alert('Give the group a name.');
  if (!ids.length) return alert('Pick at least one friend.');
  $('ngCreate').disabled = true;
  const { data, error } = await db.rpc('create_group', { gname: name, member_ids: ids });
  $('ngCreate').disabled = false;
  if (error) return alert(error.message);
  $('newGroup').classList.add('hidden');
  await loadChats();
  const g = chatByKey('g:' + data);
  if (g) openChat(g);
  toast('Group created');
};

// ---------- group info ----------
function openGroupInfo() {
  const g = current;
  if (!g || !g.isGroup) { $('groupInfo').classList.add('hidden'); return; }
  const admin = isAdminOf(g);
  const mem = members[g.gid] || [];
  const box = $('giBody');
  box.innerHTML = '';

  const head = document.createElement('div'); head.className = 'gihead';
  const t = document.createElement('b'); t.textContent = g.name;
  const ab = document.createElement('div'); ab.className = 'pv'; ab.textContent = g.about || 'No description';
  const cnt = document.createElement('div'); cnt.className = 'pv'; cnt.textContent = mem.length + ' members' + (g.only_admins_send ? ' · only admins can send' : '');
  head.append(avatar(g, true), t, ab, cnt);
  box.appendChild(head);

  const btn = (label, fn, cls) => {
    const b = document.createElement('button');
    b.className = cls || 'secondary'; b.textContent = label; b.onclick = fn;
    box.appendChild(b);
  };
  if (admin) {
    btn('✏️ Edit name and description', editGroup);
    btn('🖼 Change group icon', () => $('giIcon').click());
    btn(g.only_admins_send ? '🔓 Let everyone send messages' : '🔒 Only admins can send messages', () => updateGroup({ only_admins_send: !g.only_admins_send }));
    btn('➕ Add members', openAddMembers);
  }

  const search = document.createElement('input');
  search.placeholder = 'Search members';
  const list = document.createElement('div');
  box.append(search, list);
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    [...mem].sort((a, b) => (b.role === 'admin') - (a.role === 'admin')).forEach(r => {
      const p = r.user_id === me.id ? me : (friends.find(f => f.id === r.user_id) || { username: 'Someone' });
      if (q && !p.username.toLowerCase().includes(q)) return;
      const row = document.createElement('div'); row.className = 'memrow';
      const nm = document.createElement('div'); nm.className = 'mid';
      nm.textContent = p.username + (r.user_id === me.id ? ' (you)' : '');
      row.append(avatar(p), nm);
      if (r.role === 'admin') { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = 'Admin'; row.appendChild(tg); }
      if (admin && r.user_id !== me.id) {
        const bs = document.createElement('div'); bs.className = 'btns';
        const b1 = document.createElement('button'); b1.className = 'small secondary';
        b1.textContent = r.role === 'admin' ? 'Remove admin' : 'Make admin';
        b1.onclick = () => setRole(g, r.user_id, r.role === 'admin' ? 'member' : 'admin');
        const b2 = document.createElement('button'); b2.className = 'small danger'; b2.textContent = 'Remove';
        b2.onclick = () => removeMember(g, r.user_id, p.username);
        bs.append(b1, b2);
        row.appendChild(bs);
      }
      list.appendChild(row);
    });
  };
  search.oninput = render;
  render();
  btn('Leave group', leaveGroup, 'danger');
  $('groupInfo').classList.remove('hidden');
}
$('giClose').onclick = () => $('groupInfo').classList.add('hidden');

async function updateGroup(patch) {
  const { error } = await db.from('groups').update(patch).eq('id', current.gid);
  if (error) return alert(error.message);
  await loadChats();
  openGroupInfo();
}
function editGroup() {
  const g = current;
  const n = prompt('Group name', g.name);
  if (n === null) return;
  const a = prompt('Group description', g.about || '');
  if (a === null) return;
  if (!n.trim()) return alert('The group needs a name.');
  updateGroup({ name: n.trim().slice(0, 40), about: a.trim().slice(0, 120) });
}
$('giIcon').onchange = async () => {
  const f = $('giIcon').files[0];
  $('giIcon').value = '';
  if (!f || !current || !current.isGroup) return;
  try {
    const up = await uploadMedia(f, 400);
    await updateGroup({ icon_url: up.url });
  } catch (e) { alert(e.message); }
};
async function setRole(g, uid, role) {
  const { error } = await db.from('group_members').update({ role }).eq('group_id', g.gid).eq('user_id', uid);
  if (error) return alert(error.message);
  await loadChats();
  openGroupInfo();
}
async function removeMember(g, uid, name) {
  if (!confirm('Remove ' + name + ' from the group?')) return;
  const { error } = await db.from('group_members').delete().eq('group_id', g.gid).eq('user_id', uid);
  if (error) return alert(error.message);
  await loadChats();
  openGroupInfo();
}
async function leaveGroup() {
  const g = current;
  const mem = members[g.gid] || [];
  const admins = mem.filter(r => r.role === 'admin');
  if (isAdminOf(g) && admins.length === 1 && mem.length > 1) {
    return alert('You are the only admin. Make someone else an admin first.');
  }
  if (!confirm('Leave this group?')) return;
  const { error } = await db.from('group_members').delete().eq('group_id', g.gid).eq('user_id', me.id);
  if (error) return alert(error.message);
  $('groupInfo').classList.add('hidden');
  await loadChats();
}

// ---------- add members ----------
function openAddMembers() {
  const g = current;
  const inGroup = new Set((members[g.gid] || []).map(r => r.user_id));
  const left = friends.filter(f => !inGroup.has(f.id));
  getAm = checkList($('amList'), left.map(f => ({ id: f.id, label: f.username, av: f })));
  $('addMembers').classList.remove('hidden');
}
$('amCancel').onclick = () => $('addMembers').classList.add('hidden');
$('amAdd').onclick = async () => {
  const ids = getAm();
  if (!ids.length) return;
  const rows = ids.map(id => ({ group_id: current.gid, user_id: id, role: 'member' }));
  const { error } = await db.from('group_members').insert(rows);
  if (error) return alert(error.message);
  $('addMembers').classList.add('hidden');
  await loadChats();
  openGroupInfo();
  toast('Members added');
};
