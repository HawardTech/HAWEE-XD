# HAWEE-XD

A WhatsApp bot built with Node.js and [Baileys](https://github.com/WhiskeySockets/Baileys) (multi-device). Logs in with a pairing code, no QR scan needed.

## Features
- Pairing-code login, multi-device
- Styled menu grouped by category
- Public / private mode (owner-only commands when private)
- Custom prefix (`.`, `!`, or none), changeable from chat
- Auto status view and react
- Auto react, auto read, auto typing
- Anti-delete (deleted messages are forwarded to your own chat)
- Keyword chatbot for private chats
- Group welcome message (customisable)
- Pairing web page that generates a SESSION_ID
- Settings saved in `data/settings.json`, changeable from chat

## Setup
```bash
git clone https://github.com/HawardTech/HAWEE-XD
cd HAWEE-XD
npm install @whiskeysockets/baileys pino dotenv
cp .env.example .env     # edit your numbers
node index.js
```
A pairing code prints in the terminal. In WhatsApp: **Linked devices > Link a device > Link with phone number**.

## Commands
Use `.menu` to see them all. Owner settings commands:

| Command | What it does |
| --- | --- |
| `.mode public` / `.mode private` | Who can use the bot |
| `.setprefix !` / `.setprefix none` | Change the prefix |
| `.settings` | Show every toggle |
| `.set antidelete on` | Turn a feature on or off |
| `.setwelcome <text>` | Welcome text. Placeholders: `{user}` `{group}` `{count}` `{prefix}` |

Toggles: `autoviewstatus`, `autostatusreact`, `autoreact`, `autoread`, `autotyping`, `antidelete`, `welcome`, `chatbot`.

## Pairing page and SESSION_ID
Run `node pair.js` (set `PAIR_PASSWORD` in `.env` first) and open `http://127.0.0.1:3000`. Enter the password and your number, type the code in WhatsApp, and copy the `SESSION_ID` it shows. On a host, add it as the `SESSION_ID` environment variable and the bot logs in without a saved session. Treat it like a password, and never commit it.

On a cloud host, deploy once with start command `node pair.js` and `HOST=0.0.0.0`, grab the SESSION_ID, then change the start command to `node index.js`.

## Adding a command
Add an entry to `commands.js`:
```js
hello: { cat: '🎲 FUN', desc: 'Say hello', run: async ({ reply }) => reply('Hello!') },
```

## Hosting
A `Dockerfile` is included. Mount a persistent volume at `/app/session` (and `/app/data`), or the bot loses its login on restart.

## Disclaimer
Not affiliated with WhatsApp Inc. Automating a personal account can get it banned. Use a spare number, at your own risk.

## License
MIT
