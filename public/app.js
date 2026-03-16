const socket = io();
let currentUser = null;
let currentChat = null; // { type: 'user'/'group', id: 'username'/'groupId', name: '', badge: '', members: [], admins: [] }
let sessionId = localStorage.getItem('elzzmsg_sid');
let onlineUsers = [];
let myContacts = [];
let myGroups = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Cek session lama
  if (sessionId) {
    try {
      const res = await fetch('/api/check-session', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ sessionId }) 
      });
      const data = await res.json();
      if (data.valid) { 
        currentUser = data.user; 
        showScreen('mainScreen'); 
        socket.emit('register', { sessionId }); 
      }
    } catch (e) { 
      localStorage.removeItem('elzzmsg_sid'); 
    }
  }
});

// === NAVIGASI ===
function showScreen(id) { 
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); 
  document.getElementById(id).classList.add('active'); 
}
function goBack(id) { showScreen(id); }

// === INIT SETUP ===
document.getElementById('nextBtn').onclick = () => showScreen('usernameScreen');
document.getElementById('usernameInput').oninput = (e) => { 
  let v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); 
  e.target.value = v; 
  document.getElementById('usernameNext').disabled = v.length < 3; 
};
document.getElementById('usernameNext').onclick = () => showScreen('displayNameScreen');

let setupAvatar = null;
document.getElementById('setupAvatarInput').onchange = async (e) => { 
  const file = e.target.files[0]; 
  if(!file) return; 
  const fd = new FormData(); 
  fd.append('file', file); 
  const res = await fetch('/upload', { method: 'POST', body: fd }); 
  const data = await res.json(); 
  setupAvatar = data.url; 
  document.getElementById('setupAvatar').innerHTML = `<img src="${data.url}" style="width:100%;height:100%;object-fit:cover">`; 
};

document.getElementById('displayNameInput').oninput = (e) => document.getElementById('displayNext').disabled = !e.target.value.trim();
document.getElementById('displayNext').onclick = () => socket.emit('register', { 
  username: document.getElementById('usernameInput').value, 
  displayName: document.getElementById('displayNameInput').value, 
  avatar: setupAvatar 
});

// === SOCKET EVENTS ===
socket.on('registered', (data) => { 
  currentUser = data.user; 
  sessionId = data.sessionId; 
  localStorage.setItem('elzzmsg_sid', sessionId); 
  showScreen('mainScreen'); 
  if (data.isAdmin) addBotChat(); 
});

socket.on('error', (d) => alert(d.message));

socket.on('contacts', (list) => { 
  myContacts = list; 
  renderLists(); 
});

socket.on('groups', (list) => { 
  myGroups = list; 
  renderLists(); 
});

socket.on('online_users', (u) => { onlineUsers = u; renderLists(); });

socket.on('receive_message', (msg) => { 
  if (currentChat && currentChat.type === 'user' && currentChat.id === msg.from) {
    appendMsg(msg); 
  } else {
    // Notif baru (placeholder)
    console.log('New message from', msg.from);
  }
});

socket.on('receive_group_message', (d) => { 
  if (currentChat && currentChat.type === 'group' && currentChat.id === d.groupId) {
    appendMsg(d.msg, true); 
  } 
});

socket.on('bot_message', (d) => { 
  if (currentChat && currentChat.id === 'Configurator Bot') {
    appendBotMsg(d.text); 
  } 
});

// === RENDER UI ===
function addBotChat() { 
  const c = document.getElementById('chatList'); 
  const i = document.createElement('div'); 
  i.className = 'chat-item'; 
  i.onclick = () => openChat({ type: 'user', id: 'Configurator Bot', name: 'Configurator Bot' }); 
  i.innerHTML = `
    <div class="chat-avatar" style="background:var(--primary)">
      <svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-2 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg>
    </div>
    <div class="chat-info">
      <div class="chat-top"><span class="chat-name">Configurator Bot</span></div>
      <div class="chat-preview">Admin commands</div>
    </div>`; 
  c.prepend(i); 
}

function renderLists() {
  const c = document.getElementById('chatList');
  const bot = c.querySelector('.chat-item:first-child');
  c.innerHTML = '';
  if (bot) c.appendChild(bot);

  // Render Groups
  myGroups.forEach(g => {
    const i = document.createElement('div');
    i.className = 'chat-item';
    i.onclick = () => openChat({ type: 'group', id: g.id, name: g.name, members: g.members, admins: g.admins });
    i.innerHTML = `
      <div class="chat-avatar" style="background:#005c4b">
        <svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
      </div>
      <div class="chat-info">
        <div class="chat-top"><span class="chat-name">${g.name}</span></div>
        <div class="chat-preview">${g.members.length} members</div>
      </div>`;
    c.appendChild(i);
  });

  // Render Contacts
  myContacts.forEach(u => {
    const i = document.createElement('div');
    i.className = 'chat-item';
    i.onclick = () => openChat({ type: 'user', id: u.username, name: u.displayName, avatar: u.avatar, badge: u.badge });
    const badgeHtml = u.badge ? `<span class="badge">${u.badge}</span>` : '';
    const statusHtml = onlineUsers.includes(u.username) ? 'online' : '';
    i.innerHTML = `
      <div class="chat-avatar">
        ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">` : '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'}
      </div>
      <div class="chat-info">
        <div class="chat-top">
          <span class="chat-name">${u.displayName} ${badgeHtml}</span>
          <span class="chat-time">${statusHtml}</span>
        </div>
        <div class="chat-preview">@${u.username}</div>
      </div>`;
    c.appendChild(i);
  });
}

// === CHAT LOGIC ===
function openChat(d) { 
  currentChat = d; 
  showScreen('chatView'); 
  
  // Header
  const badgeHeader = d.badge ? `<span class="badge">${d.badge}</span>` : '';
  document.getElementById('chatName').innerHTML = d.name + badgeHeader;
  
  let status = '';
  if (d.type === 'group') {
    status = 'Group';
    document.getElementById('groupInfoBtn').style.display = 'block';
  } else {
    status = onlineUsers.includes(d.id) ? 'online' : 'offline';
    document.getElementById('groupInfoBtn').style.display = 'none';
  }
  document.getElementById('chatStatus').textContent = status;

  // Avatar
  const av = document.getElementById('chatAvatar');
  if (d.avatar) av.innerHTML = `<img src="${d.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  else if (d.type === 'group') av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
  else av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

  document.getElementById('messagesContainer').innerHTML = '';
  
  if (d.type === 'user') socket.emit('get_messages', { user1: currentUser.username, user2: d.id });
  else socket.emit('get_group_messages', d.id);
}

function backToList() { 
  showScreen('mainScreen'); 
  currentChat = null; 
}

socket.on('messages', (msgs) => { 
  document.getElementById('messagesContainer').innerHTML = ''; 
  msgs.forEach(m => appendMsg(m)); 
});

socket.on('group_messages', (msgs) => { 
  document.getElementById('messagesContainer').innerHTML = ''; 
  msgs.forEach(m => appendMsg(m, true)); 
});

function appendMsg(m, isGroup = false) {
  const c = document.getElementById('messagesContainer');
  const el = document.createElement('div');
  const out = m.from === currentUser?.username || m.from === currentUser?.id;
  el.className = `message ${out ? 'out' : 'in'}`;
  
  // Parse Tags
  let text = m.text.replace(/@(\w+)/g, '<span class="tag-highlight" onclick="tagUser(\'$1\')">@$1</span>');
  
  const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Sender name for groups
  const senderName = (isGroup && !out) ? `<div style="font-size:12px;color:var(--primary);margin-bottom:2px">${m.from}</div>` : '';
  
  el.innerHTML = `<div class="message-bubble">${senderName}<span class="message-text">${text}</span><span class="message-meta"><span class="message-time">${time}</span></span></div>`;
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}

function appendBotMsg(text) {
  const c = document.getElementById('messagesContainer');
  const el = document.createElement('div');
  el.className = 'message in';
  el.innerHTML = `<div class="message-bubble"><span class="message-text" style="white-space:pre-wrap">${text}</span></div>`;
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}

// === ACTIONS ===
function toggleFab() { 
  document.getElementById('fabMenu').classList.toggle('active'); 
}

function openAddContact() { 
  toggleFab(); 
  document.getElementById('addContactModal').classList.add('active'); 
  document.getElementById('addContactInput').value = ''; 
}
function closeAddContact() { document.getElementById('addContactModal').classList.remove('active'); }
function addContact() { 
  socket.emit('add_contact', { targetUsername: document.getElementById('addContactInput').value.trim(), userId: currentUser.id }); 
  closeAddContact(); 
}

function openCreateGroup() { 
  toggleFab(); 
  document.getElementById('createGroupModal').classList.add('active'); 
  document.getElementById('groupNameInput').value = ''; 
}
function closeCreateGroup() { document.getElementById('createGroupModal').classList.remove('active'); }
function createGroup() { 
  const name = document.getElementById('groupNameInput').value.trim(); 
  if(!name) return; 
  socket.emit('create_group', { name, userId: currentUser.id }); 
  closeCreateGroup(); 
}

function openGroupInfo() { 
  document.getElementById('groupInfoModal').classList.add('active'); 
  renderMemberList(); 
}
function closeGroupInfo() { document.getElementById('groupInfoModal').classList.remove('active'); }

function renderMemberList() { 
  const list = document.getElementById('memberList'); 
  list.innerHTML = ''; 
  
  // Cari data group terbaru
  const group = myGroups.find(g => g.id === currentChat.id);
  if(!group) return;

  group.members.forEach(mId => {
    // Cari nama member
    const u = myContacts.find(c => c.id === mId) || onlineUsers.find(o => o.id === mId);
    const name = u ? u.username : mId; // Fallback ke ID
    const isAdmin = group.admins.includes(mId);
    const isMeAdmin = group.admins.includes(currentUser.id);
    
    const div = document.createElement('div'); 
    div.style.cssText = "display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid var(--border)"; 
    div.innerHTML = `
      <span>${name} ${isAdmin ? '<span style="color:var(--primary)">(Admin)</span>' : ''}</span> 
      ${isMeAdmin && !isAdmin ? `<button onclick="promote('${mId}')">Make Admin</button>` : ''}`; 
    list.appendChild(div); 
  }); 
}

function addMember() { 
  const u = document.getElementById('addMemberInput').value.trim(); 
  if(!u) return; 
  socket.emit('add_member', { groupId: currentChat.id, userId: u }); // userId bisa username atau ID, tergantung logic server
  alert('Member added'); 
}

function promote(id) { 
  socket.emit('promote_admin', { groupId: currentChat.id, userId: id }); 
  alert('Promoted'); 
}

// === SEND ===
function sendMessage() { 
  const t = document.getElementById('messageInput').value.trim(); 
  if (!t || !currentChat) return; 
  
  if (currentChat.type === 'user') {
    socket.emit('send_message', { from: currentUser.username, to: currentChat.id, text: t });
  } else {
    socket.emit('send_group_message', { from: currentUser.id, to: currentChat.id, text: t });
  }
  
  document.getElementById('messageInput').value = ''; 
}

document.getElementById('messageInput').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

// === PROFILE ===
function openProfile() { 
  if (!currentUser) return; 
  document.getElementById('profileName').value = currentUser.displayName; 
  document.getElementById('profileBio').value = currentUser.bio || ''; 
  document.getElementById('profileUsername').value = currentUser.username; 
  document.getElementById('profileAvatar').innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">` : ''; 
  document.getElementById('profileModal').classList.add('active'); 
}

function closeProfile() { document.getElementById('profileModal').classList.remove('active'); }

document.getElementById('avatarInput').onchange = async (e) => { 
  const f = e.target.files[0]; 
  if (!f) return; 
  const fd = new FormData(); 
  fd.append('file', f); 
  const res = await fetch('/upload', { method: 'POST', body: fd }); 
  const d = await res.json(); 
  currentUser.avatar = d.url; 
  document.getElementById('profileAvatar').innerHTML = `<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`; 
};

function saveProfile() { 
  socket.emit('update_profile', { 
    userId: currentUser.id, 
    displayName: document.getElementById('profileName').value, 
    bio: document.getElementById('profileBio').value, 
    avatar: currentUser.avatar 
  }); 
  closeProfile(); 
}

socket.on('profile_updated', (u) => currentUser = u);

// === UTILS ===
function tagUser(username) {
  const input = document.getElementById('messageInput');
  input.value += `@${username} `;
  input.focus();
}
