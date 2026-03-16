const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === [CONFIG] ===
// Ganti nama file ini buat RESET DATABASE total
const DB_FILE = 'elzzmsg_fresh.json'; 
// Ganti Username Admin di sini
const ADMIN_USER = process.env.ADMIN_USER || 'fxosss'; 
// ================

function initDB() { if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, sessions: {}, contacts: [], messages: [], banned: [], statuses: [] }, null, 2)); }
function getDB() { if (!fs.existsSync(DB_FILE)) initDB(); try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { initDB(); return getDB(); } }
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
initDB();

const uploadPath = './uploads';
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
const upload = multer({ dest: uploadPath });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadPath));

let onlineUsers = {};

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.post('/upload', upload.single('file'), (req, res) => res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype }));
app.post('/upload-voice', upload.single('voice'), (req, res) => res.json({ url: '/uploads/' + req.file.filename }));
app.post('/api/check-session', (req, res) => {
    const db = getDB();
    const session = db.sessions[req.body.sessionId];
    if (!session) return res.json({ valid: false }); 
    
    const user = db.users[session.userId];
    if (!user) return res.json({ valid: false });

    const banData = db.banned.find(b => b.username === user.username);
    if (banData) return res.json({ valid: false, banned: true, banData: { bannedBy: banData.bannedBy, reason: banData.reason } });
    
    res.json({ valid: true, user: { ...user, password: undefined } });
});

io.on('connection', socket => {
    console.log('Connect:', socket.id);

    socket.on('register', d => {
        const db = getDB();
        
        if (d.sessionId && db.sessions[d.sessionId]) {
            const userId = db.sessions[d.sessionId].userId;
            const user = db.users[userId];
            
            if (user) {
                const banData = db.banned.find(b => b.username === user.username);
                if (banData) {
                    return socket.emit('banned', { bannedBy: banData.bannedBy, reason: banData.reason });
                }
                onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
                socket.emit('registered', { success: true, user, isAdmin: user.isAdmin, sessionId: d.sessionId });
                sendContacts(socket, user.id);
                sendStatus(socket);
                return;
            }
        }

        if (!d.username || d.username.length < 3) return socket.emit('error', { message: 'Username minimal 3 karakter' });
        if (Object.values(db.users).find(u => u.username === d.username)) return socket.emit('error', { message: 'Username sudah digunakan' });
        
        const id = uuidv4();
        const sid = uuidv4();
        const isAdmin = d.username === ADMIN_USER ? 1 : 0;
        const user = { id, username: d.username, displayName: d.displayName || d.username, bio: 'Hey! I using ElzzMsg', avatar: d.avatar, isAdmin };
        
        db.users[id] = user;
        db.sessions[sid] = { userId: id };
        saveDB(db);

        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin, sessionId: sid });
        if (isAdmin) socket.emit('bot_message', { text: '🤖 Admin Mode Aktif.\nCommands:\n/ban (user) (alasan)\n/unban (user)' });
    });

    socket.on('add_contact', d => {
        const db = getDB(); const u = db.users[d.userId]; if(!u) return;
        const t = Object.values(db.users).find(x => x.username === d.targetUsername);
        if (!t) return socket.emit('error', { message: 'User tidak ditemukan' });
        if (!db.contacts.find(c => c.userId === d.userId && c.contactUsername === d.targetUsername)) db.contacts.push({ userId: d.userId, contactUsername: d.targetUsername }), saveDB(db);
        sendContacts(socket, d.userId); socket.emit('contact_added', { ok: true });
    });

    socket.on('send_message', d => {
        const db = getDB(); const u = Object.values(db.users).find(x => x.username === d.from); if(!u) return;
        
        if (u.isAdmin && d.text && d.text.startsWith('/')) {
            const [cmd, arg, ...r] = d.text.split(' ');
            if (cmd === '/ban' && arg) {
                const reason = r.join(' ') || 'No reason';
                db.banned = db.banned.filter(x => x.username !== arg);
                db.banned.push({ username: arg, reason: reason, bannedBy: u.username }); 
                saveDB(db);
                const t = Object.values(onlineUsers).find(x => x.username === arg);
                if (t) io.to(t.socketId).emit('banned', { bannedBy: u.username, reason: reason });
                return socket.emit('command_result', { message: `✅ User ${arg} berhasil di-ban.` });
            }
            if (cmd === '/unban' && arg) {
                const len = db.banned.length;
                db.banned = db.banned.filter(x => x.username !== arg); 
                if(db.banned.length < len) { saveDB(db); socket.emit('command_result', { message: `✅ User ${arg} di-unban.` }); }
                else { socket.emit('command_result', { message: `User ${arg} tidak di-ban.` }); }
                return;
            }
        }

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
    socket.on('post_status', d => { const db=getDB(), u=db.users[d.userId]; if(u) { const s={ id:uuidv4(), ...d, username:u.username, displayName:u.displayName, time:new Date().toISOString(), viewers:[] }; db.statuses.push(s); saveDB(db); io.emit('new_status', s); }});
    socket.on('get_statuses', () => socket.emit('statuses', getDB().statuses.filter(s => (new Date() - new Date(s.time)) < 86400000)));
    socket.on('view_status', d => { const db=getDB(), s=db.statuses.find(x=>x.id===d.statusId); if(s && !s.viewers.includes(d.viewerUsername)) s.viewers.push(d.viewerUsername), saveDB(db); });
    socket.on('disconnect', () => { delete onlineUsers[socket.id]; });

    function sendContacts(s, id) { const c = getDB().contacts.filter(x=>x.userId===id).map(x => { const u = Object.values(getDB().users).find(y=>y.username===x.contactUsername); return u ? {...u, password:undefined} : null }).filter(Boolean); s.emit('contacts', c); }
    function sendStatus(s) { s.emit('statuses', getDB().statuses.filter(x => (new Date() - new Date(x.time)) < 86400000)); }
});

setInterval(() => { const db=getDB(), n=new Date(); db.messages=db.messages.filter(m=>(n-new Date(m.time))<86400000); db.statuses=db.statuses.filter(s=>(n-new Date(s.time))<86400000); saveDB(db); }, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg OK on ' + PORT));
