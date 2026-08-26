FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY agents/telegram-member-agent/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY agents/telegram-member-agent/index.js ./index.js

USER node
CMD ["node", "index.js"]
