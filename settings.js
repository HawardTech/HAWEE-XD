// Persistent bot settings. Defaults come from .env; changes made with
// chat commands (.set, .mode, .setprefix ...) are saved to data/settings.json
const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || 'data', 'settings.json');

const DEFAULT_WELCOME =
  '👋 Welcome {user} to *{group}*!\n\n' +
  '🚀 You just joined a growing tech community.\n' +
  '📌 Be respectful, share ideas and ask questions freely.\n' +
  '💡 Type {prefix}menu to see what I can do.';

const first = (names) => names.map((n) => process.env[n]).find((v) => v !== undefined);
const flag = (names) => first(names) === 'true';

const defaults = {
  prefix: process.env.BOT_PREFIX ?? '.',
  mode: process.env.MODE === 'private' ? 'private' : 'public',
  autoviewstatus: flag(['AUTO_VIEW_STATUS', 'AUTO_STATUS_VIEW']),
  autostatusreact: flag(['AUTO_STATUS_REACT']),
  autoreact: flag(['AUTO_REACT']),
  autoread: flag(['AUTO_READ_MESSAGES']),
  autotyping: flag(['AUTO_TYPING']),
  antidelete: flag(['ANTIDELETE']),
  welcome: flag(['WELCOME']),
  chatbot: flag(['CHATBOT']),
  welcometext: DEFAULT_WELCOME,
};

const TOGGLES = [
  'autoviewstatus', 'autostatusreact', 'autoreact', 'autoread',
  'autotyping', 'antidelete', 'welcome', 'chatbot',
];

let data = { ...defaults };
try {
  Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch {}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  TOGGLES,
  get: (key) => data[key],
  set: (key, value) => {
    data[key] = value;
    save();
  },
};
