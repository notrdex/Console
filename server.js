const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const pty = require('node-pty');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e3 });
const PORT = Number(process.env.PORT || 10000);
const USERNAME = process.env.TERMINAL_USERNAME || '';
const PASSWORD_HASH = process.env.TERMINAL_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || '/data';

if (!USERNAME || !PASSWORD_HASH || !SESSION_SECRET) {
  console.error('Missing TERMINAL_USERNAME, TERMINAL_PASSWORD_HASH, or SESSION_SECRET.');
  process.exit(1);
}
if (SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(express.json({ limit: '8kb' }));
app.use(session({
  name: 'ubuntu_terminal_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: 'auto', sameSite: 'strict', maxAge: 2 * 60 * 60 * 1000 }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  res.status(401).json({ error: 'Login required' });
}
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/me', (req, res) => res.json({ authenticated: req.session?.authenticated === true }));
app.post('/login', loginLimiter, async (req, res) => {
  const user = String(req.body.username || '');
  const pass = String(req.body.password || '');
  const userOk = user.length === USERNAME.length && user === USERNAME;
  const passOk = await bcrypt.compare(pass, PASSWORD_HASH).catch(() => false);
  if (!userOk || !passOk) return res.status(401).send('Login failed. <a href="/">Try again</a>');
  req.session.regenerate(err => {
    if (err) return res.status(500).send('Could not create session.');
    req.session.authenticated = true;
    res.redirect('/');
  });
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.get('/', (req, res) => {
  if (!req.session?.authenticated) return res.sendFile(path.join(__dirname, 'index.html'));
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/api/capabilities', requireAuth, (_req, res) => {
  const canAccess = p => { try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); return true; } catch { return false; } };
  res.json({
    uid: process.getuid?.() ?? null,
    dataDir: DATA_DIR,
    dataDirWritable: canAccess(DATA_DIR),
    kvmDevicePresent: fs.existsSync('/dev/kvm'),
    dockerSocketPresent: fs.existsSync('/var/run/docker.sock'),
    notes: [
      'These checks only report device/socket visibility; they do not prove that VM/container creation will work.',
      'This service intentionally runs unprivileged. Docker daemon and LXD usually require host-level privileges unavailable in ordinary Render web services.',
      'QEMU software emulation may still fail due to CPU, memory, kernel, or platform limits.'
    ]
  });
});

io.use((socket, next) => {
  if (socket.request.session?.authenticated === true) return next();
  next(new Error('unauthorized'));
});
io.on('connection', socket => {
  let term;
  try {
    term = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-i'], {
      name: 'xterm-color',
      cols: 100,
      rows: 28,
      cwd: DATA_DIR,
      env: { ...process.env, TERM: 'xterm-color', HOME: DATA_DIR, PS1: 'render-ubuntu$ ' }
    });
  } catch (e) {
    socket.emit('terminal-error', 'Terminal could not start: ' + String(e.message || e));
    socket.disconnect(true);
    return;
  }
  term.onData(data => socket.emit('output', data));
  socket.on('input', data => {
    if (typeof data === 'string' && data.length <= 4096) term.write(data);
  });
  socket.on('resize', size => {
    if (size && Number.isInteger(size.cols) && Number.isInteger(size.rows)) {
      term.resize(Math.max(40, Math.min(size.cols, 160)), Math.max(10, Math.min(size.rows, 60)));
    }
  });
  socket.on('disconnect', () => { try { term.kill(); } catch {} });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send('Internal server error');
});
server.listen(PORT, '0.0.0.0', () => console.log(`Web terminal listening on ${PORT}`));
