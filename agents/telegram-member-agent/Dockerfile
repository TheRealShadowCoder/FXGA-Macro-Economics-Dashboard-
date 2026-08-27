FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY agents/telegram-member-agent/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY agents/telegram-member-agent/index.js ./index.js
COPY agents/telegram-member-agent/admin-server.js ./admin-server.js
COPY agents/telegram-member-agent/admin-bootstrap.js ./admin-bootstrap.js
COPY agents/telegram-member-agent/scripts/preflight.mjs ./preflight.mjs

USER node
CMD ["node", "index.js"]
