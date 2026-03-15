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

// === DATABASE JSON (No Native Module / Termux Safe) ===
const DB_FILE = 'elzzmsg_db.json';

function initDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: {},      // Key: userId
      sessions: {},   // Key: sessionId
      contacts: [],   // Array: { userId, contactUsername }
      messages: [],   // Array: { id, from, to, text, type, mediaUrl, time }
      banned: []      // Array: usernames
    }, null, 2));
  }
}

function getDB() {
  if (!fs.existsSync(DB_FILE)) initDB();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    initDB();
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  }
}

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

const ADMIN_USERNAME = 'elzzellz';
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
