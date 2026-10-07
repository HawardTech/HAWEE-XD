// Download helpers: yt-dlp (YouTube / Instagram / Facebook) and plain file fetching
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = process.env.YTDLP_BIN || 'yt-dlp';
const MAX_MB = Number(process.env.MAX_DOWNLOAD_MB || 50);
const EXTRA = (process.env.YTDLP_EXTRA || '').split(/\s+/).filter(Boolean);
const COOKIES = process.env.YTDLP_COOKIES || ''; // optional path to a cookies.txt

const run = (args) =>
  new Promise((resolve, reject) =>
    execFile(BIN, args, { timeout: 240000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolve(stdout)
    )
  );

// kind: 'audio' (mp3) or 'video' (mp4, max 480p)
async function download(target, kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawee-dl-'));
  try {
    const common = [
      '--no-playlist', '--no-warnings',
      '--max-filesize', `${MAX_MB}M`,
      '--match-filter', 'duration<=1200',
      '--print', '%(title)s', '--no-simulate',
      '-o', path.join(dir, '%(id)s.%(ext)s'),
    ];
    if (COOKIES && fs.existsSync(COOKIES)) common.push('--cookies', COOKIES);
    const args =
      kind === 'audio'
        ? ['-x', '--audio-format', 'mp3', ...common, ...EXTRA, target]
        : [
            '-f', 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/b[height<=480]/b',
            '--merge-output-format', 'mp4', ...common, ...EXTRA, target,
          ];
    const stdout = await run(args);
    const file = fs.readdirSync(dir)[0];
    if (!file) throw new Error('nothing downloaded');
    const title = (stdout.trim().split('\n')[0] || '').slice(0, 100);
    return { buffer: fs.readFileSync(path.join(dir, file)), title };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function fetchBuffer(url, maxBytes = MAX_MB * 1024 * 1024, headers = {}) {
  const res = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new Error('too big');
  const chunks = [];
  let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > maxBytes) throw new Error('too big');
    chunks.push(c);
  }
  return {
    buffer: Buffer.concat(chunks),
    type: res.headers.get('content-type') || '',
    disposition: res.headers.get('content-disposition') || '',
  };
}

module.exports = { download, fetchBuffer, MAX_MB };
