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
Send `.menu` for the full list. Highlights:

| Group | Commands |
| --- | --- |
| User | `autoreacts` `antilink` `antidelete` `ai` `owner` `dp` `ping` `translate` (+ `menu` `alive` `uptime` `time`) |
| Tools | `apk` `facebook` `tiktok` `insta` `song` `video` `joke` `meme` `emojimix` `character` `gdrive` `mf` (+ `imagine` `echo` `calc` `flip` `dice`) |
| Admin | `private` `public` `autoread` `status` `hack` `hidetag` `tagall` `setname` `anticall` `kickoffline` `antistatus` `groupinfo` `accept` (+ `autotyping` `welcome` `setwelcome` `setprefix` `settings`) |

Features that take `[on/off]` are owner-only and saved in `data/settings.json`. `antilink` also takes `kick`. `status` takes `on|off`, `seen`, `like`, `download` or `system`. `kickoffline` takes `scan` then `kick`.

## Downloads (yt-dlp)
`song`, `video`, `insta` and `facebook` use [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg.
- **Termux:** `pkg install python ffmpeg yt-dlp`
- **Docker / Render:** already installed by the included `Dockerfile`.

Notes: files are limited to `MAX_DOWNLOAD_MB` (default 50) and 20 minutes. YouTube often blocks data-centre IPs (cloud hosts), so it works best from a home connection. Instagram often needs a login: export a `cookies.txt` and set `YTDLP_COOKIES`. Only download content you have the right to use.

## Optional keys
- `ANTHROPIC_API_KEY`: makes `.ai` answer with Claude instead of simple keyword replies.
- `TENOR_KEY`: enables `.emojimix`.

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
