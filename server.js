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
const ADMIN_USER = process.env.ADMIN_USER || 'fxosss'; 

function initDB() { 
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, sessions: {}, contacts: [], messages: [], groups: [], statuses: [] }, null, 2)); 
}
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
                onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
                socket.emit('registered', { success: true, user, isAdmin: user.isAdmin, sessionId: d.sessionId });
                sendContacts(socket, user.id);
                sendGroups(socket, user.id);
                sendStatus(socket);
                return;
            }
        }

        if (!d.username || d.username.length < 3) return socket.emit('error', { message: 'Min 3 char' });
        if (Object.values(db.users).find(u => u.username === d.username)) return socket.emit('error', { message: 'Taken' });
        
        const id = uuidv4(), sid = uuidv4(), isAdmin = d.username === ADMIN_USER ? 1 : 0;
        const user = { id, username: d.username, displayName: d.displayName || d.username, bio: 'Hey!', avatar: d.avatar, isAdmin, badge: null };
        
        db.users[id] = user; db.sessions[sid] = { userId: id }; saveDB(db);
        onlineUsers[socket.id] = { ...user, socketId: socket.id, online: true };
        socket.emit('registered', { success: true, user, isAdmin, sessionId: sid });
        
        if (isAdmin) socket.emit('bot_message', { text: '🤖 Admin Mode.\n/cek\n/broadcast (text)\n/givebadge (user) (text)\n/unbadge (user)' });
    });

    socket.on('add_contact', d => {
        const db = getDB(); const u = db.users[d.userId]; if(!u) return;
        const t = Object.values(db.users).find(x => x.username === d.targetUsername);
        if (!t) return socket.emit('error', { message: 'Not found' });
        if (!db.contacts.find(c => c.userId === d.userId && c.contactUsername === d.targetUsername)) db.contacts.push({ userId: d.userId, contactUsername: d.targetUsername }), saveDB(db);
        sendContacts(socket, d.userId); socket.emit('contact_added', { ok: true });
    });

    // === ADMIN COMMANDS ===
    socket.on('send_message', d => {
        const db = getDB(); const u = Object.values(db.users).find(x => x.username === d.from); if(!u) return;
        
        if (u.isAdmin && d.text && d.text.startsWith('/')) {
            const args = d.text.split(' ');
            const cmd = args[0];

            if (cmd === '/cek') {
                const list = Object.values(db.users).map(u => `${u.username} (${u.displayName})`).join('\n');
                return socket.emit('bot_message', { text: `📋 User List:\n${list}` });
            }
            
            if (cmd === '/broadcast') {
                const msgText = args.slice(1).join(' ');
                if(!msgText) return socket.emit('bot_message', { text: 'Textnya mana?' });
                // Kirim ke semua online user
                Object.values(onlineUsers).forEach(rec => {
                    io.to(rec.socketId).emit('receive_message', { from: 'BroadElzz', to: rec.username, text: msgText, time: new Date().toISOString() });
                });
                return socket.emit('bot_message', { text: `✅ Broadcast terkirim ke ${Object.keys(onlineUsers).length} user.` });
            }

            if (cmd === '/givebadge') {
                const target = args[1];
                const badge = args.slice(2).join(' ');
                const targetUser = Object.values(db.users).find(x => x.username === target);
                if(!targetUser) return socket.emit('bot_message', { text: 'User not found' });
                targetUser.badge = badge;
                saveDB(db);
                return socket.emit('bot_message', { text: `✅ Badge diberikan ke ${target}` });
            }

            if (cmd === '/unbadge') {
                const target = args[1];
                const targetUser = Object.values(db.users).find(x => x.username === target);
                if(targetUser) { targetUser.badge = null; saveDB(db); }
                return socket.emit('bot_message', { text: `✅ Badge dihapus` });
            }
        }

        // Auto Save Contact
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

    // === GROUP SYSTEM ===
    socket.on('create_group', d => {
        const db = getDB();
        const group = { id: uuidv4(), name: d.name, creator: d.userId, members: [d.userId], admins: [d.userId], messages: [] };
        db.groups.push(group); saveDB(db);
        sendGroups(socket, d.userId);
        socket.emit('bot_message', { text: `✅ Grup ${d.name} dibuat!` });
    });

    socket.on('add_member', d => {
        const db = getDB(); const g = db.groups.find(x => x.id === d.groupId);
        if (!g) return;
        if (!g.members.includes(d.userId)) g.members.push(d.userId);
        saveDB(db);
        // Notify user
        const rec = Object.values(onlineUsers).find(x => x.id === d.userId);
        if (rec) { sendGroups(io.sockets.sockets.get(rec.socketId), d.userId); io.to(rec.socketId).emit('receive_message', { from: 'System', text: `Kamu ditambahkan ke grup ${g.name}`, time: new Date().toISOString() }); }
    });

    socket.on('promote_admin', d => {
        const db = getDB(); const g = db.groups.find(x => x.id === d.groupId);
        if (g && !g.admins.includes(d.userId)) g.admins.push(d.userId);
        saveDB(db);
    });

    socket.on('send_group_message', d => {
        const db = getDB(); const g = db.groups.find(x => x.id === d.to);
        if(!g) return;
        const msg = { id: uuidv4(), from: d.from, text: d.text, time: new Date().toISOString() };
        g.messages.push(msg); saveDB(db);
        // Emit ke semua member
        g.members.forEach(memId => {
            const rec = Object.values(onlineUsers).find(x => x.id === memId);
            if (rec) io.to(rec.socketId).emit('receive_group_message', { groupId: d.to, msg });
        });
    });

    socket.on('get_messages', d => socket.emit('messages', getDB().messages.filter(m => (m.from===d.user1&&m.to===d.user2)||(m.from===d.user2&&m.to===d.user1))));
    socket.on('get_group_messages', id => socket.emit('group_messages', getDB().groups.find(x=>x.id===id)?.messages || []));
    socket.on('get_contacts', id => sendContacts(socket, id));
    socket.on('get_groups', id => sendGroups(socket, id));
    socket.on('typing', d => { const r = Object.values(onlineUsers).find(x => x.username === d.to); if(r) io.to(r.socketId).emit('typing', d); });
    socket.on('update_profile', d => { const db=getDB(), u=db.users[d.userId]; if(u) { Object.assign(u, d); saveDB(db); socket.emit('profile_updated', u); }});
    socket.on('post_status', d => { const db=getDB(), u=db.users[d.userId]; if(u) { const s={ id:uuidv4(), ...d, username:u.username, displayName:u.displayName, time:new Date().toISOString(), viewers:[] }; db.statuses.push(s); saveDB(db); io.emit('new_status', s); }});
    socket.on('get_statuses', () => socket.emit('statuses', getDB().statuses.filter(s => (new Date() - new Date(s.time)) < 86400000)));
    socket.on('view_status', d => { const db=getDB(), s=db.statuses.find(x=>x.id===d.statusId); if(s && !s.viewers.includes(d.viewerUsername)) s.viewers.push(d.viewerUsername), saveDB(db); });
    socket.on('disconnect', () => { delete onlineUsers[socket.id]; });

    function sendContacts(s, id) { const c = getDB().contacts.filter(x=>x.userId===id).map(x => { const u = Object.values(getDB().users).find(y=>y.username===x.contactUsername); return u ? {...u, password:undefined} : null }).filter(Boolean); s.emit('contacts', c); }
    function sendGroups(s, id) { const g = getDB().groups.filter(x=>x.members.includes(id)); s.emit('groups', g); }
    function sendStatus(s) { s.emit('statuses', getDB().statuses.filter(x => (new Date() - new Date(x.time)) < 86400000)); }
});

setInterval(() => { const db=getDB(), n=new Date(); db.messages=db.messages.filter(m=>(n-new Date(m.time))<86400000); db.statuses=db.statuses.filter(s=>(n-new Date(s.time))<86400000); saveDB(db); }, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🦁 ElzzMsg OK on ' + PORT));
