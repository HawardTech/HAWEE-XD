# HAWEE-XD

A simple WhatsApp bot built with Node.js and [Baileys](https://github.com/WhiskeySockets/Baileys) (multi-device). Logs in with a pairing code, so no QR scan is needed.

## Features
- Pairing-code login
- Command handler with a configurable prefix
- Auto status view / react (optional)
- Auto typing indicator (optional)
- Commands: `ping`, `menu`, `echo`, `uptime`, `owner`

## Setup
```bash
git clone https://github.com/HawardTech/HAWEE-XD
cd HAWEE-XD
npm install @whiskeysockets/baileys pino dotenv
cp .env.example .env     # then edit .env with your numbers
node index.js
```
A pairing code prints in the terminal. In WhatsApp go to **Linked devices > Link a device > Link with phone number** and enter it.

## Settings (`.env`)
| Variable | Meaning |
| --- | --- |
| `BOT_NAME` | Name shown in the menu and Linked devices |
| `PREFIX` | Command prefix, default `.` |
| `PHONE_NUMBER` | Number to link (country code, no +) |
| `OWNER_NUMBER` | Number allowed to use owner commands |
| `AUTO_STATUS_VIEW` | `true` to auto-view statuses |
| `AUTO_STATUS_REACT` | `true` to auto-react to statuses |
| `AUTO_TYPING` | `true` to show "typing..." |

## Adding a command
Add an entry to the `commands` object in `index.js`:
```js
hello: {
  desc: 'Say hello',
  run: async ({ reply }) => reply('Hello!'),
},
```

## Hosting
A `Dockerfile` is included. Mount a persistent volume at `/app/session`, or the bot loses its login on every restart.

## Disclaimer
This project is not affiliated with WhatsApp Inc. Automating a personal account can get it banned. Use a spare number and use it at your own risk.

## License
MIT
