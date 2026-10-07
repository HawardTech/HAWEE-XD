const settings = require('./settings');

const BOT_NAME = process.env.BOT_NAME || 'HAWEE-XD';
const TZ = process.env.TIMEZONE || 'Africa/Nairobi';
const startedAt = Date.now();
const lastImage = new Map(); // per-chat cooldown for .imagine

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
  "It works on my machine. 🤷",
];

// Keyword replies used when CHATBOT is on (private chats only)
const CHATBOT_RULES = [
  [/^(hi|hello|hey|yo|sup)\b/i, 'Hey there! 👋 Type .menu to see what I can do.'],
  [/how are you|how r u/i, "I'm running smoothly. How can I help? 🤖"],
  [/\b(thanks|thank you|thx)\b/i, "You're welcome! 😊"],
  [/who are you|your name/i, `I'm *${BOT_NAME}*, a WhatsApp bot by HawardTech.`],
];
const chatbotReply = (text) => (CHATBOT_RULES.find(([re]) => re.test(text)) || [])[1];

const onOff = (v) => (v ? '✅ on' : '❌ off');

// Commands are grouped by `cat` in the menu, in the order they appear here.
const commands = {
  // ---------- GENERAL ----------
  menu: {
    cat: '🏠 GENERAL',
    desc: 'Show this menu',
    run: async ({ reply, msg }) => {
      const prefix = settings.get('prefix');
      const mode = settings.get('mode');
      const groups = {};
      for (const [name, c] of Object.entries(commands)) {
        (groups[c.cat] = groups[c.cat] || []).push(`│ ➤ ${prefix}${name} — ${c.desc}`);
      }
      const body = Object.entries(groups)
        .map(([cat, lines]) => `╭─❮ ${cat} ❯\n${lines.join('\n')}\n╰──────────────`)
        .join('\n\n');
      await reply(
        `╭━━━━━━━━━━━━━━╮\n┃   ✨ *${BOT_NAME}* ✨\n╰━━━━━━━━━━━━━━╯\n\n` +
          `👤 Hi, *${msg.pushName || 'there'}*\n` +
          `${mode === 'private' ? '🔒' : '🔓'} Mode: *${mode}*\n` +
          `🔣 Prefix: *${prefix || 'none'}*\n` +
          `⏱ Uptime: ${uptime()}\n\n${body}\n\n_⚡ Powered by HawardTech_`
      );
    },
  },
  ping: {
    cat: '🏠 GENERAL',
    desc: 'Check bot speed',
    run: async ({ reply, msg }) => {
      const ms = Date.now() - Number(msg.messageTimestamp) * 1000;
      await reply(`Pong! 🏓 ${Math.max(ms, 0)}ms`);
    },
  },
  alive: { cat: '🏠 GENERAL', desc: 'Is the bot online?', run: async ({ reply }) => reply(`✅ *${BOT_NAME}* is alive and running!`) },
  uptime: { cat: '🏠 GENERAL', desc: 'Time since start', run: async ({ reply }) => reply(`⏱ Uptime: ${uptime()}`) },
  time: {
    cat: '🏠 GENERAL',
    desc: 'Current date and time',
    run: async ({ reply }) => reply(`🕒 ${new Date().toLocaleString('en-GB', { timeZone: TZ })} (${TZ})`),
  },
  owner: {
    cat: '🏠 GENERAL',
    desc: 'Are you the owner?',
    run: async ({ reply, isOwner }) => reply(isOwner ? 'You are the owner 👑' : 'You are not the owner.'),
  },

  // ---------- TOOLS ----------
  echo: {
    cat: '🧰 TOOLS',
    desc: 'Repeat your text',
    run: async ({ reply, args }) => reply(args.join(' ') || 'Usage: echo hello'),
  },
  calc: {
    cat: '🧰 TOOLS',
    desc: 'Calculator, e.g. calc 2*(3+4)',
    run: async ({ reply, args }) => {
      const expr = args.join(' ');
      if (!expr || !/^[0-9+\-*/().%\s]+$/.test(expr)) return reply('Usage: calc 2*(3+4)');
      try {
        const result = Function(`"use strict"; return (${expr})`)();
        await reply(`🧮 ${expr} = *${result}*`);
      } catch {
        await reply('Invalid expression.');
      }
    },
  },

  // ---------- FUN ----------
  flip: { cat: '🎲 FUN', desc: 'Flip a coin', run: async ({ reply }) => reply(Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails') },
  dice: { cat: '🎲 FUN', desc: 'Roll a dice', run: async ({ reply }) => reply(`🎲 You rolled *${1 + Math.floor(Math.random() * 6)}*`) },
  joke: { cat: '🎲 FUN', desc: 'Random tech joke', run: async ({ reply }) => reply(JOKES[Math.floor(Math.random() * JOKES.length)]) },

  // ---------- GROUP ----------
  tagall: {
    cat: '👥 GROUP',
    desc: 'Mention everyone (owner)',
    owner: true,
    group: true,
    run: async ({ sock, jid, msg, args, send }) => {
      const meta = await sock.groupMetadata(jid);
      const ids = meta.participants.map((p) => p.id);
      const text = `📢 *${args.join(' ') || 'Attention everyone!'}*\n\n` + ids.map((i) => `@${i.split('@')[0]}`).join('\n');
      await send(jid, { text, mentions: ids }, { quoted: msg });
    },
  },
  groupinfo: {
    cat: '👥 GROUP',
    desc: 'Show group details',
    group: true,
    run: async ({ sock, jid, reply }) => {
      const m = await sock.groupMetadata(jid);
      const created = new Date(m.creation * 1000).toLocaleDateString('en-GB');
      await reply(`👥 *${m.subject}*\nMembers: ${m.participants.length}\nCreated: ${created}\n\n${m.desc || 'No description.'}`);
    },
  },

  // ---------- DOWNLOAD ----------
  tiktok: {
    cat: '📥 DOWNLOAD',
    desc: 'tiktok <link> (no watermark)',
    run: async ({ jid, msg, args, reply, send }) => {
      const url = args[0];
      if (!url || !/^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(url)) {
        return reply('Usage: tiktok https://www.tiktok.com/@user/video/123...');
      }
      await reply('⏳ Downloading...');
      try {
        const res = await fetch('https://www.tikwm.com/api/?url=' + encodeURIComponent(url), {
          signal: AbortSignal.timeout(20000),
        });
        const json = await res.json();
        const d = json && json.data;
        if (!json || json.code !== 0 || !d || !d.play) {
          return reply('❌ Could not fetch that video. It may be private or removed.');
        }
        const videoUrl = d.play.startsWith('/') ? 'https://www.tikwm.com' + d.play : d.play;
        await send(
          jid,
          { video: { url: videoUrl }, caption: `🎵 ${d.title || 'TikTok video'}\n\n_via ${BOT_NAME}_` },
          { quoted: msg }
        );
      } catch (e) {
        console.error('tiktok error:', e.message);
        await reply('❌ Download failed. Try again later.');
      }
    },
  },

  // ---------- AI ----------
  imagine: {
    cat: '🎨 AI',
    desc: 'imagine <prompt> (make an image)',
    run: async ({ jid, msg, args, reply, send }) => {
      const prompt = args.join(' ').trim();
      if (!prompt) return reply('Usage: imagine a lion wearing a spacesuit, digital art');
      if (prompt.length > 300) return reply('Keep the prompt under 300 characters.');
      if (Date.now() - (lastImage.get(jid) || 0) < 15000) return reply('⏳ Please wait a few seconds between images.');
      lastImage.set(jid, Date.now());
      await reply('🎨 Generating, this can take up to a minute...');
      try {
        const url =
          'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
          `?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/')) throw new Error(`bad response ${res.status} ${type}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        await send(jid, { image: buffer, caption: `🎨 ${prompt}\n\n_via ${BOT_NAME}_` }, { quoted: msg });
      } catch (e) {
        console.error('imagine error:', e.message);
        await reply('❌ Could not generate that image. Try again or change the prompt.');
      }
    },
  },

  // ---------- SETTINGS (owner) ----------
  mode: {
    cat: '⚙️ SETTINGS',
    desc: 'mode public|private',
    owner: true,
    run: async ({ reply, args }) => {
      const v = (args[0] || '').toLowerCase();
      if (!['public', 'private'].includes(v)) return reply(`Current mode: *${settings.get('mode')}*\nUsage: mode public | private`);
      settings.set('mode', v);
      await reply(v === 'private' ? '🔒 Private mode: only the owner can use commands.' : '🔓 Public mode: everyone can use commands.');
    },
  },
  setprefix: {
    cat: '⚙️ SETTINGS',
    desc: 'Change prefix (or "none")',
    owner: true,
    run: async ({ reply, args }) => {
      const v = args[0];
      if (!v || v.length > 3) return reply('Usage: setprefix ! | setprefix . | setprefix none');
      const p = v.toLowerCase() === 'none' ? '' : v;
      settings.set('prefix', p);
      await reply(`🔣 Prefix is now *${p || 'none (blank)'}*`);
    },
  },
  settings: {
    cat: '⚙️ SETTINGS',
    desc: 'Show all settings',
    owner: true,
    run: async ({ reply }) => {
      const rows = settings.TOGGLES.map((k) => `${onOff(settings.get(k))}  ${k}`).join('\n');
      await reply(
        `⚙️ *Settings*\n\nMode: *${settings.get('mode')}*\nPrefix: *${settings.get('prefix') || 'none'}*\n\n${rows}\n\nChange: set <name> on|off`
      );
    },
  },
  set: {
    cat: '⚙️ SETTINGS',
    desc: 'set <name> on|off',
    owner: true,
    run: async ({ reply, args }) => {
      const key = (args[0] || '').toLowerCase();
      const val = (args[1] || '').toLowerCase();
      if (!settings.TOGGLES.includes(key) || !['on', 'off'].includes(val)) {
        return reply(`Usage: set <name> on|off\n\nNames: ${settings.TOGGLES.join(', ')}`);
      }
      settings.set(key, val === 'on');
      await reply(`${onOff(val === 'on')}  ${key}`);
    },
  },
  setwelcome: {
    cat: '⚙️ SETTINGS',
    desc: 'Set group welcome text',
    owner: true,
    run: async ({ reply, args }) => {
      if (!args.length) {
        return reply('Usage: setwelcome <text>\nPlaceholders: {user} {group} {count} {prefix}\n\nCurrent:\n' + settings.get('welcometext'));
      }
      settings.set('welcometext', args.join(' '));
      await reply('✅ Welcome message updated. Turn it on with: set welcome on');
    },
  },
};

module.exports = { commands, chatbotReply };
