const os = require('os');
const settings = require('./settings');
const media = require('./media');

const BOT_NAME = process.env.BOT_NAME || 'HAWEE-XD';
const OWNER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const POWERED_BY = process.env.POWERED_BY || 'HawardTech';
const TZ = process.env.TIMEZONE || 'Africa/Nairobi';
const startedAt = Date.now();
const lastImage = new Map(); // per-chat cooldown for .imagine
const aiMemory = new Map();
const pendingKick = new Map(); // group -> members found offline by the last scan // short chat memory for the AI chatbot
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers ----------
// Turns A-Z a-z 0-9 into bold unicode letters (for menu headings)
const bold = (s) =>
  [...String(s)]
    .map((ch) => {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
      return ch;
    })
    .join('');

const botName = () => settings.get('botname') || BOT_NAME;
const onOff = (v) => (v ? '✅ on' : '❌ off');
const tick = (v) => (v ? '✅' : '❌');
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];

const uptime = () => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m ${s % 60}s`;
};

const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs. 🐛',
  "There are 10 types of people: those who understand binary and those who don't.",
  "A SQL query walks into a bar, sees two tables and asks: 'Can I join you?'",
  'It works on my machine. 🤷',
];

// ---------- chatbot (keyword rules, or Claude if ANTHROPIC_API_KEY is set) ----------
const CHATBOT_RULES = [
  [/^(hi|hello|hey|yo|sup)\b/i, 'Hey there! 👋 Type .menu to see what I can do.'],
  [/how are you|how r u/i, "I'm running smoothly. How can I help? 🤖"],
  [/\b(thanks|thank you|thx)\b/i, "You're welcome! 😊"],
  [/who are you|your name/i, `I'm *${BOT_NAME}*, a WhatsApp bot by ${POWERED_BY}.`],
];
const keywordReply = (text) => (CHATBOT_RULES.find(([re]) => re.test(text)) || [])[1];

async function smartReply(chatId, text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return keywordReply(text);
  const messages = [...(aiMemory.get(chatId) || []), { role: 'user', content: text.slice(0, 1000) }];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `You are ${BOT_NAME}, a friendly WhatsApp assistant made by ${POWERED_BY}. Reply briefly (under 80 words) in plain text, no markdown.`,
        messages,
      }),
    });
    const data = await res.json();
    const out = (data.content || []).find((b) => b.type === 'text')?.text?.trim();
    if (!out) throw new Error((data.error && data.error.message) || 'empty reply');
    aiMemory.set(chatId, [...messages, { role: 'assistant', content: out }].slice(-8));
    return out;
  } catch (e) {
    console.error('AI error:', e.message);
    return keywordReply(text);
  }
}

// ---------- yt-dlp based download commands ----------
const URL_PATTERNS = {
  insta: /^https?:\/\/([a-z0-9-]+\.)*instagram\.com\//i,
  facebook: /^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.watch|fb\.com)\//i,
  youtube: /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i,
};

const ytError = (e) => {
  const err = `${e.stderr || ''} ${e.message || ''}`;
  if (e.code === 'ENOENT') return '❌ yt-dlp is not installed on this host. See the README (Downloads section).';
  if (/Sign in to confirm|not a bot/i.test(err)) return '❌ YouTube blocked this server (bot check). Try later, or run the bot from a home connection.';
  if (/login|cookies|private|restricted|rate-limit/i.test(err)) return '❌ That post is private or needs a login.';
  if (/does not pass filter|larger than|too big/i.test(err)) return `❌ Too long or too big (limit ${media.MAX_MB} MB / 20 min).`;
  return '❌ Download failed. Try another link.';
};

const mediaCmd = (name, kind, pattern, desc, usage, allowSearch) => ({
  cat: 'TOOLS',
  desc,
  usage,
  run: async ({ jid, msg, args, reply, send }) => {
    const input = args.join(' ').trim();
    if (!input) return reply(`Usage: ${settings.get('prefix')}${name} ${usage}`);
    let target;
    const first = input.split(/\s+/)[0];
    if (/^https?:\/\//i.test(first)) {
      if (!pattern.test(first)) return reply('❌ That link is not supported by this command.');
      target = first;
    } else if (allowSearch) {
      target = 'ytsearch1:' + input;
    } else {
      return reply(`Send a link, e.g. ${settings.get('prefix')}${name} https://...`);
    }
    await reply('⏳ Downloading, please wait...');
    try {
      const r = await media.download(target, kind);
      if (kind === 'audio') {
        await send(jid, { audio: r.buffer, mimetype: 'audio/mpeg', fileName: (r.title || 'audio') + '.mp3' }, { quoted: msg });
      } else {
        await send(jid, { video: r.buffer, caption: `🎬 ${r.title || 'Video'}\n\n_via ${botName()}_` }, { quoted: msg });
      }
    } catch (e) {
      console.error(`${name} error:`, (e.stderr || e.message || '').toString().slice(0, 300));
      await reply(ytError(e));
    }
  },
});

// ---------- on/off toggle commands ----------
const toggle = (name, key, desc, cat = 'ADMIN') => ({
  cat,
  desc,
  usage: '[on/off]',
  owner: true,
  run: async ({ reply, args, prefix }) => {
    const v = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) return reply(`${desc}: ${onOff(settings.get(key))}\nUsage: ${prefix}${name} on|off`);
    settings.set(key, v === 'on');
    await reply(`${onOff(v === 'on')}  ${desc}`);
  },
});

const target = ({ mentions, quotedParticipant, sender }) => (mentions && mentions[0]) || quotedParticipant || sender;

const all = {
  // =============== USER CMDS ===============
  autoreacts: toggle('autoreacts', 'autoreact', 'Auto reactions', 'USER CMDS'),
  antilink: {
    cat: 'USER CMDS',
    desc: 'Delete links in groups',
    usage: '[on/off/kick]',
    owner: true,
    run: async ({ reply, args, prefix }) => {
      const v = (args[0] || '').toLowerCase();
      if (!['on', 'off', 'kick'].includes(v)) return reply(`Anti-link: *${settings.get('antilink')}*\nUsage: ${prefix}antilink on|off|kick\n(The bot must be a group admin.)`);
      settings.set('antilink', v);
      await reply(`🚫 Anti-link is now *${v}*`);
    },
  },
  antidelete: toggle('antidelete', 'antidelete', 'Anti-delete', 'USER CMDS'),
  ai: toggle('ai', 'chatbot', 'AI chatbot (private chats)', 'USER CMDS'),
  owner: {
    cat: 'USER CMDS',
    desc: 'Owner contact',
    run: async ({ reply, isOwner }) => {
      if (isOwner) return reply('You are the owner 👑');
      await reply(OWNER ? `👑 Owner: https://wa.me/${OWNER}` : 'Owner contact is not set.');
    },
  },
  dp: {
    cat: 'USER CMDS',
    desc: 'Profile photo',
    usage: '(mention)',
    run: async (ctx) => {
      const { sock, jid, msg, reply, send } = ctx;
      const who = target(ctx);
      try {
        const url = await sock.profilePictureUrl(who, 'image');
        await send(jid, { image: { url }, caption: `🖼 @${num(who)}`, mentions: [who] }, { quoted: msg });
      } catch {
        await reply('No profile photo available (it may be hidden by privacy settings).');
      }
    },
  },
  ping: {
    cat: 'USER CMDS',
    desc: 'Check bot speed',
    run: async ({ reply, msg }) => {
      const ms = Date.now() - Number(msg.messageTimestamp) * 1000;
      await reply(`Pong! 🏓 ${Math.max(ms, 0)}ms`);
    },
  },
  translate: {
    cat: 'USER CMDS',
    desc: 'Translate text',
    usage: '(lang) (text)',
    run: async ({ reply, args, quotedText, prefix }) => {
      let lang = 'en';
      let rest = [...args];
      if (rest.length && /^[a-z]{2}(-[a-zA-Z]{2,4})?$/.test(rest[0]) && (rest.length > 1 || quotedText)) lang = rest.shift();
      const text = rest.join(' ') || quotedText;
      if (!text) return reply(`Usage: ${prefix}translate fr Hello world\n(or reply to a message with ${prefix}translate sw)`);
      try {
        const res = await fetch(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(text)}`,
          { signal: AbortSignal.timeout(15000) }
        );
        const data = await res.json();
        const out = data[0].map((x) => x[0]).join('');
        await reply(`🌐 *${lang}*\n${out}`);
      } catch (e) {
        console.error('translate error:', e.message);
        await reply('❌ Translation failed. Try again later.');
      }
    },
  },
  menu: {
    cat: 'USER CMDS',
    desc: 'Show this menu',
    run: async ({ reply, msg }) => {
      const p = settings.get('prefix');
      const mode = settings.get('mode');
      const top = (t) => `╭━━━〔 ${t} 〕━━━┈⊷`;
      const end = '╰━━━━━━━━━━━━━━━━━━┈⊷';

      const head = [
        top(bold(botName())),
        `┃ 👤 ${bold('User')}: ${msg.pushName || 'there'}`,
        `┃ 🤖 ${bold('Status')}: ${bold('Online')} ✅`,
        `┃ ⚙️ ${bold('Mode')}: ${bold(mode === 'private' ? 'Private' : 'Public')} ${mode === 'private' ? '🔐' : '🔓'}`,
        `┃ 🔣 ${bold('Prefix')}: ${p || 'none'}`,
        `┃ ⏱ ${bold('Uptime')}: ${uptime()}`,
        end,
      ].join('\n');

      const groups = {};
      for (const [name, c] of Object.entries(commands)) {
        if (c.hidden) continue;
        (groups[c.cat] = groups[c.cat] || []).push(`┃ ⋄ ${p}${name}${c.usage ? ' ' + c.usage : ''}`);
      }
      const sections = Object.entries(groups).map(([cat, lines]) => [top(bold(cat)), ...lines, end].join('\n'));

      const features =
        `🤖 ${bold('Active Features')}:\n` +
        `• ${bold('AI')}: ${tick(settings.get('chatbot'))}\n` +
        `• ${bold('Auto-React')}: ${tick(settings.get('autoreact'))}\n` +
        `• ${bold('Anti-Delete')}: ${tick(settings.get('antidelete'))}\n` +
        `• ${bold('Anti-Link')}: ${settings.get('antilink') === 'off' ? '❌' : '✅'}\n` +
        `• ${bold('Auto-Status')}: ${tick(settings.get('autoviewstatus'))}`;

      const contact = OWNER ? `\n\n🔗 ${bold('WhatsApp')}:\n> Message the owner on WhatsApp. https://wa.me/${OWNER}` : '';
      await reply([head, ...sections].join('\n\n') + `\n\n${features}${contact}\n⚡ ${bold('POWERED BY')}: ${POWERED_BY}`);
    },
  },
  alive: { cat: 'USER CMDS', desc: 'Is the bot online?', run: async ({ reply }) => reply(`✅ *${botName()}* is alive and running!`) },
  uptime: { cat: 'USER CMDS', desc: 'Time since start', run: async ({ reply }) => reply(`⏱ Uptime: ${uptime()}`) },
  time: {
    cat: 'USER CMDS',
    desc: 'Current date and time',
    run: async ({ reply }) => reply(`🕒 ${new Date().toLocaleString('en-GB', { timeZone: TZ })} (${TZ})`),
  },

  // =============== TOOLS ===============
  apk: {
    cat: 'TOOLS',
    desc: 'Download an app',
    usage: '(name)',
    run: async ({ jid, msg, args, reply, send, prefix }) => {
      const q = args.join(' ').trim();
      if (!q) return reply(`Usage: ${prefix}apk whatsapp`);
      await reply('⏳ Searching...');
      try {
        const data = await fetch(`https://ws75.aptoide.com/api/7/apps/search?query=${encodeURIComponent(q)}&limit=1`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
        const app = data && data.datalist && data.datalist.list && data.datalist.list[0];
        const url = app && app.file && app.file.path;
        if (!url) return reply('❌ App not found.');
        const mb = Math.round((app.size || 0) / 1048576);
        if (mb > media.MAX_MB) return reply(`❌ ${app.name} is ${mb} MB, over the ${media.MAX_MB} MB limit.`);
        const r = await media.fetchBuffer(url);
        await send(jid, {
          document: r.buffer,
          fileName: `${String(app.name).replace(/[^\w .-]/g, '')}.apk`,
          mimetype: 'application/vnd.android.package-archive',
          caption: `📦 ${app.name}\nPackage: ${app.package}\nSize: ${mb} MB\n\n⚠️ Only install apps from sources you trust.`,
        }, { quoted: msg });
      } catch (e) {
        console.error('apk error:', e.message);
        await reply(e.message === 'too big' ? `❌ File is over ${media.MAX_MB} MB.` : '❌ Could not fetch that app.');
      }
    },
  },
  tiktok: {
    cat: 'TOOLS',
    desc: 'TikTok video (no watermark)',
    usage: '(url)',
    run: async ({ jid, msg, args, reply, send }) => {
      const url = args[0];
      if (!url || !/^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(url)) {
        return reply('Usage: tiktok https://www.tiktok.com/@user/video/123...');
      }
      await reply('⏳ Downloading...');
      try {
        const res = await fetch('https://www.tikwm.com/api/?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(20000) });
        const json = await res.json();
        const d = json && json.data;
        if (!json || json.code !== 0 || !d || !d.play) return reply('❌ Could not fetch that video. It may be private or removed.');
        const videoUrl = d.play.startsWith('/') ? 'https://www.tikwm.com' + d.play : d.play;
        await send(jid, { video: { url: videoUrl }, caption: `🎵 ${d.title || 'TikTok video'}\n\n_via ${botName()}_` }, { quoted: msg });
      } catch (e) {
        console.error('tiktok error:', e.message);
        await reply('❌ Download failed. Try again later.');
      }
    },
  },
  insta: mediaCmd('insta', 'video', URL_PATTERNS.insta, 'Instagram video/reel', '(url)', false),
  facebook: mediaCmd('facebook', 'video', URL_PATTERNS.facebook, 'Facebook video', '(url)', false),
  song: mediaCmd('song', 'audio', URL_PATTERNS.youtube, 'YouTube audio (mp3)', '(name or link)', true),
  video: mediaCmd('video', 'video', URL_PATTERNS.youtube, 'YouTube video', '(name or link)', true),
  gdrive: {
    cat: 'TOOLS',
    desc: 'Google Drive file',
    usage: '(url)',
    run: async ({ jid, msg, args, reply, send }) => {
      const m = (args[0] || '').match(/drive\.google\.com\/.*?(?:\/d\/|[?&]id=)([\w-]{15,})/i);
      if (!m) return reply('Usage: gdrive https://drive.google.com/file/d/FILE_ID/view');
      await reply('⏳ Fetching file...');
      try {
        const r = await media.fetchBuffer(`https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`);
        if (r.type.includes('text/html')) return reply('❌ The file is private, or too large to fetch.');
        const name = (r.disposition.match(/filename="?([^";]+)"?/i) || [])[1] || 'file';
        await send(jid, { document: r.buffer, fileName: decodeURIComponent(name), mimetype: r.type || 'application/octet-stream' }, { quoted: msg });
      } catch (e) {
        await reply(e.message === 'too big' ? `❌ File is over ${media.MAX_MB} MB.` : '❌ Could not download that file.');
      }
    },
  },
  mf: {
    cat: 'TOOLS',
    desc: 'MediaFire file',
    usage: '(url)',
    run: async ({ jid, msg, args, reply, send }) => {
      const url = args[0] || '';
      if (!/^https?:\/\/([a-z0-9-]+\.)*mediafire\.com\//i.test(url)) return reply('Usage: mf https://www.mediafire.com/file/...');
      await reply('⏳ Fetching file...');
      try {
        const page = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) }).then((r) => r.text());
        const link = (page.match(/href="(https?:\/\/download[^"]+)"/i) || [])[1];
        if (!link) return reply('❌ Could not find the download link.');
        const r = await media.fetchBuffer(link, undefined, { 'user-agent': 'Mozilla/5.0' });
        const name = decodeURIComponent(link.split('/').pop().split('?')[0]) || 'file';
        await send(jid, { document: r.buffer, fileName: name, mimetype: r.type || 'application/octet-stream' }, { quoted: msg });
      } catch (e) {
        await reply(e.message === 'too big' ? `❌ File is over ${media.MAX_MB} MB.` : '❌ Could not download that file.');
      }
    },
  },
  imagine: {
    cat: 'TOOLS',
    desc: 'AI image from text',
    usage: '(prompt)',
    run: async ({ jid, msg, args, reply, send }) => {
      const prompt = args.join(' ').trim();
      if (!prompt) return reply('Usage: imagine a lion wearing a spacesuit, digital art');
      if (prompt.length > 300) return reply('Keep the prompt under 300 characters.');
      if (Date.now() - (lastImage.get(jid) || 0) < 15000) return reply('⏳ Please wait a few seconds between images.');
      lastImage.set(jid, Date.now());
      await reply('🎨 Generating, this can take up to a minute...');
      try {
        const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + `?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/')) throw new Error(`bad response ${res.status} ${type}`);
        await send(jid, { image: Buffer.from(await res.arrayBuffer()), caption: `🎨 ${prompt}\n\n_via ${botName()}_` }, { quoted: msg });
      } catch (e) {
        console.error('imagine error:', e.message);
        await reply('❌ Could not generate that image. Try again or change the prompt.');
      }
    },
  },
  joke: { cat: 'TOOLS', desc: 'Random tech joke', run: async ({ reply }) => reply(JOKES[Math.floor(Math.random() * JOKES.length)]) },
  meme: {
    cat: 'TOOLS',
    desc: 'Random meme',
    run: async ({ jid, msg, reply, send }) => {
      try {
        for (let i = 0; i < 4; i++) {
          const m = await fetch('https://meme-api.com/gimme', { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
          if (!m || !m.url || m.nsfw) continue;
          const img = await media.fetchBuffer(m.url, 8 * 1024 * 1024);
          return await send(jid, { image: img.buffer, caption: `😂 ${m.title || 'Meme'}` }, { quoted: msg });
        }
        await reply('❌ Could not find a meme right now.');
      } catch (e) {
        console.error('meme error:', e.message);
        await reply('❌ Could not fetch a meme right now.');
      }
    },
  },
  emojimix: {
    cat: 'TOOLS',
    desc: 'Mix two emojis',
    usage: '(e1+e2)',
    run: async ({ jid, msg, args, reply, send, prefix }) => {
      const key = process.env.TENOR_KEY;
      if (!key) return reply('Emoji mix needs a free Tenor API key. Set TENOR_KEY in your settings.');
      const [a, b] = args.join('').split('+');
      if (!a || !b) return reply(`Usage: ${prefix}emojimix 😀+😎`);
      try {
        const url = `https://tenor.googleapis.com/v2/featured?key=${encodeURIComponent(key)}&client_key=hawee&collection=emoji_kitchen_v5&contentfilter=high&media_filter=png_transparent&limit=1&q=${encodeURIComponent(a + '_' + b)}`;
        const data = await fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
        const png = data.results && data.results[0] && data.results[0].media_formats.png_transparent.url;
        if (!png) return reply('❌ That emoji combination is not available.');
        const img = await media.fetchBuffer(png, 5 * 1024 * 1024);
        await send(jid, { image: img.buffer }, { quoted: msg });
      } catch (e) {
        console.error('emojimix error:', e.message);
        await reply('❌ Could not mix those emojis.');
      }
    },
  },
  character: {
    cat: 'TOOLS',
    desc: 'Fun personality check',
    usage: '(mention)',
    run: async (ctx) => {
      const who = target(ctx);
      const traits = ['Kindness', 'Humor', 'Intelligence', 'Bravery', 'Creativity', 'Loyalty', 'Patience', 'Luck'];
      const rows = traits.map((t) => `• ${t}: ${20 + Math.floor(Math.random() * 81)}%`).join('\n');
      await ctx.send(ctx.jid, { text: `🎭 *Character check* for @${num(who)}\n\n${rows}\n\n_Just for fun!_`, mentions: [who] }, { quoted: ctx.msg });
    },
  },
  hack: {
    cat: 'ADMIN',
    desc: 'Fake hack prank (joke)',
    usage: '(mention)',
    run: async (ctx) => {
      const who = target(ctx);
      const steps = ['💻 Injecting malware...', '📡 Connecting to the mainframe...', '🔓 Bypassing firewall...', '📂 Downloading memes... 100%'];
      for (const s of steps) {
        await ctx.send(ctx.jid, { text: s });
        await sleep(1200);
      }
      await ctx.send(ctx.jid, { text: `😂 @${num(who)} relax, it's just a prank. Nothing was hacked!`, mentions: [who] });
    },
  },
  echo: { cat: 'TOOLS', desc: 'Repeat your text', usage: '(text)', run: async ({ reply, args }) => reply(args.join(' ') || 'Usage: echo hello') },
  calc: {
    cat: 'TOOLS',
    desc: 'Calculator',
    usage: '(2*(3+4))',
    run: async ({ reply, args }) => {
      const expr = args.join(' ');
      if (!expr || !/^[0-9+\-*/().%\s]+$/.test(expr)) return reply('Usage: calc 2*(3+4)');
      try {
        await reply(`🧮 ${expr} = *${Function(`"use strict"; return (${expr})`)()}*`);
      } catch {
        await reply('Invalid expression.');
      }
    },
  },
  flip: { cat: 'TOOLS', desc: 'Flip a coin', run: async ({ reply }) => reply(Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails') },
  dice: { cat: 'TOOLS', desc: 'Roll a dice', run: async ({ reply }) => reply(`🎲 You rolled *${1 + Math.floor(Math.random() * 6)}*`) },

  // =============== ADMIN ===============
  private: {
    cat: 'ADMIN',
    desc: 'Owner-only mode',
    owner: true,
    run: async ({ reply }) => {
      settings.set('mode', 'private');
      await reply('🔒 Private mode: only the owner can use commands.');
    },
  },
  public: {
    cat: 'ADMIN',
    desc: 'Everyone can use commands',
    owner: true,
    run: async ({ reply }) => {
      settings.set('mode', 'public');
      await reply('🔓 Public mode: everyone can use commands.');
    },
  },
  autoread: toggle('autoread', 'autoread', 'Auto read messages'),
  autotyping: toggle('autotyping', 'autotyping', 'Auto typing'),
  welcome: toggle('welcome', 'welcome', 'Group welcome'),
  anticall: toggle('anticall', 'anticall', 'Reject calls'),
  status: {
    cat: 'ADMIN',
    desc: 'Status control',
    usage: '[on/off/seen/like/download/system]',
    owner: true,
    run: async ({ reply, args, prefix }) => {
      const sub = (args[0] || '').toLowerCase();
      const val = (args[1] || '').toLowerCase();
      const keys = { seen: 'autoviewstatus', like: 'autostatusreact', download: 'statusdownload' };

      if (sub === 'system') {
        const mb = (n) => Math.round(n / 1048576);
        return reply(
          `🖥 *System*\nPlatform: ${os.platform()} ${os.arch()}\nNode: ${process.version}\nCPU cores: ${os.cpus().length}\n` +
            `RAM: ${mb(os.totalmem() - os.freemem())}/${mb(os.totalmem())} MB used\nBot memory: ${mb(process.memoryUsage().rss)} MB\nUptime: ${uptime()}`
        );
      }
      if (sub === 'on' || sub === 'off') {
        settings.set('autoviewstatus', sub === 'on');
        return reply(`${onOff(sub === 'on')}  status auto-view`);
      }
      if (keys[sub] && ['on', 'off'].includes(val)) {
        settings.set(keys[sub], val === 'on');
        return reply(`${onOff(val === 'on')}  status ${sub}`);
      }
      await reply(
        `Status seen: ${onOff(settings.get('autoviewstatus'))}\nStatus like: ${onOff(settings.get('autostatusreact'))}\nStatus download: ${onOff(settings.get('statusdownload'))}\n\n` +
          `Usage:\n${prefix}status on|off\n${prefix}status seen on|off\n${prefix}status like on|off\n${prefix}status download on|off\n${prefix}status system`
      );
    },
  },
  hidetag: {
    cat: 'ADMIN',
    desc: 'Tag everyone silently',
    usage: '(text)',
    owner: true,
    group: true,
    run: async ({ sock, jid, msg, args, send }) => {
      const meta = await sock.groupMetadata(jid);
      await send(jid, { text: args.join(' ') || '📢', mentions: meta.participants.map((p) => p.id) }, { quoted: msg });
    },
  },
  tagall: {
    cat: 'ADMIN',
    desc: 'Mention everyone',
    owner: true,
    group: true,
    run: async ({ sock, jid, msg, args, send }) => {
      const ids = (await sock.groupMetadata(jid)).participants.map((p) => p.id);
      const text = `📢 *${args.join(' ') || 'Attention everyone!'}*\n\n` + ids.map((i) => `@${num(i)}`).join('\n');
      await send(jid, { text, mentions: ids }, { quoted: msg });
    },
  },
  setname: {
    cat: 'ADMIN',
    desc: 'Change bot name',
    usage: '(name)',
    owner: true,
    run: async ({ sock, reply, args, prefix }) => {
      const name = args.join(' ').trim();
      if (!name || name.length > 25) return reply(`Usage: ${prefix}setname MyBot (max 25 characters)`);
      try { await sock.updateProfileName(name); } catch (e) { console.error('updateProfileName:', e.message); }
      settings.set('botname', name);
      await reply(`✅ Name set to *${name}*`);
    },
  },
  kickoffline: {
    cat: 'ADMIN',
    desc: 'Find/remove offline members',
    usage: '[scan/kick]',
    owner: true,
    group: true,
    run: async ({ sock, jid, reply, args, prefix }) => {
      const sub = (args[0] || 'scan').toLowerCase();

      if (sub === 'kick') {
        const pend = pendingKick.get(jid);
        if (!pend || Date.now() - pend.at > 5 * 60 * 1000) return reply(`Run ${prefix}kickoffline scan first (results expire after 5 minutes).`);
        pendingKick.delete(jid);
        let done = 0;
        for (let i = 0; i < pend.ids.length; i += 5) {
          const batch = pend.ids.slice(i, i + 5);
          try {
            await sock.groupParticipantsUpdate(jid, batch, 'remove');
            done += batch.length;
          } catch (e) {
            console.error('kickoffline error:', e.message);
            break;
          }
          await sleep(2000);
        }
        return reply(`✅ Removed ${done} member(s).${done < pend.ids.length ? ' Stopped early: is the bot a group admin?' : ''}`);
      }

      if (sub !== 'scan') return reply(`Usage: ${prefix}kickoffline scan | kick`);
      const meta = await sock.groupMetadata(jid);
      const me = num(sock.user.id);
      const candidates = meta.participants.filter((p) => !p.admin && num(p.id) !== me && num(p.id) !== OWNER).map((p) => p.id).slice(0, 100);
      if (!candidates.length) return reply('No members to scan.');

      const online = new Set();
      const onPresence = ({ presences }) => {
        for (const [id, p] of Object.entries(presences || {})) {
          if (['available', 'composing', 'recording'].includes(p.lastKnownPresence)) online.add(id);
        }
      };
      sock.ev.on('presence.update', onPresence);
      await reply(`🔎 Scanning ${candidates.length} members for 20 seconds...`);
      for (const id of candidates) {
        try { await sock.presenceSubscribe(id); } catch {}
      }
      await sleep(20000);
      sock.ev.off('presence.update', onPresence);

      const offline = candidates.filter((id) => !online.has(id));
      pendingKick.set(jid, { ids: offline, at: Date.now() });
      await reply(
        `📴 ${offline.length} of ${candidates.length} members looked offline.\n\n` +
          `⚠️ Members who hide their "online" status always look offline, so this can include active people. Admins and you are never included.\n\n` +
          `To remove them, send ${prefix}kickoffline kick within 5 minutes.`
      );
    },
  },
  antistatus: toggle('antistatus', 'antistatus', 'Block status-mention posts in groups'),
  groupinfo: {
    cat: 'ADMIN',
    desc: 'Show group details',
    group: true,
    run: async ({ sock, jid, reply }) => {
      const m = await sock.groupMetadata(jid);
      await reply(`👥 *${m.subject}*\nMembers: ${m.participants.length}\nCreated: ${new Date(m.creation * 1000).toLocaleDateString('en-GB')}\n\n${m.desc || 'No description.'}`);
    },
  },
  accept: {
    cat: 'ADMIN',
    desc: 'Approve join requests',
    owner: true,
    group: true,
    run: async ({ sock, jid, reply }) => {
      try {
        const list = await sock.groupRequestParticipantsList(jid);
        if (!list || !list.length) return reply('No pending join requests.');
        await sock.groupRequestParticipantsUpdate(jid, list.map((p) => p.jid || p.id), 'approve');
        await reply(`✅ Approved ${list.length} request(s).`);
      } catch (e) {
        console.error('accept error:', e.message);
        await reply('❌ Could not approve requests. Is the bot a group admin?');
      }
    },
  },
  setprefix: {
    cat: 'ADMIN',
    desc: 'Change prefix (or none)',
    usage: '(char)',
    owner: true,
    run: async ({ reply, args }) => {
      const v = args[0];
      if (!v || v.length > 3) return reply('Usage: setprefix ! | setprefix . | setprefix none');
      const p = v.toLowerCase() === 'none' ? '' : v;
      settings.set('prefix', p);
      await reply(`🔣 Prefix is now *${p || 'none (blank)'}*`);
    },
  },
  setwelcome: {
    cat: 'ADMIN',
    desc: 'Set welcome text',
    usage: '(text)',
    owner: true,
    run: async ({ reply, args }) => {
      if (!args.length) return reply('Usage: setwelcome <text>\nPlaceholders: {user} {group} {count} {prefix}\n\nCurrent:\n' + settings.get('welcometext'));
      settings.set('welcometext', args.join(' '));
      await reply('✅ Welcome message updated. Turn it on with: welcome on');
    },
  },
  settings: {
    cat: 'ADMIN',
    desc: 'Show all settings',
    owner: true,
    run: async ({ reply }) => {
      const rows = settings.TOGGLES.map((k) => `${onOff(settings.get(k))}  ${k}`).join('\n');
      await reply(`⚙️ *Settings*\n\nMode: *${settings.get('mode')}*\nPrefix: *${settings.get('prefix') || 'none'}*\nAnti-link: *${settings.get('antilink')}*\n\n${rows}`);
    },
  },

  // ---- hidden (not shown in menu) ----
  set: {
    cat: 'ADMIN',
    hidden: true,
    desc: 'set <name> on|off',
    owner: true,
    run: async ({ reply, args }) => {
      const key = (args[0] || '').toLowerCase();
      const val = (args[1] || '').toLowerCase();
      if (!settings.TOGGLES.includes(key) || !['on', 'off'].includes(val)) return reply(`Usage: set <name> on|off\n\nNames: ${settings.TOGGLES.join(', ')}`);
      settings.set(key, val === 'on');
      await reply(`${onOff(val === 'on')}  ${key}`);
    },
  },
};
// aliases (hidden)
all.autoreact = { ...all.autoreacts, hidden: true };
all.mode = {
  cat: 'ADMIN',
  hidden: true,
  desc: 'mode public|private',
  owner: true,
  run: async ({ reply, args }) => {
    const v = (args[0] || '').toLowerCase();
    if (!['public', 'private'].includes(v)) return reply(`Current mode: *${settings.get('mode')}*`);
    settings.set('mode', v);
    await reply(`Mode: *${v}*`);
  },
};

const ORDER = [
  // USER CMDS
  'autoreacts', 'antilink', 'antidelete', 'ai', 'owner', 'dp', 'ping', 'translate',
  // TOOLS
  'apk', 'facebook', 'tiktok', 'insta', 'song', 'video', 'joke', 'meme', 'emojimix', 'character', 'gdrive', 'mf',
  // ADMIN
  'private', 'public', 'autoread', 'status', 'hack', 'hidetag', 'tagall', 'setname', 'anticall', 'kickoffline', 'antistatus', 'groupinfo', 'accept',
];
const commands = {};
for (const name of ORDER) if (all[name]) commands[name] = all[name];
// extras (not in your menu) are added after
for (const [name, def] of Object.entries(all)) if (!commands[name]) commands[name] = def;

module.exports = { commands, smartReply };
