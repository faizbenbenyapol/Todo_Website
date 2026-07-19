require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./src/config');
const SqliteSessionStore = require('./src/sessionStore');
const authRoutes = require('./src/routes/auth');
const taskRoutes = require('./src/routes/tasks');
const noteRoutes = require('./src/routes/notes');
const settingsRoutes = require('./src/routes/settings');
const { startScheduler } = require('./src/services/scheduler');

const app = express();
app.disable('x-powered-by');

if (config.trustProxy) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com",
    "frame-src https://accounts.google.com",
    "connect-src 'self' https://accounts.google.com https://www.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
  ].join('; '));
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '50kb', strict: true }));

// Browser ที่ยิงคำขอเปลี่ยนข้อมูลจาก origin อื่นต้องถูกปฏิเสธ แม้จะมี cookie ติดมาด้วย
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // รองรับ CLI/health tooling ซึ่งส่ง cookie เองไม่ได้โดยอัตโนมัติ
  let originValue;
  try { originValue = new URL(origin).origin; } catch { return res.status(403).json({ error: 'Origin ไม่ถูกต้อง' }); }
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (originValue !== expectedOrigin) {
    return res.status(403).json({ error: 'ไม่อนุญาตคำขอจากเว็บไซต์อื่น' });
  }
  return next();
});

app.use(session({
  name: config.sessionCookieName,
  store: new SqliteSessionStore(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
  },
}));

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.use('/api', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/settings', settingsRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API ที่เรียก' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  // Assets are not content-hashed, so clients must revalidate after each deploy.
  maxAge: 0,
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON ไม่ถูกต้อง' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'ข้อมูลมีขนาดใหญ่เกินไป' });
  }
  if (err && err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.publicMessage || err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'เกิดข้อผิดพลาดบางอย่างในเซิร์ฟเวอร์' });
});

function startServer(port = config.port, options = {}) {
  const server = app.listen(port, () => {
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : port;
    console.log(`✔ เซิร์ฟเวอร์กำลังทำงานที่ http://localhost:${actualPort}`);
  });
  const shouldRunScheduler = options.runScheduler ?? process.env.NODE_ENV !== 'test';
  const stopScheduler = shouldRunScheduler ? startScheduler() : null;
  if (stopScheduler) server.on('close', stopScheduler);
  return server;
}

if (require.main === module) {
  for (const warning of config.warnings) console.warn(`[config] ${warning}`);
  const server = startServer();
  const shutdown = (signal) => {
    console.log(`\n${signal}: กำลังปิดเซิร์ฟเวอร์...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, startServer };
