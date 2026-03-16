const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === DATABASE ===
const DB_FILE = 'elzzmsg_db.json';
function initDB() { if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, sessions: {}, contacts: [], messages: [], banned: [], statuses: [] }, null, 2)); }
function getDB() { if (!fs.existsSync(DB_FILE)) initDB(); try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { initDB(); return getDB(); } }
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
initDB();

// === UPLOADS ===
const uploadPath = './uploads';
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
const upload = multer({ dest: uploadPath });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadPath));

const ADMIN_USER = process.env.ADMIN_USER || 'elzzellz';
let onlineUsers = {};

// === ROUTES ===
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.post('/upload', upload.single('file'), (req, res) => res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype }));
app.post('/upload-voice', upload.single('voice'), (req, res) => res.json({ url: '/uploads/' + req.file.filename }));
app.post('/api/check-session', (req, res) => {
    const s = getDB().sessions[req.body.sessionId];
    if (!s) return res.json({ valid: false });
    const u = getDB().users[s.userId];
    if (!u) return res.json({ valid: false });
    const b = getDB().banned.find(x => x.username === u.username);
    if (b) return res.json({ valid: false, banned: true, banData: b });
    res.json({ valid: true, user: { ...u, password: undefined } });
});

// === SOCKET ===
io.on('connection', socket => {
    console.log('Connect:', socket.id);

    socket.on('register', d => {
        const db = getDB();
        if (d.sessionId && db.sessions[d.sessionId]) {
            const u = db.users[db.sessions[d.sessionId].userId];
            if (u) {
                const b = db.banned.find(x => x.username === u.username);
                if (b) return socket.emit('banned', { bannedBy: b.bannedBy, reason: b.reason });
                onlineUsers[socket.id] = { ...u, socketId: socket.id, online: true };
                return socket.emit('registered', { success: true, user: u, isAdmin: u.isAdmin, sessionId: d.sessionId }), sendContacts(socket, u.id), sendStatus(socket);
            }
        }
        if (!d.username || d.username.length < 3) return socket.emit('error', { message: 'Min 3 char' });
        if (Object.values(db.users).find(u => u.username === d.username)) return socket.emit('error', { message: 'Taken' });
        
        const id = uuidv4(), sid = uuidv4(), isAdmin = d.username === ADMIN_USER ? 1 : 0;
        const user = { id, username: d.username, displayName: d.displayName || d.username, bio: 'Hey!', avatar: d.avatar, isAdmin };
        db.users[id] = user; db.sessions[sid] = { userId: id }; saveDB(db);
        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin, sessionId: sid });
        if (isAdmin) socket.emit('bot_message', { text: '🤖 Admin Mode: /ban (user) (reason) | /unban (user)' });
    });

    socket.on('add_contact', d => {
        const db = getDB(); const u = db.users[d.userId]; if(!u) return;
        const t = Object.values(db.users).find(x => x.username === d.targetUsername);
        if (!t) return socket.emit('error', { message: 'Not found' });
        if (!db.contacts.find(c => c.userId === d.userId && c.contactUsername === d.targetUsername)) db.contacts.push({ userId: d.userId, contactUsername: d.targetUsername }), saveDB(db);
        sendContacts(socket, d.userId); socket.emit('contact_added', { ok: true });
    });

    socket.on('send_message', d => {
        const db = getDB(); const u = Object.values(db.users).find(x => x.username === d.from); if(!u) return;
        
        if (u.isAdmin && d.text && d.text.startsWith('/')) {
            const [cmd, arg, ...r] = d.text.split(' ');
            if (cmd === '/ban' && arg) {
                db.banned = db.banned.filter(x => x.username !== arg);
                db.banned.push({ username: arg, reason: r.join(' ') || 'No reason', bannedBy: u.username }); saveDB(db);
                const t = Object.values(onlineUsers).find(x => x.username === arg);
                if (t) io.to(t.socketId).emit('banned', { bannedBy: u.username, reason: r.join(' ') });
                return socket.emit('command_result', { message: `Banned ${arg}` });
            }
            if (cmd === '/unban' && arg) {
                db.banned = db.banned.filter(x => x.username !== arg); saveDB(db);
                const t = Object.values(onlineUsers).find(x => x.username === arg);
                if (t) io.to(t.socketId).emit('unbanned');
                return socket.emit('command_result', { message: `Unbanned ${arg}` });
            }
        }

        // Auto save contact
        const t = Object.values(db.users).find(x => x.username === d.to);
        if (t) {
            if (!db.contacts.find(c => c.userId === u.id && c.contactUsername === d.to)) db.contacts.push({ userId: u.id, contactUsername: d.to });
            if (!db.contacts.find(c => c.userId === t.id && c.contactUsername === d.from)) db.contacts.push({ userId: t.id, contactUsername: d.from });
            saveDB(db);
        }

        const msg = { id: uuidv4(), from: d.from, to: d.to, text: d.text, type: d.type || 'text', mediaUrl: d.mediaUrl, time: new Date().toISOString() };
        db.messages.push(msg); saveDB(db);
        const r = Object.values(onlineUsers).find(x => x.username === d.to);
        if (r) io.to(r.socketId).emit('receive_message', msg);
        socket.emit('message_sent', msg);
    });

    socket.on('get_messages', d => socket.emit('messages', getDB().messages.filter(m => (m.from===d.user1&&m.to===d.user2)||(m.from===d.user2&&m.to===d.user1))));
    socket.on('get_contacts', id => sendContacts(socket, id));
    socket.on('typing', d => { const r = Object.values(onlineUsers).find(x => x.username === d.to); if(r) io.to(r.socketId).emit('typing', d); });
    socket.on('update_profile', d => { const db=getDB(), u=db.users[d.userId]; if(u) { Object.assign(u, d); saveDB(db); socket.emit('profile_updated', u); }});
    socket.on('post_status', d => { const db=getDB(), u=db.users[d.userId]; if(u) { db.statuses.push({ id:uuidv4(), ...d, username:u.username, displayName:u.displayName, time:new Date().toISOString(), viewers:[] }); saveDB(db); io.emit('new_status', d); }});
    socket.on('get_statuses', () => socket.emit('statuses', getDB().statuses.filter(s => (new Date() - new Date(s.time)) < 86400000)));
    socket.on('view_status', d => { const db=getDB(), s=db.statuses.find(x=>x.id===d.statusId); if(s && !s.viewers.includes(d.viewerUsername)) s.viewers.push(d.viewerUsername), saveDB(db); });
    socket.on('disconnect', () => { delete onlineUsers[socket.id]; });

    function sendContacts(s, id) { const c = getDB().contacts.filter(x=>x.userId===id).map(x => { const u = Object.values(getDB().users).find(y=>y.username===x.contactUsername); return u ? {...u, password:undefined} : null }).filter(Boolean); s.emit('contacts', c); }
    function sendStatus(s) { s.emit('statuses', getDB().statuses.filter(x => (new Date() - new Date(x.time)) < 86400000)); }
});

// GCC
setInterval(() => { const db=getDB(), n=new Date(); db.messages=db.messages.filter(m=>(n-new Date(m.time))<86400000); db.statuses=db.statuses.filter(s=>(n-new Date(s.time))<86400000); saveDB(db); }, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg OK on ' + PORT));
