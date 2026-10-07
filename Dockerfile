FROM node:20-slim
RUN apt-get update \
 && apt-get install -y git ffmpeg python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Mount a persistent volume at /app/session so the login survives restarts
CMD ["node", "index.js"]
