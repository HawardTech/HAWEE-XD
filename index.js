// HAWEE-XD - WhatsApp bot built on Baileys (multi-device)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  normalizeMessageContent,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const settings = require('./settings');
const { commands, smartReply } = require('./commands');

const BOT_NAME = process.env.BOT_NAME || 'HAWEE-XD';
const OWNER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const PHONE = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');
const SESSION_DIR = process.env.SESSION_DIR || 'session';
const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '🙏', '💯', '✨'];
const LINK_RE = /(https?:\/\/|chat\.whatsapp\.com\/|www\.)\S+/i;

// Tiny web server so hosts that need an open port (Render, Koyeb...) see the app as healthy
if (process.env.PORT) {
  require('http')
    .createServer((req, res) => res.end(`${BOT_NAME} is running`))
    .on('error', () => {})
    .listen(Number(process.env.PORT), '0.0.0.0');
}

let announced = false; // send the 'connected' message once per run
let pairingRequested = false; // only ask for ONE pairing code per run
const sent = new Set(); // ids of messages the bot sent (avoid reacting to itself)
const store = new Map(); // recent messages, used by anti-delete
const lastChatbot = new Map(); // per-chat cooldown for chatbot replies

// If SESSION_ID is set (from the pairing page) and there is no saved login yet, restore it
function restoreSession() {
  const id = process.env.SESSION_ID;
  const file = path.join(SESSION_DIR, 'creds.json');
  if (!id || fs.existsSync(file)) return;
  try {
    const raw = zlib.gunzipSync(Buffer.from(id.replace(/^HAWEE~/, ''), 'base64'));
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(file, raw);
    console.log('Session restored from SESSION_ID');
  } catch (e) {
    console.error('Invalid SESSION_ID:', e.message);
  }
}

async function start() {
  restoreSession();
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), // pairing codes need a standard browser id
  });

  const meJid = () => sock.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';

  const send = async (jid, content, opts) => {
    const res = await sock.sendMessage(jid, content, opts);
    if (res?.key?.id) {
      sent.add(res.key.id);
      if (sent.size > 1000) sent.delete(sent.values().next().value);
    }
    return res;
  };

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    // First-time login: when WhatsApp is ready to link, ask for ONE pairing code
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      if (!PHONE) {
        console.error('Set PHONE_NUMBER (country code, no +) or SESSION_ID.');
        process.exit(1);
      }
      try {
        const code = await sock.requestPairingCode(PHONE);
        console.log(`\nPairing code: ${code}`);
        console.log('WhatsApp > Linked devices > Link a device > Link with phone number\n');
      } catch (e) {
        console.error('Could not get pairing code:', e.message);
      }
    }

    if (connection === 'open') {
      console.log(`✅ ${BOT_NAME} connected`);
      if (!announced) {
        announced = true;
        try {
          const p = settings.get('prefix');
          await send(meJid(), {
            text:
              `✅ *${settings.get('botname') || BOT_NAME}* is online!\n\n` +
              `${settings.get('mode') === 'private' ? '🔒' : '🔓'} Mode: ${settings.get('mode')}\n` +
              `🔣 Prefix: ${p || 'none'}\n\nType ${p}menu to begin.`,
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

  // Reject incoming calls (anticall)
  sock.ev.on('call', async (calls) => {
    if (!settings.get('anticall')) return;
    for (const c of calls) {
      if (c.status !== 'offer') continue;
      try {
        await sock.rejectCall(c.id, c.from);
        await send(c.from, { text: '📵 Calls are not allowed. Please send a message instead.' });
      } catch (e) {
        console.error('anticall error:', e.message);
      }
    }
  });

  // Welcome new group members
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action !== 'add' || !settings.get('welcome')) return;
    try {
      const meta = await sock.groupMetadata(id);
      for (const p of participants) {
        const jid = typeof p === 'string' ? p : p.id;
        const text = settings
          .get('welcometext')
          .replace(/{user}/g, `@${jid.split('@')[0]}`)
          .replace(/{group}/g, meta.subject)
          .replace(/{count}/g, meta.participants.length)
          .replace(/{prefix}/g, settings.get('prefix'));
        await send(id, { text, mentions: [jid] });
      }
    } catch (e) {
      console.error('Welcome error:', e.message);
    }
  });

  // Anti-delete: forward deleted messages to the bot owner's chat
  const onDelete = async (proto) => {
    const orig = store.get(proto.key?.id);
    if (!orig || orig.key.fromMe) return;
    const who = orig.key.participant || orig.key.remoteJid;
    await send(meJid(), {
      text: `🗑 *Anti-delete*\nFrom: @${who.split('@')[0]}\nChat: ${orig.key.remoteJid}`,
      mentions: [who],
    });
    await send(meJid(), { forward: orig });
  };

  // Is the sender of a group message exempt (admin / owner)?
  const senderExempt = async (msg, jid) => {
    const meta = await sock.groupMetadata(jid);
    const ids = [msg.key.participant, msg.key.participantAlt].filter(Boolean);
    if (!ids.length) return { exempt: true, ids };
    const entry = meta.participants.find((p) => ids.some((i) => i === p.id || i === p.phoneNumber || i === p.lid));
    if (entry?.admin) return { exempt: true, ids };
    if (OWNER && ids.some((i) => i.split('@')[0].split(':')[0] === OWNER)) return { exempt: true, ids };
    return { exempt: false, ids };
  };

  // Anti-link: delete links posted by non-admins (bot must be admin). Returns true if it acted.
  const antiLink = async (msg, jid) => {
    try {
      const { exempt, ids } = await senderExempt(msg, jid);
      if (exempt) return false;
      await sock.sendMessage(jid, { delete: msg.key });
      await send(jid, { text: `🚫 @${ids[0].split('@')[0]} links are not allowed here.`, mentions: [ids[0]] });
      if (settings.get('antilink') === 'kick') await sock.groupParticipantsUpdate(jid, [ids[0]], 'remove');
      return true;
    } catch (e) {
      console.error('antilink error:', e.message);
      return false;
    }
  };

  // Anti-status: delete "mentioned this group in a status" posts from non-admins
  const antiStatus = async (msg, jid) => {
    try {
      const { exempt } = await senderExempt(msg, jid);
      if (exempt) return false;
      await sock.sendMessage(jid, { delete: msg.key });
      return true;
    } catch (e) {
      console.error('antistatus error:', e.message);
      return false;
    }
  };

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        const jid = msg.key.remoteJid;
        if (!jid || sent.has(msg.key.id)) continue;

        // Status updates: auto view / react
        if (jid === 'status@broadcast') {
          if (settings.get('autoviewstatus')) await sock.readMessages([msg.key]);
          if (settings.get('statusdownload') && msg.message && !msg.key.fromMe && msg.key.participant) {
            await send(meJid(), { text: `📥 Status from @${msg.key.participant.split('@')[0]}`, mentions: [msg.key.participant] });
            await send(meJid(), { forward: msg });
          }
          if (settings.get('autostatusreact') && msg.key.participant) {
            await sock.sendMessage(
              'status@broadcast',
              { react: { key: msg.key, text: '💚' } },
              { statusJidList: [msg.key.participant, sock.user.id] }
            );
          }
          continue;
        }

        const content = normalizeMessageContent(msg.message);
        if (!content) continue;
        if (Date.now() / 1000 - Number(msg.messageTimestamp || 0) > 60) continue; // skip history

        const raw = msg.message || {};
        if (jid.endsWith('@g.us') && !msg.key.fromMe && settings.get('antistatus') && (raw.groupStatusMentionMessage || raw.statusMentionMessage || content.groupStatusMentionMessage || content.statusMentionMessage)) {
          if (await antiStatus(msg, jid)) continue;
        }

        if (content.protocolMessage) {
          if (content.protocolMessage.type === 0 && settings.get('antidelete')) {
            await onDelete(content.protocolMessage);
          }
          continue;
        }

        store.set(msg.key.id, msg);
        if (store.size > 500) store.delete(store.keys().next().value);

        const fromMe = !!msg.key.fromMe;
        const text =
          content.conversation ||
          content.extendedTextMessage?.text ||
          content.imageMessage?.caption ||
          content.videoMessage?.caption ||
          '';
        if (text) console.log(`📩 ${fromMe ? 'me' : jid}: ${text.slice(0, 80)}`);

        // Anti-link (groups)
        if (jid.endsWith('@g.us') && !fromMe && text && settings.get('antilink') !== 'off' && LINK_RE.test(text)) {
          if (await antiLink(msg, jid)) continue;
        }

        if (!fromMe) {
          if (settings.get('autoread')) await sock.readMessages([msg.key]);
          if (settings.get('autoreact')) {
            const emoji = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
            await send(jid, { react: { text: emoji, key: msg.key } });
          }
        }

        // Parse command
        const prefix = settings.get('prefix');
        let cmd;
        let args = [];
        if (text && text.startsWith(prefix)) {
          const [name, ...rest] = text.slice(prefix.length).trim().split(/\s+/);
          cmd = commands[(name || '').toLowerCase()];
          args = rest;
        }

        // Not a command: optional chatbot reply in private chats
        if (!cmd) {
          if (!fromMe && text && settings.get('chatbot') && !jid.endsWith('@g.us')) {
            if (Date.now() - (lastChatbot.get(jid) || 0) < 8000) continue;
            lastChatbot.set(jid, Date.now());
            const r = await smartReply(jid, text);
            if (r) await send(jid, { text: r }, { quoted: msg });
          }
          continue;
        }

        const sender = msg.key.participant || jid;
        const isOwner = fromMe || (OWNER && sender.split('@')[0].split(':')[0] === OWNER);
        if (settings.get('mode') === 'private' && !isOwner) continue;

        const reply = (t) => send(jid, { text: t }, { quoted: msg });
        if (cmd.owner && !isOwner) { await reply('🔒 Owner only.'); continue; }
        if (cmd.group && !jid.endsWith('@g.us')) { await reply('👥 This command works in groups only.'); continue; }

        // mentions / quoted message info for commands like dp, character, translate
        const info = content.extendedTextMessage?.contextInfo || {};
        const quoted = info.quotedMessage ? normalizeMessageContent(info.quotedMessage) : null;
        const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';

        if (settings.get('autotyping')) await sock.sendPresenceUpdate('composing', jid);
        await cmd.run({
          sock, msg, args, jid, isOwner, prefix, send, reply,
          sender,
          mentions: info.mentionedJid || [],
          quotedParticipant: info.participant,
          quotedText,
        });
      } catch (err) {
        console.error('Command error:', err);
      }
    }
  });
}

start();
