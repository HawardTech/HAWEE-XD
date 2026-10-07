// HAWEE-XD pairing page: link WhatsApp from a web page and get a SESSION_ID.
// Run:  node pair.js   then open http://127.0.0.1:3000
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1'; // use 0.0.0.0 on a cloud host
const PASSWORD = process.env.PAIR_PASSWORD || '';
if (PASSWORD.length < 6) {
  console.error('Set PAIR_PASSWORD in .env (at least 6 characters).');
  process.exit(1);
}
const PAGE = fs.readFileSync(path.join(__dirname, 'public', 'pair.html'));

// ---------- password check with simple lockout ----------
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const passwordOk = (given) => crypto.timingSafeEqual(hash(given), hash(PASSWORD));
let failures = 0;
let lockedUntil = 0;

// ---------- one pairing job at a time ----------
let job = null;

function finish(j, state, message, sessionId) {
  if (j.done) return;
  console.log('[pair] finished:', state, message || '');
  j.done = true;
  j.state = state;
  j.message = message || '';
  j.sessionId = sessionId || null;
  clearTimeout(j.timer);
  try { j.sock && j.sock.end(undefined); } catch {}
  fs.rmSync(j.dir, { recursive: true, force: true });
  setTimeout(() => { if (job === j) job = null; }, 10 * 60 * 1000); // forget result after 10 min
}

async function connect(j, number) {
  if (j.done) return;
  const { state, saveCreds } = await useMultiFileAuthState(j.dir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
  });
  j.sock = sock;
  let requested = false;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (j.done) return;
    if (connection || qr) console.log('[pair] update:', connection || '', qr ? '(ready to pair)' : '');

    if (qr && !sock.authState.creds.registered && !requested) {
      requested = true;
      try {
        j.code = await sock.requestPairingCode(number);
        j.state = 'code';
        console.log('[pair] code:', j.code);
      } catch (e) {
        finish(j, 'error', 'Could not get a code: ' + e.message);
      }
    }

    if (connection === 'open') {
      j.state = 'linking';
      setTimeout(() => {
        if (j.done) return;
        try {
          const raw = fs.readFileSync(path.join(j.dir, 'creds.json'));
          const creds = JSON.parse(raw.toString());
          if (!creds.registered) throw new Error('not registered yet');
          const id = 'HAWEE~' + zlib.gzipSync(raw).toString('base64');
          finish(j, 'linked', '', id);
        } catch (e) {
          finish(j, 'error', 'Linked, but could not read the session: ' + e.message);
        }
      }, 5000);
    }

    if (connection === 'close' && !j.done) {
      const status = lastDisconnect?.error?.output?.statusCode;
      console.log('[pair] closed, status:', status, lastDisconnect?.error?.message || '');
      if (status === DisconnectReason.loggedOut) {
        finish(j, 'error', 'WhatsApp rejected the link (status ' + status + '). Please try again.');
      } else {
        setTimeout(() => connect(j, number), 1500); // e.g. restart required after pairing
      }
    }
  });
}

function startJob(number) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawee-pair-'));
  const j = { id, state: 'starting', code: null, sessionId: null, message: '', dir, sock: null, done: false };
  j.timer = setTimeout(() => finish(j, 'error', 'Timed out. Please start again.'), 3 * 60 * 1000);
  job = j;
  connect(j, number).catch((e) => finish(j, 'error', 'Startup failed: ' + e.message));
  return id;
}

// ---------- HTTP server ----------
const json = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2048) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGE);
    }

    if (url.pathname.startsWith('/api/')) {
      if (Date.now() < lockedUntil) return json(res, 429, { error: 'Too many wrong passwords. Wait a minute.' });
      if (!passwordOk(req.headers['x-pair-password'] || '')) {
        if (++failures >= 5) { lockedUntil = Date.now() + 60000; failures = 0; }
        return json(res, 401, { error: 'Wrong password.' });
      }
      failures = 0;

      if (req.method === 'POST' && url.pathname === '/api/start') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'Bad request.' }); }
        const number = String(body.number || '').replace(/\D/g, '');
        if (number.length < 7 || number.length > 15) return json(res, 400, { error: 'Enter a valid number with country code.' });
        if (job && !job.done) return json(res, 409, { error: 'Another pairing is in progress. Wait or try again in 3 minutes.' });
        return json(res, 200, { id: startJob(number) });
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (!job || job.id !== url.searchParams.get('id')) return json(res, 404, { error: 'No such pairing.' });
        return json(res, 200, { state: job.state, code: job.code, message: job.message, sessionId: job.sessionId });
      }
    }

    json(res, 404, { error: 'Not found.' });
  } catch (e) {
    json(res, 500, { error: 'Server error.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Pairing page running: http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') console.log('Open that link in your phone browser.');
});
