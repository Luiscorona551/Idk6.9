import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_KEYS = [
  'PZ4B-PRWS-2WCX',
  '4GNN-H4NE-7CSR',
  'UFJV-ZBBY-TWVY'
];

function normalizeKey(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const configuredKeys = (process.env.SETUP_KEYS || process.env.SETUP_KEY || '')
  .split(',')
  .map(key => key.trim())
  .filter(Boolean);
const KEYS = configuredKeys.length ? configuredKeys : DEFAULT_KEYS;
// A fresh secret per boot means restarting the server re-locks every browser.
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const COOKIE = 'ugs_setup';
const MAX_AGE = 60 * 60 * 24 * 30;

// Paths the setup flow itself needs before a session exists.
const PUBLIC = [
  /^\/$/,
  /^\/index\.html$/,
  /^\/setup\.css$/,
  /^\/setup\.js$/,
  /^\/(?:ugs-icon\.jpeg|official-flag\.jpg)$/,
  /^\/favicon\.ico$/
];

// Hashing first keeps the comparison constant time whatever the lengths are.
function equals(a, b) {
  const digest = value => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function sign(expiry) {
  return `${expiry}.${createHmac('sha256', SECRET).update(String(expiry)).digest('hex')}`;
}

function valid(token) {
  const [expiry, digest] = String(token).split('.');
  if (!expiry || !digest || Number(expiry) < Date.now()) return false;
  const expected = createHmac('sha256', SECRET).update(expiry).digest('hex');
  return equals(digest, expected);
}

export function hasSession(req) {
  const cookies = req.headers.cookie ?? '';
  const match = cookies.split(';').map(part => part.trim().split('='))
    .find(([name]) => name === COOKIE);
  return Boolean(match && valid(decodeURIComponent(match[1])));
}

export function setupRoutes(app) {
  app.post('/api/setup', (req, res) => {
    const submittedKey = normalizeKey(req.body?.key);
    if (!KEYS.some(key => equals(submittedKey, normalizeKey(key)))) {
      return res.status(403).json({ ok: false });
    }
    const token = sign(Date.now() + MAX_AGE * 1000);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: MAX_AGE * 1000,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https'
    });
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (PUBLIC.some(pattern => pattern.test(req.path)) || hasSession(req)) return next();
    if (req.method === 'GET' && req.accepts('html')) return res.redirect('/');
    res.sendStatus(403);
  });
}
