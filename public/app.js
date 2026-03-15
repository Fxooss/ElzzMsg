const socket = io();
let currentUser = null;
let currentChat = null;
let sessionId = localStorage.getItem('elzzmsg_sid');
let onlineUsers = [];
let statuses = [];

const emojis = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💗','💓','💘','💝','💟','🔥','⭐','🌟','✨','💫','🎉','🎊'];

document.addEventListener('DOMContentLoaded', async () => {
  initEmojis();
  if (sessionId) {
    try {
      const res = await fetch('/api/check-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
      const data = await res.json();
      if (data.banned) { showBanned(data.banData.bannedBy, data.banData.reason); return; }
      if (data.valid) { currentUser = data.user; showScreen('mainScreen'); socket.emit('register', { sessionId }); }
    } catch (e) { localStorage.removeItem('elzzmsg_sid'); }
  }
});

function initEmojis() { document.getElementById('emojiPicker').innerHTML = emojis.map(e => `<span onclick="insertEmoji('${e}')">${e}</span>`).join(''); }
function insertEmoji(e) { const i = document.getElementById('messageInput'); i.value += e; i.focus(); toggleSend(); }
function toggleEmojiPicker() { document.getElementById('emojiPicker').classList.toggle('active'); }

function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function goBack(id) { showScreen(id); }

// === BANNED & UNBANNED HANDLER ===
socket.on('banned', (data) => showBanned(data.bannedBy, data.reason));
socket.on('unbanned', () => showScreen('recoveredScreen'));

function showBanned(admin, reason) { document.getElementById('bannedAdmin').innerText = admin; document.getElementById('bannedReason').innerText = reason; showScreen('bannedScreen'); localStorage.removeItem('elzzmsg_sid'); sessionId = null; }
function closeRecovered() { showScreen('welcomeScreen'); document.getElementById('recoveredScreen').classList.remove('active'); }

// === INIT ===
document.getElementById('nextBtn').onclick = () => showScreen('usernameScreen');
document.getElementById('usernameInput').oninput = (e) => { let v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); e.target.value = v; document.getElementById('usernameNext').disabled = v.length < 3; };
document.getElementById('usernameNext').onclick = () => showScreen('displayNameScreen');

let setupAvatar = null;
document.getElementById('setupAvatarInput').onchange = async (e) => { const file = e.target.files[0]; if(!file) return; const fd = new FormData(); fd.append('file', file); const res = await fetch('/upload', { method: 'POST', body: fd }); const data = await res.json(); setupAvatar = data.url; document.getElementById('setupAvatar').innerHTML = `<img src="${data.url}" style="width:100%;height:100%;object-fit:cover">`; };
document.getElementById('displayNameInput').oninput = (e) => document.getElementById('displayNext').disabled = !e.target.value.trim();
document.getElementById('displayNext').onclick = () => socket.emit('register', { username: document.getElementById('usernameInput').value, displayName: document.getElementById('displayNameInput').value, avatar: setupAvatar });

// === SOCKETS ===
socket.on('registered', (data) => { currentUser = data.user; sessionId = data.sessionId; localStorage.setItem('elzzmsg_sid', sessionId); showScreen('mainScreen'); if (data.isAdmin) addBotChat(); });
socket.on('error', (d) => alert(d.message));
socket.on('contacts', renderContacts);
socket.on('contact_added', () => { socket.emit('get_contacts', currentUser.id); closeAddContact(); });
socket.on('online_users', (u) => { onlineUsers = u; renderContacts(); });
socket.on('statuses', (s) => { statuses = s; renderStatuses(); });
socket.on('new_status', (s) => { statuses.unshift(s); renderStatuses(); });

function addBotChat() { const c = document.getElementById('chatList'); const i = document.createElement('div'); i.className = 'chat-item'; i.onclick = () => openChat('Configurator Bot', 'bot'); i.innerHTML = `<div class="chat-avatar" style="background:var(--primary)"><svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-2 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg></div><div class="chat-info"><div class="chat-top"><span class="chat-name">Configurator Bot</span></div><div class="chat-preview">Admin commands</div></div>`; c.prepend(i); }
function renderContacts(list) { const c = document.getElementById('chatList'); const bot = c.querySelector('.chat-item:first-child'); c.innerHTML = ''; if (bot) c.appendChild(bot); list.forEach(u => { const i = document.createElement('div'); i.className = 'chat-item'; i.onclick = () => openChat(u.displayName, u.username, u.avatar); i.innerHTML = `<div class="chat-avatar">${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">` : '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">${u.displayName}</span><span class="chat-time">${onlineUsers.includes(u.username) ? 'online' : ''}</span></div><div class="chat-preview">Tap to chat</div></div>`; c.appendChild(i); }); }

// === STATUS ===
function switchTab(tab) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); if(tab === 'chats') { document.querySelector('.tab:first-child').classList.add('active'); document.getElementById('chatsView').style.display = 'block'; document.getElementById('statusView').style.display = 'none'; } else { document.querySelector('.tab:nth-child(2)').classList.add('active'); document.getElementById('chatsView').style.display = 'none'; document.getElementById('statusView').style.display = 'block'; socket.emit('get_statuses'); } }
function renderStatuses() { const list = document.getElementById('statusList'); const myStatusHtml = list.querySelector('.my-status').outerHTML; list.innerHTML = myStatusHtml; if(currentUser && currentUser.avatar) document.getElementById('myStatusAvatar').innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`; const others = statuses.filter(s => s.userId !== currentUser.id); others.forEach(s => { const i = document.createElement('div'); i.className = 'status-item'; i.onclick = () => viewStatus(s); i.innerHTML = `<div class="status-avatar-wrapper"><div class="status-avatar">${s.avatar ? `<img src="${s.avatar}" style="width:100%;height:100%;object-fit:cover">` : ''}</div></div><div class="status-info"><h4>${s.displayName}</h4><p>${new Date(s.time).toLocaleTimeString()}</p></div>`; list.appendChild(i); }); }
function openMyStatus() { document.getElementById('statusInput').click(); }
document.getElementById('statusInput').onchange = async (e) => { const file = e.target.files[0]; if(!file) return; const fd = new FormData(); fd.append('file', file); const res = await fetch('/upload', { method: 'POST', body: fd }); const data = await res.json(); const type = data.type.startsWith('video') ? 'video' : 'image'; socket.emit('post_status', { userId: currentUser.id, url: data.url, type, caption: '' }); };
function viewStatus(s) { socket.emit('view_status', { statusId: s.id, viewerUsername: currentUser.username }); const contentType = s.type === 'video' ? `<video src="${s.url}" controls autoplay style="width:100%;height:100%;object-fit:contain"></video>` : `<img src="${s.url}" style="width:100%;height:100%;object-fit:contain">`; const overlay = document.createElement('div'); overlay.className = 'screen active'; overlay.style.background = '#000'; overlay.style.zIndex = '2000'; overlay.innerHTML = `<div style="position:absolute;top:10px;left:10px;display:flex;align-items:center;color:#fff;z-index:2001;padding:10px"><div class="chat-avatar" style="width:30px;height:30px">${s.avatar ? `<img src="${s.avatar}" style="width:100%;height:100%;object-fit:cover">`: ''}</div><span style="margin-left:10px;font-size:14px">${s.displayName}</span></div>${contentType}<button onclick="this.parentElement.remove()" style="position:absolute;top:10px;right:10px;background:none;border:none;color:#fff;font-size:24px;z-index:2001">✕</button>`; document.body.appendChild(overlay); }

// === ADD CONTACT ===
function openAddContact() { document.getElementById('addContactModal').classList.add('active'); document.getElementById('addContactInput').value = ''; }
function closeAddContact() { document.getElementById('addContactModal').classList.remove('active'); }
function addContact() { socket.emit('add_contact', { targetUsername: document.getElementById('addContactInput').value.trim(), userId: currentUser.id }); }

// === CHAT ===
function openChat(name, username, avatar) { currentChat = username; showScreen('chatView'); document.getElementById('chatName').textContent = name; document.getElementById('chatStatus').textContent = onlineUsers.includes(username) ? 'online' : 'last seen'; const av = document.getElementById('chatAvatar'); if (avatar) av.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover">`; else if (username === 'bot') { av.style.background = 'var(--primary)'; av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-2 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg>'; } else av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'; document.getElementById('messagesContainer').innerHTML = '<div class="encryption-notice"><svg viewBox="0 0 10 12" width="10"><path fill="#8696a0" d="M5.009 0C2.793 0 1 1.789 1 4v1C.458 5 0 5.458 0 6v5c0 .542.458 1 1 1h8c.542 0 1-.458 1-1V6c0-.542-.458-1-1-1V4c0-2.211-1.789-4-3.991-4z"/></svg> Messages are end-to-end encrypted.</div>'; if (username === 'bot') appendBotMsg('🤖 Welcome Admin!\n\nCommands:\n/ban (username) (alasan)\n/unban (username)'); else socket.emit('get_messages', { user1: currentUser.username, user2: username }); }
function backToList() { showScreen('mainScreen'); currentChat = null; }

// === MESSAGES ===
socket.on('messages', (msgs) => { const c = document.getElementById('messagesContainer'); const n = c.querySelector('.encryption-notice'); c.innerHTML = ''; if (n) c.appendChild(n); msgs.forEach(m => appendMsg(m)); scroll(); });
socket.on('receive_message', (m) => { if (currentChat === m.from) { appendMsg(m); scroll(); } });
socket.on('message_sent', (m) => { appendMsg(m); scroll(); });
socket.on('bot_message', (m) => { if (currentChat === 'bot') { appendBotMsg(m.text); scroll(); } });
socket.on('command_result', (d) => { appendSys(d.message); scroll(); });

function appendMsg(m) { const c = document.getElementById('messagesContainer'); const el = document.createElement('div'); const out = m.from === currentUser?.username; el.className = `message ${out ? 'out' : 'in'}`; const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); el.innerHTML = `<div class="message-bubble"><span class="message-text">${m.text}</span><span class="message-meta"><span class="message-time">${time}</span></span></div>`; c.appendChild(el); }
function appendBotMsg(t) { const c = document.getElementById('messagesContainer'); const el = document.createElement('div'); el.className = 'message in'; el.innerHTML = `<div class="message-bubble"><span class="message-text" style="white-space:pre-wrap">${t}</span></div>`; c.appendChild(el); }
function appendSys(t) { const c = document.getElementById('messagesContainer'); const el = document.createElement('div'); el.className = 'encryption-notice'; el.innerHTML = `<span>${t}</span>`; c.appendChild(el); }
function scroll() { const c = document.getElementById('messagesContainer'); c.scrollTop = c.scrollHeight; }

// === SEND ===
function toggleSend() { const v = document.getElementById('messageInput').value.trim(); document.getElementById('sendBtn').classList.toggle('active', !!v); document.getElementById('voiceBtn').style.display = v ? 'none' : 'block'; }
document.getElementById('messageInput').oninput = () => { toggleSend(); socket.emit('typing', { from: currentUser.username, to: currentChat, isTyping: true }); };
document.getElementById('messageInput').onblur = () => socket.emit('typing', { from: currentUser.username, to: currentChat, isTyping: false });
document.getElementById('messageInput').onkeypress = (e) => { if (e.key === 'Enter') send(); };
function send() { const t = document.getElementById('messageInput').value.trim(); if (!t || !currentChat) return; socket.emit('send_message', { from: currentUser.username, to: currentChat, text: t }); document.getElementById('messageInput').value = ''; toggleSend(); }
document.getElementById('fileInput').onchange = async (e) => { const f = e.target.files[0]; if (!f || !currentChat) return; const fd = new FormData(); fd.append('file', f); const res = await fetch('/upload', { method: 'POST', body: fd }); const d = await res.json(); socket.emit('send_message', { from: currentUser.username, to: currentChat, text: f.name, type: 'image', mediaUrl: d.url }); };
socket.on('typing', (d) => { document.getElementById('typingIndicator').classList.toggle('active', d.isTyping && d.from === currentChat); });

// === PROFILE ===
function openProfile() { if (!currentUser) return; document.getElementById('profileName').value = currentUser.displayName; document.getElementById('profileBio').value = currentUser.bio || ''; document.getElementById('profileUsername').value = currentUser.username; document.getElementById('profileAvatar').innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">` : ''; document.getElementById('profileModal').classList.add('active'); }
function closeProfile() { document.getElementById('profileModal').classList.remove('active'); }
document.getElementById('avatarInput').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const res = await fetch('/upload', { method: 'POST', body: fd }); const d = await res.json(); currentUser.avatar = d.url; document.getElementById('profileAvatar').innerHTML = `<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`; };
function saveProfile() { socket.emit('update_profile', { userId: currentUser.id, displayName: document.getElementById('profileName').value, bio: document.getElementById('profileBio').value, avatar: currentUser.avatar }); closeProfile(); }
socket.on('profile_updated', (u) => currentUser = u);socket.on('banned', (data) => showBanned(data.bannedBy, data.reason));
socket.on('unbanned', () => showScreen('recoveredScreen'));

function showBanned(admin, reason) {
  document.getElementById('bannedAdmin').innerText = admin;
  document.getElementById('bannedReason').innerText = reason;
  showScreen('bannedScreen');
  localStorage.removeItem('elzzmsg_sid');
  sessionId = null;
}

function closeRecovered() {
  showScreen('welcomeScreen');
  document.getElementById('recoveredScreen').classList.remove('active');
}

// === INIT ===
document.getElementById('nextBtn').onclick = () => showScreen('usernameScreen');
document.getElementById('usernameInput').oninput = (e) => { let v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); e.target.value = v; document.getElementById('usernameNext').disabled = v.length < 3; };
document.getElementById('usernameNext').onclick = () => showScreen('displayNameScreen');

let setupAvatar = null;
document.getElementById('setupAvatarInput').onchange = async (e) => {
  const file = e.target.files[0]; if(!file) return;
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  setupAvatar = data.url;
  document.getElementById('setupAvatar').innerHTML = `<img src="${data.url}" style="width:100%;height:100%;object-fit:cover">`;
};
document.getElementById('displayNameInput').oninput = (e) => document.getElementById('displayNext').disabled = !e.target.value.trim();
document.getElementById('displayNext').onclick = () => socket.emit('register', { username: document.getElementById('usernameInput').value, displayName: document.getElementById('displayNameInput').value, avatar: setupAvatar });

// === SOCKETS ===
socket.on('registered', (data) => {
  currentUser = data.user; sessionId = data.sessionId;
  localStorage.setItem('elzzmsg_sid', sessionId);
  showScreen('mainScreen');
  if (data.isAdmin) addBotChat();
});
socket.on('error', (d) => alert(d.message));
socket.on('contacts', renderContacts);
socket.on('contact_added', () => { socket.emit('get_contacts', currentUser.id); closeAddContact(); });
socket.on('online_users', (u) => { onlineUsers = u; renderContacts(); });
socket.on('statuses', (s) => { statuses = s; renderStatuses(); });
socket.on('new_status', (s) => { statuses.unshift(s); renderStatuses(); });

function addBotChat() {
  const c = document.getElementById('chatList');
  const i = document.createElement('div');
  i.className = 'chat-item';
  i.onclick = () => openChat('Configurator Bot', 'bot');
  i.innerHTML = `<div class="chat-avatar" style="background:var(--primary)"><svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-2 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg></div><div class="chat-info"><div class="chat-top"><span class="chat-name">Configurator Bot</span></div><div class="chat-preview">Admin commands</div></div>`;
  c.prepend(i);
}

function renderContacts(list) {
  const c = document.getElementById('chatList'); const bot = c.querySelector('.chat-item:first-child');
  c.innerHTML = ''; if (bot) c.appendChild(bot);
  list.forEach(u => {
    const i = document.createElement('div');
    i.className = 'chat-item';
    i.onclick = () => openChat(u.displayName, u.username, u.avatar);
    i.innerHTML = `<div class="chat-avatar">${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">` : '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">${u.displayName}</span><span class="chat-time">${onlineUsers.includes(u.username) ? 'online' : ''}</span></div><div class="chat-preview">Tap to chat</div></div>`;
    c.appendChild(i);
  });
}

// === STATUS ===
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if(tab === 'chats') {
    document.querySelector('.tab:first-child').classList.add('active');
    document.getElementById('chatsView').style.display = 'block';
    document.getElementById('statusView').style.display = 'none';
  } else {
    document.querySelector('.tab:nth-child(2)').classList.add('active');
    document.getElementById('chatsView').style.display = 'none';
    document.getElementById('statusView').style.display = 'block';
    socket.emit('get_statuses');
  }
}

function renderStatuses() {
  const list = document.getElementById('statusList');
  // Keep My Status at top
  const myStatusHtml = list.querySelector('.my-status').outerHTML;
  list.innerHTML = myStatusHtml;

  // Update my status avatar
  if(currentUser && currentUser.avatar) document.getElementById('myStatusAvatar').innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;

  const others = statuses.filter(s => s.userId !== currentUser.id);
  others.forEach(s => {
    const i = document.createElement('div');
    i.className = 'status-item';
    i.onclick = () => viewStatus(s);
    i.innerHTML = `<div class="status-avatar-wrapper"><div class="status-avatar">${s.avatar ? `<img src="${s.avatar}" style="width:100%;height:100%;object-fit:cover">` : ''}</div></div><div class="status-info"><h4>${s.displayName}</h4><p>${new Date(s.time).toLocaleTimeString()}</p></div>`;
    list.appendChild(i);
  });
}

function openMyStatus() { document.getElementById('statusInput').click(); }

document.getElementById('statusInput').onchange = async (e) => {
  const file = e.target.files[0]; if(!file) return;
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  
  const type = data.type.startsWith('video') ? 'video' : 'image';
  socket.emit('post_status', { userId: currentUser.id, url: data.url, type, caption: '' });
};

function viewStatus(s) {
  socket.emit('view_status', { statusId: s.id, viewerUsername: currentUser.username });
  const contentType = s.type === 'video' ? `<video src="${s.url}" controls autoplay style="width:100%;height:100%;object-fit:contain"></video>` : `<img src="${s.url}" style="width:100%;height:100%;object-fit:contain">`;
  
  const overlay = document.createElement('div');
  overlay.className = 'screen active';
  overlay.style.background = '#000';
  overlay.style.zIndex = '2000';
  overlay.innerHTML = `<div style="position:absolute;top:10px;left:10px;display:flex;align-items:center;color:#fff;z-index:2001;padding:10px"><div class="chat-avatar" style="width:30px;height:30px">${s.avatar ? `<img src="${s.avatar}" style="width:100%;height:100%;object-fit:cover">`: ''}</div><span style="margin-left:10px;font-size:14px">${s.displayName}</span></div>${contentType}<button onclick="this.parentElement.remove()" style="position:absolute;top:10px;right:10px;background:none;border:none;color:#fff;font-size:24px;z-index:2001">✕</button>`;
  document.body.appendChild(overlay);
}

// === ADD CONTACT ===
function openAddContact() { document.getElementById('addContactModal').classList.add('active'); document.getElementById('addContactInput').value = ''; }
function closeAddContact() { document.getElementById('addContactModal').classList.remove('active'); }
function addContact() { socket.emit('add_contact', { targetUsername: document.getElementById('addContactInput').value.trim(), userId: currentUser.id }); }

// === CHAT ===
function openChat(name, username, avatar) {
  currentChat = username; showScreen('chatView');
  document.getElementById('chatName').textContent = name;
  document.getElementById('chatStatus').textContent = onlineUsers.includes(username) ? 'online' : 'last seen';
  const av = document.getElementById('chatAvatar');
  if (avatar) av.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover">`;
  else if (username === 'bot') { av.style.background = 'var(--primary)'; av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-2 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg>'; }
  else av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  
  document.getElementById('messagesContainer').innerHTML = '<div class="encryption-notice"><svg viewBox="0 0 10 12" width="10"><path fill="#8696a0" d="M5.009 0C2.793 0 1 1.789 1 4v1C.458 5 0 5.458 0 6v5c0 .542.458 1 1 1h8c.542 0 1-.458 1-1V6c0-.542-.458-1-1-1V4c0-2.211-1.789-4-3.991-4z"/></svg> Messages are end-to-end encrypted.</div>';
  
  if (username === 'bot') appendBotMsg('🤖 Welcome Admin!\n\nCommands:\n/ban (username) (alasan)\n/unban (username)');
  else socket.emit('get_messages', { user1: currentUser.username, user2: username });
}

function backToList() { showScreen('mainScreen'); currentChat = null; }

// === MESSAGES ===
socket.on('messages', (msgs) => { const c = document.getElementById('messagesContainer'); const n = c.querySelector('.encryption-notice'); c.innerHTML = ''; if (n) c.appendChild(n); msgs.forEach(m => appendMsg(m)); scroll(); });
socket.on('receive_message', (m) => { if (currentChat === m.from) { appendMsg(m); scroll(); } });
socket.on('message_sent', (m) => { appendMsg(m); scroll(); });
socket.on('bot_message', (m) => { if (currentChat === 'bot') { appendBotMsg(m.text); scroll(); } });
socket.on('command_result', (d) => { appendSys(d.message); scroll(); });

function appendMsg(m) {
  const c = document.getElementById('messagesContainer');
  const el = document.createElement('div');
  const out = m.from === currentUser?.username;
  el.className = `message ${out ? 'out' : 'in'}`;
  const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div class="message-bubble"><span class="message-text">${m.text}</span><span class="message-meta"><span class="message-time">${time}</span></span></div>`;
  c.appendChild(el);
}
function appendBotMsg(t) { const c = document.getElementById('messagesContainer'); const el = document.createElement('div'); el.className = 'message in'; el.innerHTML = `<div class="message-bubble"><span class="message-text" style="white-space:pre-wrap">${t}</span></div>`; c.appendChild(el); }
function appendSys(t) { const c = document.getElementById('messagesContainer'); const el = document.createElement('div'); el.className = 'encryption-notice'; el.innerHTML = `<span>${t}</span>`; c.appendChild(el); }
function scroll() { const c = document.getElementById('messagesContainer'); c.scrollTop = c.scrollHeight; }

// === SEND ===
function toggleSend() { const v = document.getElementById('messageInput').value.trim(); document.getElementById('sendBtn').classList.toggle('active', !!v); document.getElementById('voiceBtn').style.display = v ? 'none' : 'block'; }
document.getElementById('messageInput').oninput = () => { toggleSend(); socket.emit('typing', { from: currentUser.username, to: currentChat, isTyping: true }); };
document.getElementById('messageInput').onblur = () => socket.emit('typing', { from: currentUser.username, to: currentChat, isTyping: false });
document.getElementById('messageInput').onkeypress = (e) => { if (e.key === 'Enter') send(); };

function send() {
  const t = document.getElementById('messageInput').value.trim(); if (!t || !currentChat) return;
  socket.emit('send_message', { from: currentUser.username, to: currentChat, text: t });
  document.getElementById('messageInput').value = ''; toggleSend();
}

document.getElementById('fileInput').onchange = async (e) => {
  const f = e.target.files[0]; if (!f || !currentChat) return;
  const fd = new FormData(); fd.append('file', f);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const d = await res.json();
  socket.emit('send_message', { from: currentUser.username, to: currentChat, text: f.name, type: 'image', mediaUrl: d.url });
};

socket.on('typing', (d) => { document.getElementById('typingIndicator').classList.toggle('active', d.isTyping && d.from === currentChat); });

// === PROFILE ===
function openProfile() { if (!currentUser) return; document.getElementById('profileName').value = currentUser.displayName; document.getElementById('profileBio').value = currentUser.bio || ''; document.getElementById('profileUsername').value = currentUser.username; document.getElementById('profileAvatar').innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">` : ''; document.getElementById('profileModal').classList.add('active'); }
function closeProfile() { document.getElementById('profileModal').classList.remove('active'); }
document.getElementById('avatarInput').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const res = await fetch('/upload', { method: 'POST', body: fd }); const d = await res.json(); currentUser.avatar = d.url; document.getElementById('profileAvatar').innerHTML = `<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`; };
function saveProfile() { socket.emit('update_profile', { userId: currentUser.id, displayName: document.getElementById('profileName').value, bio: document.getElementById('profileBio').value, avatar: currentUser.avatar }); closeProfile(); }
socket.on('profile_updated', (u) => currentUser = u);  let v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  e.target.value = v;
  document.getElementById('usernameNext').disabled = v.length < 3;
};
document.getElementById('usernameNext').onclick = () => showScreen('displayNameScreen');

// Display Name & Reg
let setupAvatar = null;
document.getElementById('setupAvatarInput').onchange = async (e) => {
  const file = e.target.files[0]; if(!file) return;
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  setupAvatar = data.url;
  document.getElementById('setupAvatar').innerHTML = `<img src="${data.url}" style="width:100%;height:100%;object-fit:cover">`;
};
document.getElementById('displayNameInput').oninput = (e) => document.getElementById('displayNext').disabled = !e.target.value.trim();
document.getElementById('displayNext').onclick = () => socket.emit('register', { username: document.getElementById('usernameInput').value, displayName: document.getElementById('displayNameInput').value, avatar: setupAvatar });

// Sockets
socket.on('registered', (data) => {
  currentUser = data.user; sessionId = data.sessionId;
  localStorage.setItem('elzzmsg_sid', sessionId);
  showScreen('mainScreen');
  if (data.isAdmin) addBotChat();
});
socket.on('error', (d) => alert(d.message));
socket.on('contacts', renderContacts);
socket.on('contact_added', () => { socket.emit('get_contacts', currentUser.id); closeAddContact(); });
socket.on('online_users', (u) => { onlineUsers = u; renderContacts(); });

function addBotChat() {
  const c = document.getElementById('chatList');
  const i = document.createElement('div');
  i.className = 'chat-item';
  i.onclick = () => openChat('Configurator Bot', 'bot');
  i.innerHTML = `<div class="chat-avatar" style="background:var(--primary)"><svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-2 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg></div><div class="chat-info"><div class="chat-top"><span class="chat-name">Configurator Bot</span></div><div class="chat-preview">Admin commands</div></div>`;
  c.prepend(i);
}

function renderContacts(list) {
  const c = document.getElementById('chatList'); const bot = c.querySelector('.chat-item:first-child');
  c.innerHTML = ''; if (bot) c.appendChild(bot);
  list.forEach(u => {
    const i = document.createElement('div');
    i.className = 'chat-item';
    i.onclick = () => openChat(u.displayName, u.username, u.avatar);
    i.innerHTML = `<div class="chat-avatar">${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">` : '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">${u.displayName}</span><span class="chat-time">${onlineUsers.includes(u.username) ? 'online' : ''}</span></div><div class="chat-preview">Tap to chat</div></div>`;
    c.appendChild(i);
  });
}

// Add Contact
function openAddContact() { document.getElementById('addContactModal').classList.add('active'); document.getElementById('addContactInput').value = ''; }
function closeAddContact() { document.getElementById('addContactModal').classList.remove('active'); }
function addContact() { socket.emit('add_contact', { targetUsername: document.getElementById('addContactInput').value.trim(), userId: currentUser.id }); }

// Chat
function openChat(name, username, avatar) {
  currentChat = username; showScreen('chatView');
  document.getElementById('chatName').textContent = name;
  document.getElementById('chatStatus').textContent = onlineUsers.includes(username) ? 'online' : 'last seen';
  const av = document.getElementById('chatAvatar');
  if (avatar) av.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover">`;
  else if (username === 'bot') { av.style.background = 'var(--primary)'; av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#fff" d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-2 12a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg>'; }
  else av.innerHTML = '<svg viewBox="0 0 24 24" width="30"><path fill="#8696a0" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  
  document.getElementById('messagesContainer').innerHTML = '<div class="encryption-notice"><svg viewBox="0 0 10 12" width="10"><path fill="#8696a0" d="M5.009 0C2.793 0 1 1.789 1 4v1C.458 5 0 5.458 0 6v5c0 .542.458 1 1 1h8c.542 0 1-.458 1-1V6c0-.542-.458-1-1-1V4c0-2.211-1.789-4-3.991-4z"/></svg> Messages are end-to-end encrypted.</div>';
  
  if (username === 'bot') appendBotMsg('🤖 Welcome Admin!\n\nCommands:\n/ban (username)\n/unban (username)');
  else socket.emit('get_messages', { user1: currentUser.username, user2: username });
}

function backToList() { showScreen('mainScreen'); currentChat = null; }

// Messages
socket.on('messages', (msgs) => { const c = document.getElementById('messagesContainer'); const n = c.querySelector('.encryption-notice'); c.innerHTML = ''; if (n) c.appendChild(n); msgs.forEach(m => appendMsg(m)); scroll(); });
socket.on('receive_message', (m) => { if (currentChat === m.from) { appendMsg(m); scroll(); } });
socket.on('message_sent', (m) => { appendMsg(m); scroll(); });
socket.on('bot_message', (m) => { if (currentChat === 'bot') { appendBotMsg(m.text); scroll(); } });
socket.on('command_result', (d) => { appendSys(d.message); scroll(); });

function appendMsg(m) {
  const c = document.getElementById('messagesContainer');
  const el = document.createElement('div');
  const out = m.from === currentUser?.username;
  el.className = `message ${out ? 'out' : 'in'}`;
  const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div class="message-bubble"><span class="message-text">${m.text}</span><span class="message-meta"><span class="message-time">${time}</span></span></div>`;
  c.appendChild(el);
}
function appendBotMsg(t) { const c = document.getElementById('messagesContainer'); const el = document.createElement('div'); el.className = 'message in'; el.innerHTML = `<div class="message-bubble"><span class="message-text" style="white-space:pre-wrap">${t}</span></div>`; c.appendChild(el); }
function appendSys(t) { const c = document.getElementById('messagesContainer'); const el = document.createElement('div'); el.className = 'encryption-notice'; el.innerHTML = `<span>${t}</span>`; c.appendChild(el); }
function scroll() { const c = document.getElementById('messagesContainer'); c.scrollTop = c.scrollHeight; }

// Send
function toggleSend() { const v = document.getElementById('messageInput').value.trim(); document.getElementById('sendBtn').classList.toggle('active', !!v); document.getElementById('voiceBtn').style.display = v ? 'none' : 'block'; }
document.getElementById('messageInput').oninput = () => { toggleSend(); socket.emit('typing', { from: currentUser.username, to: currentChat, isTyping: true }); };
document.getElementById('messageInput').onblur = () => socket.emit('typing', { from: currentUser.username, to: currentChat, isTyping: false });
document.getElementById('messageInput').onkeypress = (e) => { if (e.key === 'Enter') send(); };

function send() {
  const t = document.getElementById('messageInput').value.trim(); if (!t || !currentChat) return;
  socket.emit('send_message', { from: currentUser.username, to: currentChat, text: t });
  document.getElementById('messageInput').value = ''; toggleSend();
}

// File
document.getElementById('fileInput').onchange = async (e) => {
  const f = e.target.files[0]; if (!f || !currentChat) return;
  const fd = new FormData(); fd.append('file', f);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const d = await res.json();
  socket.emit('send_message', { from: currentUser.username, to: currentChat, text: f.name, type: 'image', mediaUrl: d.url });
};

// Typing
socket.on('typing', (d) => { document.getElementById('typingIndicator').classList.toggle('active', d.isTyping && d.from === currentChat); });

// Profile
function openProfile() { if (!currentUser) return; document.getElementById('profileName').value = currentUser.displayName; document.getElementById('profileBio').value = currentUser.bio || ''; document.getElementById('profileAvatar').innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">` : ''; document.getElementById('profileModal').classList.add('active'); }
function closeProfile() { document.getElementById('profileModal').classList.remove('active'); }
document.getElementById('avatarInput').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const res = await fetch('/upload', { method: 'POST', body: fd }); const d = await res.json(); currentUser.avatar = d.url; document.getElementById('profileAvatar').innerHTML = `<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`; };
function saveProfile() { socket.emit('update_profile', { userId: currentUser.id, displayName: document.getElementById('profileName').value, bio: document.getElementById('profileBio').value, avatar: currentUser.avatar }); closeProfile(); }
socket.on('profile_updated', (u) => currentUser = u);
socket.on('banned', (d) => { alert(d.message); localStorage.clear(); location.reload(); });
