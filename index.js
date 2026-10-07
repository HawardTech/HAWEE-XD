// HAWEE-XD - WhatsApp bot built on Baileys (multi-device)
require('dotenv').config();
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// ---- Config (from .env) ----
const BOT_NAME = process.env.BOT_NAME || 'HAWEE-XD';
const PREFIX = process.env.BOT_PREFIX || '.';
const OWNER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const PHONE = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');
const AUTO_STATUS_VIEW = process.env.AUTO_STATUS_VIEW === 'true';
const AUTO_STATUS_REACT = process.env.AUTO_STATUS_REACT === 'true';
const AUTO_TYPING = process.env.AUTO_TYPING === 'true';
const SESSION_DIR = process.env.SESSION_DIR || 'session';

const startedAt = Date.now();

// ---- Commands: add your own here ----
const commands = {
  ping: {
    desc: 'Check if the bot is alive',
    run: async ({ reply }) => reply('Pong! 🏓'),
  },
  menu: {
    desc: 'Show all commands',
    run: async ({ reply }) => {
      const list = Object.entries(commands)
        .map(([name, c]) => `• ${PREFIX}${name} - ${c.desc}`)
        .join('\n');
      await reply(`*${BOT_NAME}*\n\n${list}`);
    },
  },
  echo: {
    desc: 'Repeat your text',
    run: async ({ reply, args }) =>
      reply(args.join(' ') || `Usage: ${PREFIX}echo hello`),
  },
  uptime: {
    desc: 'How long the bot has been running',
    run: async ({ reply }) => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      await reply(`⏱ Uptime: ${h}h ${m}m ${s % 60}s`);
    },
  },
  owner: {
    desc: 'Owner check',
    run: async ({ reply, isOwner }) =>
      reply(isOwner ? 'You are the owner 👑' : 'Owner only.'),
  },
};

let announced = false; // send the 'connected' message once per run
let pairingRequested = false; // only ask for ONE pairing code per run

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), // pairing codes need a standard browser id
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    // First-time login: when WhatsApp is ready to link, ask for ONE pairing code
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      if (!PHONE) {
        console.error('Set PHONE_NUMBER in .env (country code, no +).');
        process.exit(1);
      }
      try {
        const code = await sock.requestPairingCode(PHONE);
        console.log(`\nPairing code: ${code}`);
        console.log('WhatsApp > Linked devices > Link a device > Link with phone number');
        console.log('(you also get a notification on the phone; enter the code within ~60s)\n');
      } catch (e) {
        console.error('Could not get pairing code:', e.message);
      }
    }

    if (connection === 'open') {
      console.log(`✅ ${BOT_NAME} connected`);
      if (!announced) {
        announced = true;
        try {
          const me = sock.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
          await sock.sendMessage(me, {
            text: `✅ *${BOT_NAME}* is connected!\nPrefix: ${PREFIX}\nSend ${PREFIX}menu to see commands.`,
          });
        } catch (e) {
          console.error('Could not send connected alert:', e.message);
        }
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('Connection closed. Status code:', code, lastDisconnect?.error?.message || '');
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Session cleared; run the bot again to re-pair.');
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        process.exit(0);
      } else {
        console.log('Reconnecting...');
        setTimeout(start, 2000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        const jid = msg.key.remoteJid;

        // Status updates: auto view / react
        if (jid === 'status@broadcast') {
          if (AUTO_STATUS_VIEW) await sock.readMessages([msg.key]);
          if (AUTO_STATUS_REACT && msg.key.participant) {
            await sock.sendMessage(
              'status@broadcast',
              { react: { key: msg.key, text: '💚' } },
              { statusJidList: [msg.key.participant, sock.user.id] }
            );
          }
          continue;
        }

        if (!msg.message) continue;
        const age = Date.now() / 1000 - Number(msg.messageTimestamp || 0);
        if (age > 60) continue; // ignore old/history messages

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          '';
        if (text) console.log(`📩 ${msg.key.fromMe ? 'me' : jid}: ${text.slice(0, 80)}`);
        if (!text.startsWith(PREFIX)) continue;
        if (AUTO_TYPING) await sock.sendPresenceUpdate('composing', jid);

        const [name, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = commands[name.toLowerCase()];
        if (!cmd) continue;

        const sender = (msg.key.participant || jid).split('@')[0];
        await cmd.run({
          sock,
          msg,
          args,
          jid,
          isOwner: msg.key.fromMe || sender === OWNER,
          reply: (t) => sock.sendMessage(jid, { text: t }, { quoted: msg }),
        });
      } catch (err) {
        console.error('Command error:', err);
      }
    }
  });
}

start();
