const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === DATABASE JSON ===
const DB_FILE = 'elzzmsg_db.json';

function initDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: {}, sessions: {}, contacts: [], messages: [], banned: [], statuses: []
    }, null, 2));
  }
}

function getDB() {
  if (!fs.existsSync(DB_FILE)) initDB();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } 
  catch (e) { initDB(); return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
}

function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

initDB();

// === STORAGE ===
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

const ADMIN_USERNAME = process.env.ADMIN_USER || 'fxosss';
let onlineUsers = {}; 

// === MIDDLEWARE ===
app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (!/Android|iPhone|iPad|iPod/i.test(ua) && req.path === '/') {
    return res.send('<html><body style="background:#111b21;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>📵 Mobile Only</h1></div></body></html>');
  }
  next();
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});
app.post('/upload-voice', upload.single('voice'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No voice' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.post('/api/check-session', (req, res) => {
  const { sessionId } = req.body;
  const db = getDB();
  const session = db.sessions[sessionId];
  if (!session) return res.json({ valid: false });
  const user = db.users[session.userId];
  if (!user) return res.json({ valid: false });
  const banData = db.banned.find(b => b.username === user.username);
  if (banData) return res.json({ valid: false, banned: true, banData });
  res.json({ valid: true, user: { ...user, password: undefined } });
});

// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (data) => {
    const db = getDB();
    const { username, displayName, bio, avatar, sessionId } = data;

    if (sessionId && db.sessions[sessionId]) {
      const userId = db.sessions[sessionId].userId;
      const user = db.users[userId];
      if (user) {
        const banData = db.banned.find(b => b.username === user.username);
        if (banData) return socket.emit('banned', { bannedBy: banData.bannedBy, reason: banData.reason });
        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin: user.isAdmin, sessionId });
        sendUserContacts(socket, userId);
        sendStatuses(socket);
        broadcastOnlineUsers();
        return;
      }
    }

    if (!username || username.length < 3) return socket.emit('error', { message: 'Username minimal 3 karakter' });
    const userExists = Object.values(db.users).find(u => u.username === username);
    if (userExists) return socket.emit('error', { message: 'Username sudah digunakan' });

    const userId = uuidv4();
    const isAdmin = username === ADMIN_USERNAME ? 1 : 0;
    const newSessionId = uuidv4();
    const newUser = { id: userId, username, displayName: displayName || username, bio: bio || 'Hey! I using ElzzMsg', avatar: avatar || null, isAdmin };

    db.users[userId] = newUser;
    db.sessions[newSessionId] = { userId };
    saveDB(db);

    onlineUsers[socket.id] = { ...newUser, socketId: socket.id, online: true };
    socket.emit('registered', { success: true, user: newUser, isAdmin, sessionId: newSessionId });
    if (isAdmin) socket.emit('bot_message', { from: 'Configurator Bot', text: `🤖 Welcome Admin!\n\nCommands:\n/ban (username) (alasan)\n/unban (username)` });
    broadcastOnlineUsers();
  });

  socket.on('add_contact', (data) => {
    const { targetUsername, userId } = data;
    const db = getDB();
    const user = db.users[userId];
    if (!user) return socket.emit('error', { message: 'Invalid user' });
    const targetEntry = Object.entries(db.users).find(([id, u]) => u.username === targetUsername);
    if (!targetEntry) return socket.emit('error', { message: 'Username tidak ditemukan' });
    const [targetId, targetUser] = targetEntry;
    if (targetUser.username === user.username) return socket.emit('error', { message: 'Gak bisa add diri sendiri' });
    const exists = db.contacts.find(c => c.userId === userId && c.contactUsername === targetUsername);
    if (!exists) { db.contacts.push({ userId, contactUsername: targetUsername }); saveDB(db); }
    sendUserContacts(socket, userId);
    socket.emit('contact_added', { success: true });
  });

  socket.on('get_contacts', (userId) => sendUserContacts(socket, userId));

  // === MESSAGING (AUTO SAVE CHAT) ===
  socket.on('send_message', (data) => {
    const db = getDB();
    const { from, to, text, type, mediaUrl, mediaType } = data;
    
    const fromUser = Object.values(db.users).find(u => u.username === from);
    if (!fromUser) return;

    // Admin Commands
    if (fromUser.isAdmin && text && text.startsWith('/')) {
      const args = text.split(' ');
      const cmd = args[0];
      const targetUser = args[1];
      const reason = args.slice(2).join(' ') || 'No reason';

      if (cmd === '/ban' && targetUser) {
        db.banned = db.banned.filter(b => b.username !== targetUser);
        db.banned.push({ username: targetUser, reason: reason, bannedBy: fromUser.username });
        saveDB(db);
        const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
        if (targetSocket) io.to(targetSocket.socketId).emit('banned', { bannedBy: fromUser.username, reason: reason });
        socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-ban.\nAlasan: ${reason}` });
        return;
      }
      if (cmd === '/unban' && targetUser) {
        const index = db.banned.findIndex(b => b.username === targetUser);
        if (index !== -1) {
          db.banned.splice(index, 1);
          saveDB(db);
          const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
          if (targetSocket) io.to(targetSocket.socketId).emit('unbanned');
          socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-unban.` });
        } else { socket.emit('command_result', { message: `User ${targetUser} tidak di-ban.` }); }
        return;
      }
    }

    // Auto Save Contact
    const senderId = fromUser.id;
    const recipientUser = db.users[to] || Object.values(db.users).find(u => u.username === to);
    
    if (recipientUser) {
        if (!db.contacts.find(c => c.userId === senderId && c.contactUsername === to)) {
            db.contacts.push({ userId: senderId, contactUsername: to });
        }
        if (!db.contacts.find(c => c.userId === recipientUser.id && c.contactUsername === from)) {
            db.contacts.push({ userId: recipientUser.id, contactUsername: from });
        }
        saveDB(db);
        const senderSocket = onlineUsers[socket.id];
        if(senderSocket) sendUserContacts(socket, senderId);
        
        const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
        if (recipientSocket) {
            const recSocketInst = io.sockets.sockets.get(recipientSocket.socketId);
            if(recSocketInst) sendUserContacts(recSocketInst, recipientUser.id);
        }
    }

    const msg = { id: uuidv4(), from, to, text, type: type || 'text', mediaUrl, mediaType, time: new Date().toISOString(), status: 'sent' };
    db.messages.push(msg);
    saveDB(db);
    
    const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
    if (recipientSocket) io.to(recipientSocket.socketId).emit('receive_message', msg);
    socket.emit('message_sent', msg);
  });

  socket.on('get_messages', (data) => {
    const db = getDB();
    const { user1, user2 } = data;
    const msgs = db.messages.filter(m => (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1));
    socket.emit('messages', msgs);
  });

  socket.on('typing', (data) => {
    const recipient = Object.values(onlineUsers).find(u => u.username === data.to);
    if (recipient) io.to(recipient.socketId).emit('typing', data);
  });

  socket.on('update_profile', (data) => {
    const db = getDB();
    const user = db.users[data.userId];
    if (user) {
      user.displayName = data.displayName; user.bio = data.bio; user.avatar = data.avatar;
      saveDB(db);
      if (onlineUsers[socket.id]) onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
      socket.emit('profile_updated', user);
    }
  });

  socket.on('post_status', (data) => {
    const db = getDB();
    const { userId, url, type, caption } = data;
    const user = db.users[userId];
    if (!user) return;
    const status = { id: uuidv4(), userId, username: user.username, displayName: user.displayName, avatar: user.avatar, url, type, caption, time: new Date().toISOString(), viewers: [] };
    db.statuses.push(status);
    saveDB(db);
    io.emit('new_status', status);
  });

  socket.on('get_statuses', () => sendStatuses(socket));
  socket.on('view_status', (data) => {
    const db = getDB();
    const status = db.statuses.find(s => s.id === data.statusId);
    if (status && !status.viewers.includes(data.viewerUsername)) { status.viewers.push(data.viewerUsername); saveDB(db); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastOnlineUsers(); });

  function sendUserContacts(targetSocket, userId) {
    if (!targetSocket) return;
    const db = getDB();
    const userContacts = db.contacts.filter(c => c.userId === userId).map(c => {
      const contactUser = Object.values(db.users).find(u => u.username === c.contactUsername);
      return contactUser ? { ...contactUser, password: undefined } : null;
    }).filter(Boolean);
    targetSocket.emit('contacts', userContacts);
  }

  function sendStatuses(socket) {
    const db = getDB();
    const now = new Date();
    const validStatuses = db.statuses.filter(s => (now - new Date(s.time)) < 86400000);
    socket.emit('statuses', validStatuses);
  }

  function broadcastOnlineUsers() { io.emit('online_users', Object.values(onlineUsers).map(u => u.username)); }
});

// === GCC: AUTO CLEANUP ===
function runGCC() {
  const db = getDB();
  const now = new Date();
  const lifespan = 86400000; 
  db.statuses = db.statuses.filter(s => (now - new Date(s.time)) < lifespan);
  db.messages = db.messages.filter(m => (now - new Date(m.time)) < lifespan);
  saveDB(db);
}
runGCC();
setInterval(runGCC, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg running on port ' + PORT));
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

const ADMIN_USERNAME = process.env.ADMIN_USER || 'elzzellz';
let onlineUsers = {}; 

// === MIDDLEWARE ===
app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (!/Android|iPhone|iPad|iPod/i.test(ua) && req.path === '/') {
    return res.send('<html><body style="background:#111b21;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>📵 Mobile Only</h1></div></body></html>');
  }
  next();
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});
app.post('/upload-voice', upload.single('voice'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No voice' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.post('/api/check-session', (req, res) => {
  const { sessionId } = req.body;
  const db = getDB();
  const session = db.sessions[sessionId];
  if (!session) return res.json({ valid: false });
  const user = db.users[session.userId];
  if (!user) return res.json({ valid: false });
  const banData = db.banned.find(b => b.username === user.username);
  if (banData) return res.json({ valid: false, banned: true, banData });
  res.json({ valid: true, user: { ...user, password: undefined } });
});

// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (data) => {
    const db = getDB();
    const { username, displayName, bio, avatar, sessionId } = data;

    if (sessionId && db.sessions[sessionId]) {
      const userId = db.sessions[sessionId].userId;
      const user = db.users[userId];
      if (user) {
        const banData = db.banned.find(b => b.username === user.username);
        if (banData) return socket.emit('banned', { bannedBy: banData.bannedBy, reason: banData.reason });
        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin: user.isAdmin, sessionId });
        sendUserContacts(socket, userId);
        sendStatuses(socket);
        broadcastOnlineUsers();
        return;
      }
    }

    if (!username || username.length < 3) return socket.emit('error', { message: 'Username minimal 3 karakter' });
    const userExists = Object.values(db.users).find(u => u.username === username);
    if (userExists) return socket.emit('error', { message: 'Username sudah digunakan' });

    const userId = uuidv4();
    const isAdmin = username === ADMIN_USERNAME ? 1 : 0;
    const newSessionId = uuidv4();
    const newUser = { id: userId, username, displayName: displayName || username, bio: bio || 'Hey! I using ElzzMsg', avatar: avatar || null, isAdmin };

    db.users[userId] = newUser;
    db.sessions[newSessionId] = { userId };
    saveDB(db);

    onlineUsers[socket.id] = { ...newUser, socketId: socket.id, online: true };
    socket.emit('registered', { success: true, user: newUser, isAdmin, sessionId: newSessionId });
    if (isAdmin) socket.emit('bot_message', { from: 'Configurator Bot', text: `🤖 Welcome Admin!\n\nCommands:\n/ban (username) (alasan)\n/unban (username)` });
    broadcastOnlineUsers();
  });

  socket.on('add_contact', (data) => {
    const { targetUsername, userId } = data;
    const db = getDB();
    const user = db.users[userId];
    if (!user) return socket.emit('error', { message: 'Invalid user' });
    const targetEntry = Object.entries(db.users).find(([id, u]) => u.username === targetUsername);
    if (!targetEntry) return socket.emit('error', { message: 'Username tidak ditemukan' });
    const [targetId, targetUser] = targetEntry;
    if (targetUser.username === user.username) return socket.emit('error', { message: 'Gak bisa add diri sendiri' });
    const exists = db.contacts.find(c => c.userId === userId && c.contactUsername === targetUsername);
    if (!exists) { db.contacts.push({ userId, contactUsername: targetUsername }); saveDB(db); }
    sendUserContacts(socket, userId);
    socket.emit('contact_added', { success: true });
  });

  socket.on('get_contacts', (userId) => sendUserContacts(socket, userId));

  // === MESSAGING (AUTO SAVE CHAT) ===
  socket.on('send_message', (data) => {
    const db = getDB();
    const { from, to, text, type, mediaUrl, mediaType } = data;
    
    const fromUser = Object.values(db.users).find(u => u.username === from);
    if (!fromUser) return;

    // Admin Commands
    if (fromUser.isAdmin && text && text.startsWith('/')) {
      const args = text.split(' ');
      const cmd = args[0];
      const targetUser = args[1];
      const reason = args.slice(2).join(' ') || 'No reason';

      if (cmd === '/ban' && targetUser) {
        db.banned = db.banned.filter(b => b.username !== targetUser);
        db.banned.push({ username: targetUser, reason: reason, bannedBy: fromUser.username });
        saveDB(db);
        const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
        if (targetSocket) io.to(targetSocket.socketId).emit('banned', { bannedBy: fromUser.username, reason: reason });
        socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-ban.\nAlasan: ${reason}` });
        return;
      }
      if (cmd === '/unban' && targetUser) {
        const index = db.banned.findIndex(b => b.username === targetUser);
        if (index !== -1) {
          db.banned.splice(index, 1);
          saveDB(db);
          const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
          if (targetSocket) io.to(targetSocket.socketId).emit('unbanned');
          socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-unban.` });
        } else { socket.emit('command_result', { message: `User ${targetUser} tidak di-ban.` }); }
        return;
      }
    }

    // Auto Save Contact Logic
    const senderId = fromUser.id;
    const recipientUser = db.users[to] || Object.values(db.users).find(u => u.username === to);
    
    if (recipientUser) {
        if (!db.contacts.find(c => c.userId === senderId && c.contactUsername === to)) {
            db.contacts.push({ userId: senderId, contactUsername: to });
        }
        if (!db.contacts.find(c => c.userId === recipientUser.id && c.contactUsername === from)) {
            db.contacts.push({ userId: recipientUser.id, contactUsername: from });
        }
        saveDB(db);
        const senderSocket = onlineUsers[socket.id];
        if(senderSocket) sendUserContacts(socket, senderId);
        
        const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
        if (recipientSocket) {
            sendUserContacts(io.sockets.sockets.get(recipientSocket.socketId), recipientUser.id);
        }
    }

    const msg = { id: uuidv4(), from, to, text, type: type || 'text', mediaUrl, mediaType, time: new Date().toISOString(), status: 'sent' };
    db.messages.push(msg);
    saveDB(db);
    
    const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
    if (recipientSocket) io.to(recipientSocket.socketId).emit('receive_message', msg);
    socket.emit('message_sent', msg);
  });

  socket.on('get_messages', (data) => {
    const db = getDB();
    const { user1, user2 } = data;
    const msgs = db.messages.filter(m => (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1));
    socket.emit('messages', msgs);
  });

  socket.on('typing', (data) => {
    const recipient = Object.values(onlineUsers).find(u => u.username === data.to);
    if (recipient) io.to(recipient.socketId).emit('typing', data);
  });

  socket.on('update_profile', (data) => {
    const db = getDB();
    const user = db.users[data.userId];
    if (user) {
      user.displayName = data.displayName; user.bio = data.bio; user.avatar = data.avatar;
      saveDB(db);
      if (onlineUsers[socket.id]) onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
      socket.emit('profile_updated', user);
    }
  });

  socket.on('post_status', (data) => {
    const db = getDB();
    const { userId, url, type, caption } = data;
    const user = db.users[userId];
    if (!user) return;
    const status = { id: uuidv4(), userId, username: user.username, displayName: user.displayName, avatar: user.avatar, url, type, caption, time: new Date().toISOString(), viewers: [] };
    db.statuses.push(status);
    saveDB(db);
    io.emit('new_status', status);
  });

  socket.on('get_statuses', () => sendStatuses(socket));
  socket.on('view_status', (data) => {
    const db = getDB();
    const status = db.statuses.find(s => s.id === data.statusId);
    if (status && !status.viewers.includes(data.viewerUsername)) { status.viewers.push(data.viewerUsername); saveDB(db); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastOnlineUsers(); });

  function sendUserContacts(targetSocket, userId) {
    const db = getDB();
    const userContacts = db.contacts.filter(c => c.userId === userId).map(c => {
      const contactUser = Object.values(db.users).find(u => u.username === c.contactUsername);
      return contactUser ? { ...contactUser, password: undefined } : null;
    }).filter(Boolean);
    targetSocket.emit('contacts', userContacts);
  }

  function sendStatuses(socket) {
    const db = getDB();
    const now = new Date();
    const validStatuses = db.statuses.filter(s => (now - new Date(s.time)) < 86400000);
    socket.emit('statuses', validStatuses);
  }

  function broadcastOnlineUsers() { io.emit('online_users', Object.values(onlineUsers).map(u => u.username)); }
});

// === GCC: AUTO CLEANUP ===
function runGCC() {
  const db = getDB();
  const now = new Date();
  const lifespan = 86400000; 
  db.statuses = db.statuses.filter(s => (now - new Date(s.time)) < lifespan);
  db.messages = db.messages.filter(m => (now - new Date(m.time)) < lifespan);
  saveDB(db);
}
runGCC();
setInterval(runGCC, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg running on port ' + PORT));
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

const ADMIN_USERNAME = process.env.ADMIN_USER || 'fxosss';
let onlineUsers = {}; 

// === MIDDLEWARE ===
app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (!/Android|iPhone|iPad|iPod/i.test(ua) && req.path === '/') {
    return res.send('<html><body style="background:#111b21;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>📵 Mobile Only</h1></div></body></html>');
  }
  next();
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});
app.post('/upload-voice', upload.single('voice'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No voice' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.post('/api/check-session', (req, res) => {
  const { sessionId } = req.body;
  const db = getDB();
  const session = db.sessions[sessionId];
  if (!session) return res.json({ valid: false });
  const user = db.users[session.userId];
  if (!user) return res.json({ valid: false });
  const banData = db.banned.find(b => b.username === user.username);
  if (banData) return res.json({ valid: false, banned: true, banData });
  res.json({ valid: true, user: { ...user, password: undefined } });
});

// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (data) => {
    const db = getDB();
    const { username, displayName, bio, avatar, sessionId } = data;

    if (sessionId && db.sessions[sessionId]) {
      const userId = db.sessions[sessionId].userId;
      const user = db.users[userId];
      if (user) {
        const banData = db.banned.find(b => b.username === user.username);
        if (banData) return socket.emit('banned', { bannedBy: banData.bannedBy, reason: banData.reason });
        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin: user.isAdmin, sessionId });
        sendUserContacts(socket, userId);
        sendStatuses(socket);
        broadcastOnlineUsers();
        return;
      }
    }

    if (!username || username.length < 3) return socket.emit('error', { message: 'Username minimal 3 karakter' });
    const userExists = Object.values(db.users).find(u => u.username === username);
    if (userExists) return socket.emit('error', { message: 'Username sudah digunakan' });

    const userId = uuidv4();
    const isAdmin = username === ADMIN_USERNAME ? 1 : 0;
    const newSessionId = uuidv4();
    const newUser = { id: userId, username, displayName: displayName || username, bio: bio || 'Hey! I using ElzzMsg', avatar: avatar || null, isAdmin };

    db.users[userId] = newUser;
    db.sessions[newSessionId] = { userId };
    saveDB(db);

    onlineUsers[socket.id] = { ...newUser, socketId: socket.id, online: true };
    socket.emit('registered', { success: true, user: newUser, isAdmin, sessionId: newSessionId });
    if (isAdmin) socket.emit('bot_message', { from: 'Configurator Bot', text: `🤖 Welcome Admin!\n\nCommands:\n/ban (username) (alasan)\n/unban (username)` });
    broadcastOnlineUsers();
  });

  socket.on('add_contact', (data) => {
    const { targetUsername, userId } = data;
    const db = getDB();
    const user = db.users[userId];
    if (!user) return socket.emit('error', { message: 'Invalid user' });
    const targetEntry = Object.entries(db.users).find(([id, u]) => u.username === targetUsername);
    if (!targetEntry) return socket.emit('error', { message: 'Username tidak ditemukan' });
    const [targetId, targetUser] = targetEntry;
    if (targetUser.username === user.username) return socket.emit('error', { message: 'Gak bisa add diri sendiri' });
    const exists = db.contacts.find(c => c.userId === userId && c.contactUsername === targetUsername);
    if (!exists) { db.contacts.push({ userId, contactUsername: targetUsername }); saveDB(db); }
    sendUserContacts(socket, userId);
    socket.emit('contact_added', { success: true });
  });

  socket.on('get_contacts', (userId) => sendUserContacts(socket, userId));

  // === MESSAGING (AUTO SAVE CHAT) ===
  socket.on('send_message', (data) => {
    const db = getDB();
    const { from, to, text, type, mediaUrl, mediaType } = data;
    
    const fromUser = Object.values(db.users).find(u => u.username === from);
    if (!fromUser) return;

    // Admin Commands
    if (fromUser.isAdmin && text && text.startsWith('/')) {
      const args = text.split(' ');
      const cmd = args[0];
      const targetUser = args[1];
      const reason = args.slice(2).join(' ') || 'No reason';

      if (cmd === '/ban' && targetUser) {
        db.banned = db.banned.filter(b => b.username !== targetUser);
        db.banned.push({ username: targetUser, reason: reason, bannedBy: fromUser.username });
        saveDB(db);
        const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
        if (targetSocket) io.to(targetSocket.socketId).emit('banned', { bannedBy: fromUser.username, reason: reason });
        socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-ban.\nAlasan: ${reason}` });
        return;
      }
      if (cmd === '/unban' && targetUser) {
        const index = db.banned.findIndex(b => b.username === targetUser);
        if (index !== -1) {
          db.banned.splice(index, 1);
          saveDB(db);
          const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
          if (targetSocket) io.to(targetSocket.socketId).emit('unbanned');
          socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-unban.` });
        } else { socket.emit('command_result', { message: `User ${targetUser} tidak di-ban.` }); }
        return;
      }
    }

    // === LOGIC AUTO SAVE CONTACT ===
    // Jika mengirim pesan ke orang yang belum di contact list, otomatis tambahkan
    const senderId = fromUser.id;
    const recipientUser = db.users[to] || Object.values(db.users).find(u => u.username === to);
    
    if (recipientUser) {
        // Add recipient to sender's contact
        if (!db.contacts.find(c => c.userId === senderId && c.contactUsername === to)) {
            db.contacts.push({ userId: senderId, contactUsername: to });
        }
        // Add sender to recipient's contact
        if (!db.contacts.find(c => c.userId === recipientUser.id && c.contactUsername === from)) {
            db.contacts.push({ userId: recipientUser.id, contactUsername: from });
        }
        saveDB(db);
        // Update contact list for both if online
        const senderSocket = onlineUsers[socket.id];
        if(senderSocket) sendUserContacts(socket, senderId);
        
        const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
        if (recipientSocket) {
            sendUserContacts(io.sockets.sockets.get(recipientSocket.socketId), recipientUser.id);
        }
    }
    // ================================

    const msg = { id: uuidv4(), from, to, text, type: type || 'text', mediaUrl, mediaType, time: new Date().toISOString(), status: 'sent' };
    db.messages.push(msg);
    saveDB(db);
    
    const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
    if (recipientSocket) io.to(recipientSocket.socketId).emit('receive_message', msg);
    socket.emit('message_sent', msg);
  });

  socket.on('get_messages', (data) => {
    const db = getDB();
    const { user1, user2 } = data;
    const msgs = db.messages.filter(m => (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1));
    socket.emit('messages', msgs);
  });

  socket.on('typing', (data) => {
    const recipient = Object.values(onlineUsers).find(u => u.username === data.to);
    if (recipient) io.to(recipient.socketId).emit('typing', data);
  });

  socket.on('update_profile', (data) => {
    const db = getDB();
    const user = db.users[data.userId];
    if (user) {
      user.displayName = data.displayName; user.bio = data.bio; user.avatar = data.avatar;
      saveDB(db);
      if (onlineUsers[socket.id]) onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
      socket.emit('profile_updated', user);
    }
  });

  socket.on('post_status', (data) => {
    const db = getDB();
    const { userId, url, type, caption } = data;
    const user = db.users[userId];
    if (!user) return;
    const status = { id: uuidv4(), userId, username: user.username, displayName: user.displayName, avatar: user.avatar, url, type, caption, time: new Date().toISOString(), viewers: [] };
    db.statuses.push(status);
    saveDB(db);
    io.emit('new_status', status);
  });

  socket.on('get_statuses', () => sendStatuses(socket));
  socket.on('view_status', (data) => {
    const db = getDB();
    const status = db.statuses.find(s => s.id === data.statusId);
    if (status && !status.viewers.includes(data.viewerUsername)) { status.viewers.push(data.viewerUsername); saveDB(db); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastOnlineUsers(); });

  function sendUserContacts(targetSocket, userId) {
    const db = getDB();
    const userContacts = db.contacts.filter(c => c.userId === userId).map(c => {
      const contactUser = Object.values(db.users).find(u => u.username === c.contactUsername);
      return contactUser ? { ...contactUser, password: undefined } : null;
    }).filter(Boolean);
    targetSocket.emit('contacts', userContacts);
  }

  function sendStatuses(socket) {
    const db = getDB();
    const now = new Date();
    const validStatuses = db.statuses.filter(s => (now - new Date(s.time)) < 86400000);
    socket.emit('statuses', validStatuses);
  }

  function broadcastOnlineUsers() { io.emit('online_users', Object.values(onlineUsers).map(u => u.username)); }
});

// === GCC: AUTO CLEANUP ===
function runGCC() {
  const db = getDB();
  const now = new Date();
  const lifespan = 86400000; 
  db.statuses = db.statuses.filter(s => (now - new Date(s.time)) < lifespan);
  db.messages = db.messages.filter(m => (now - new Date(m.time)) < lifespan);
  saveDB(db);
}
runGCC();
setInterval(runGCC, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg running on port ' + PORT));
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

const ADMIN_USERNAME = process.env.ADMIN_USER || 'fxosss';
let onlineUsers = {}; 

// === MIDDLEWARE ===
app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (!/Android|iPhone|iPad|iPod/i.test(ua) && req.path === '/') {
    return res.send('<html><body style="background:#111b21;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>📵 Mobile Only</h1></div></body></html>');
  }
  next();
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});
app.post('/upload-voice', upload.single('voice'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No voice' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.post('/api/check-session', (req, res) => {
  const { sessionId } = req.body;
  const db = getDB();
  const session = db.sessions[sessionId];
  if (!session) return res.json({ valid: false });
  const user = db.users[session.userId];
  if (!user) return res.json({ valid: false });
  const banData = db.banned.find(b => b.username === user.username);
  if (banData) return res.json({ valid: false, banned: true, banData });
  res.json({ valid: true, user: { ...user, password: undefined } });
});

// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (data) => {
    const db = getDB();
    const { username, displayName, bio, avatar, sessionId } = data;

    if (sessionId && db.sessions[sessionId]) {
      const userId = db.sessions[sessionId].userId;
      const user = db.users[userId];
      if (user) {
        const banData = db.banned.find(b => b.username === user.username);
        if (banData) return socket.emit('banned', { bannedBy: banData.bannedBy, reason: banData.reason });
        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin: user.isAdmin, sessionId });
        sendUserContacts(socket, userId);
        sendStatuses(socket);
        broadcastOnlineUsers();
        return;
      }
    }

    if (!username || username.length < 3) return socket.emit('error', { message: 'Username minimal 3 karakter' });
    const userExists = Object.values(db.users).find(u => u.username === username);
    if (userExists) return socket.emit('error', { message: 'Username sudah digunakan' });

    const userId = uuidv4();
    const isAdmin = username === ADMIN_USERNAME ? 1 : 0;
    const newSessionId = uuidv4();
    const newUser = { id: userId, username, displayName: displayName || username, bio: bio || 'Hey! I using ElzzMsg', avatar: avatar || null, isAdmin };

    db.users[userId] = newUser;
    db.sessions[newSessionId] = { userId };
    saveDB(db);

    onlineUsers[socket.id] = { ...newUser, socketId: socket.id, online: true };
    socket.emit('registered', { success: true, user: newUser, isAdmin, sessionId: newSessionId });
    if (isAdmin) socket.emit('bot_message', { from: 'Configurator Bot', text: `🤖 Welcome Admin!\n\nCommands:\n/ban (username) (alasan)\n/unban (username)` });
    broadcastOnlineUsers();
  });

  socket.on('add_contact', (data) => {
    const { targetUsername, userId } = data;
    const db = getDB();
    const user = db.users[userId];
    if (!user) return socket.emit('error', { message: 'Invalid user' });
    const targetEntry = Object.entries(db.users).find(([id, u]) => u.username === targetUsername);
    if (!targetEntry) return socket.emit('error', { message: 'Username tidak ditemukan' });
    const [targetId, targetUser] = targetEntry;
    if (targetUser.username === user.username) return socket.emit('error', { message: 'Gak bisa add diri sendiri' });
    const exists = db.contacts.find(c => c.userId === userId && c.contactUsername === targetUsername);
    if (!exists) { db.contacts.push({ userId, contactUsername: targetUsername }); saveDB(db); }
    sendUserContacts(socket, userId);
    socket.emit('contact_added', { success: true });
  });

  socket.on('get_contacts', (userId) => sendUserContacts(socket, userId));

  socket.on('send_message', (data) => {
    const db = getDB();
    const { from, to, text, type, mediaUrl, mediaType } = data;
    const fromUser = Object.values(db.users).find(u => u.username === from);
    if (!fromUser) return;

    if (fromUser.isAdmin && text && text.startsWith('/')) {
      const args = text.split(' ');
      const cmd = args[0];
      const targetUser = args[1];
      const reason = args.slice(2).join(' ') || 'No reason';

      if (cmd === '/ban' && targetUser) {
        db.banned = db.banned.filter(b => b.username !== targetUser);
        db.banned.push({ username: targetUser, reason: reason, bannedBy: fromUser.username });
        saveDB(db);
        const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
        if (targetSocket) io.to(targetSocket.socketId).emit('banned', { bannedBy: fromUser.username, reason: reason });
        socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-ban.\nAlasan: ${reason}` });
        return;
      }
      if (cmd === '/unban' && targetUser) {
        const index = db.banned.findIndex(b => b.username === targetUser);
        if (index !== -1) {
          db.banned.splice(index, 1);
          saveDB(db);
          const targetSocket = Object.values(onlineUsers).find(u => u.username === targetUser);
          if (targetSocket) io.to(targetSocket.socketId).emit('unbanned');
          socket.emit('command_result', { message: `✅ User ${targetUser} berhasil di-unban.` });
        } else { socket.emit('command_result', { message: `User ${targetUser} tidak di-ban.` }); }
        return;
      }
    }

    const msg = { id: uuidv4(), from, to, text, type: type || 'text', mediaUrl, mediaType, time: new Date().toISOString(), status: 'sent' };
    db.messages.push(msg);
    saveDB(db);
    const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
    if (recipientSocket) io.to(recipientSocket.socketId).emit('receive_message', msg);
    socket.emit('message_sent', msg);
  });

  socket.on('get_messages', (data) => {
    const db = getDB();
    const { user1, user2 } = data;
    const msgs = db.messages.filter(m => (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1));
    socket.emit('messages', msgs);
  });

  socket.on('typing', (data) => {
    const recipient = Object.values(onlineUsers).find(u => u.username === data.to);
    if (recipient) io.to(recipient.socketId).emit('typing', data);
  });

  socket.on('update_profile', (data) => {
    const db = getDB();
    const user = db.users[data.userId];
    if (user) {
      user.displayName = data.displayName; user.bio = data.bio; user.avatar = data.avatar;
      saveDB(db);
      if (onlineUsers[socket.id]) onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
      socket.emit('profile_updated', user);
    }
  });

  socket.on('post_status', (data) => {
    const db = getDB();
    const { userId, url, type, caption } = data;
    const user = db.users[userId];
    if (!user) return;
    const status = { id: uuidv4(), userId, username: user.username, displayName: user.displayName, avatar: user.avatar, url, type, caption, time: new Date().toISOString(), viewers: [] };
    db.statuses.push(status);
    saveDB(db);
    io.emit('new_status', status);
  });

  socket.on('get_statuses', () => sendStatuses(socket));
  socket.on('view_status', (data) => {
    const db = getDB();
    const status = db.statuses.find(s => s.id === data.statusId);
    if (status && !status.viewers.includes(data.viewerUsername)) { status.viewers.push(data.viewerUsername); saveDB(db); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastOnlineUsers(); });

  function sendUserContacts(socket, userId) {
    const db = getDB();
    const userContacts = db.contacts.filter(c => c.userId === userId).map(c => {
      const contactUser = Object.values(db.users).find(u => u.username === c.contactUsername);
      return contactUser ? { ...contactUser, password: undefined } : null;
    }).filter(Boolean);
    socket.emit('contacts', userContacts);
  }

  function sendStatuses(socket) {
    const db = getDB();
    const now = new Date();
    const validStatuses = db.statuses.filter(s => (now - new Date(s.time)) < 86400000);
    socket.emit('statuses', validStatuses);
  }

  function broadcastOnlineUsers() { io.emit('online_users', Object.values(onlineUsers).map(u => u.username)); }
});

// === GCC: AUTO CLEANUP ===
function runGCC() {
  const db = getDB();
  const now = new Date();
  const lifespan = 86400000; 
  db.statuses = db.statuses.filter(s => (now - new Date(s.time)) < lifespan);
  db.messages = db.messages.filter(m => (now - new Date(m.time)) < lifespan);
  saveDB(db);
}
runGCC();
setInterval(runGCC, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg running on port ' + PORT));alues(db.users).find(u => u.username === c.contactUsername);
      return contactUser ? { ...contactUser, password: undefined } : null;
    }).filter(Boolean);
    socket.emit('contacts', userContacts);
  }

  function sendStatuses(socket) {
    const db = getDB();
    const now = new Date();
    const validStatuses = db.statuses.filter(s => (now - new Date(s.time)) < 86400000);
    socket.emit('statuses', validStatuses);
  }

  function broadcastOnlineUsers() {
    io.emit('online_users', Object.values(onlineUsers).map(u => u.username));
  }
});

// === [FITUR GCC: AUTO CLEANUP] ===
function runGCC() {
  const db = getDB();
  const now = new Date();
  const lifespan = 86400000; // 24 Jam

  const oldStatusCount = db.statuses.length;
  db.statuses = db.statuses.filter(s => (now - new Date(s.time)) < lifespan);
  
  const oldMsgCount = db.messages.length;
  db.messages = db.messages.filter(m => (now - new Date(m.time)) < lifespan);

  saveDB(db);
  if(oldStatusCount !== db.statuses.length || oldMsgCount !== db.messages.length) {
      console.log(`🧹 GCC Done! Cleaned ${oldStatusCount - db.statuses.length} statuses & ${oldMsgCount - db.messages.length} messages.`);
  }
}

runGCC(); // Run once on startup
setInterval(runGCC, 3600000); // Run every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg running on port ' + PORT));ind(s => s.id === statusId);
    if (status && !status.viewers.includes(viewerUsername)) {
      status.viewers.push(viewerUsername);
      saveDB(db);
    }
  });

  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    broadcastOnlineUsers();
  });

  function sendUserContacts(socket, userId) {
    const db = getDB();
    const userContacts = db.contacts.filter(c => c.userId === userId).map(c => {
      const contactUser = Object.values(db.users).find(u => u.username === c.contactUsername);
      return contactUser ? { ...contactUser, password: undefined } : null;
    }).filter(Boolean);
    socket.emit('contacts', userContacts);
  }

  function sendStatuses(socket) {
    const db = getDB();
    // Filter status > 24 hours
    const now = new Date();
    const validStatuses = db.statuses.filter(s => (now - new Date(s.time)) < 86400000); // 24 jam dalam ms
    socket.emit('statuses', validStatuses);
  }

  function broadcastOnlineUsers() {
    io.emit('online_users', Object.values(onlineUsers).map(u => u.username));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg running on port ' + PORT));
function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

initDB();

// === STORAGE & UPLOADS ===
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

const ADMIN_USERNAME = 'fxosss';
let onlineUsers = {}; // Socket ID -> User Data

// === MIDDLEWARE: Android Only ===
app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  if (!isMobile && req.path === '/') {
    return res.send('<html><body style="background:#111b21;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>📵 Mobile Only</h1><p>ElzzMsg hanya untuk perangkat Android.</p></div></body></html>');
  }
  next();
});

// === ROUTES ===
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});

app.post('/upload-voice', upload.single('voice'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No voice' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// === API: Session Check ===
app.post('/api/check-session', (req, res) => {
  const { sessionId } = req.body;
  const db = getDB();
  const session = db.sessions[sessionId];
  
  if (!session) return res.json({ valid: false });
  
  const user = db.users[session.userId];
  if (!user || db.banned.includes(user.username)) return res.json({ valid: false });
  
  res.json({ valid: true, user: { ...user, password: undefined } });
});

// === SOCKET.IO LOGIC ===
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register / Auto Login
  socket.on('register', (data) => {
    const db = getDB();
    const { username, displayName, bio, avatar, sessionId } = data;

    // 1. Check existing session
    if (sessionId && db.sessions[sessionId]) {
      const userId = db.sessions[sessionId].userId;
      const user = db.users[userId];
      if (user && !db.banned.includes(user.username)) {
        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin: user.isAdmin, sessionId });
        sendUserContacts(socket, userId);
        broadcastOnlineUsers();
        return;
      }
    }

    // 2. New Registration
    if (!username || username.length < 3) return socket.emit('error', { message: 'Username minimal 3 karakter' });
    
    // Check if username exists (iterate over keys)
    const userExists = Object.values(db.users).find(u => u.username === username);
    if (userExists) return socket.emit('error', { message: 'Username sudah digunakan' });

    const userId = uuidv4();
    const isAdmin = username === ADMIN_USERNAME ? 1 : 0;
    const newSessionId = uuidv4();

    const newUser = {
      id: userId,
      username,
      displayName: displayName || username,
      bio: bio || 'Hey! I using ElzzMsg',
      avatar: avatar || null,
      isAdmin
    };

    db.users[userId] = newUser;
    db.sessions[newSessionId] = { userId };
    saveDB(db);

    onlineUsers[socket.id] = { ...newUser, socketId: socket.id, online: true };

    socket.emit('registered', { success: true, user: newUser, isAdmin, sessionId: newSessionId });

    if (isAdmin) {
      socket.emit('bot_message', {
        from: 'Configurator Bot',
        text: `🤖 Welcome Admin!\n\nCommands:\n/ban (username)\n/unban (username)`
      });
    }
    broadcastOnlineUsers();
  });

  // Add Contact
  socket.on('add_contact', (data) => {
    const { targetUsername, userId } = data;
    const db = getDB();
    
    const user = db.users[userId];
    if (!user) return socket.emit('error', { message: 'Invalid user' });

    const targetEntry = Object.entries(db.users).find(([id, u]) => u.username === targetUsername);
    if (!targetEntry) return socket.emit('error', { message: 'Username tidak ditemukan' });
    
    const [targetId, targetUser] = targetEntry;
    if (db.banned.includes(targetUser.username)) return socket.emit('error', { message: 'User di-banned' });
    if (targetUser.username === user.username) return socket.emit('error', { message: 'Gak bisa add diri sendiri' });

    const exists = db.contacts.find(c => c.userId === userId && c.contactUsername === targetUsername);
    if (!exists) {
      db.contacts.push({ userId, contactUsername: targetUsername });
      saveDB(db);
    }
    
    sendUserContacts(socket, userId);
    socket.emit('contact_added', { success: true });
  });

  socket.on('get_contacts', (userId) => sendUserContacts(socket, userId));

  // Messaging
  socket.on('send_message', (data) => {
    const db = getDB();
    const { from, to, text, type, mediaUrl, mediaType } = data;
    
    const fromUser = Object.values(db.users).find(u => u.username === from);
    if (!fromUser || db.banned.includes(fromUser.username)) return;

    // Admin Commands
    if (fromUser.isAdmin && text && text.startsWith('/')) {
      const [cmd, arg] = text.split(' ');
      if (cmd === '/ban' && arg) {
        if (!db.banned.includes(arg)) db.banned.push(arg);
        saveDB(db);
        socket.emit('command_result', { message: `✅ ${arg} di-ban` });
        return;
      }
      if (cmd === '/unban' && arg) {
        db.banned = db.banned.filter(u => u !== arg);
        saveDB(db);
        socket.emit('command_result', { message: `✅ ${arg} di-unban` });
        return;
      }
    }

    const msg = {
      id: uuidv4(),
      from, to, text, type: type || 'text', mediaUrl, mediaType,
      time: new Date().toISOString(),
      status: 'sent'
    };

    db.messages.push(msg);
    saveDB(db);

    const recipientSocket = Object.values(onlineUsers).find(u => u.username === to);
    if (recipientSocket) io.to(recipientSocket.socketId).emit('receive_message', msg);
    
    socket.emit('message_sent', msg);
  });

  socket.on('get_messages', (data) => {
    const db = getDB();
    const { user1, user2 } = data;
    const msgs = db.messages.filter(m => 
      (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1)
    );
    socket.emit('messages', msgs);
  });

  socket.on('typing', (data) => {
    const recipient = Object.values(onlineUsers).find(u => u.username === data.to);
    if (recipient) io.to(recipient.socketId).emit('typing', data);
  });

  socket.on('update_profile', (data) => {
    const db = getDB();
    const user = db.users[data.userId];
    if (user) {
      user.displayName = data.displayName;
      user.bio = data.bio;
      user.avatar = data.avatar;
      saveDB(db);
      if (onlineUsers[socket.id]) onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
      socket.emit('profile_updated', user);
    }
  });

  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    broadcastOnlineUsers();
  });

  // Helper: Send User Contacts
  function sendUserContacts(socket, userId) {
    const db = getDB();
    const userContacts = db.contacts.filter(c => c.userId === userId).map(c => {
      const contactUser = Object.values(db.users).find(u => u.username === c.contactUsername);
      return contactUser ? { ...contactUser, password: undefined } : null;
    }).filter(Boolean);
    socket.emit('contacts', userContacts);
  }

  // Helper: Broadcast Online Users
  function broadcastOnlineUsers() {
    io.emit('online_users', Object.values(onlineUsers).map(u => u.username));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg running on port ' + PORT));
