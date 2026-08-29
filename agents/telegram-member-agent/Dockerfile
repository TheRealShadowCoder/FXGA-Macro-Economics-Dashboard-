FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY agents/telegram-member-agent/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY agents/telegram-member-agent/index.js ./index.js
COPY agents/telegram-member-agent/admin-server.js ./admin-server.js
COPY agents/telegram-member-agent/admin-bootstrap.js ./admin-bootstrap.js
COPY agents/telegram-member-agent/scripts/preflight.mjs ./preflight.mjs
COPY agents/telegram-member-agent/scripts/test-runner.mjs ./test-runner.mjs

# Node 24 ESM does not permit directory imports. teleproto exposes its
# StringSession implementation through the sessions index module, so normalize
# the runtime copies without changing Telegram's direct-add behavior.
RUN sed -i 's#teleproto/sessions"#teleproto/sessions/index.js"#g; s#teleproto/sessions'"'"'#teleproto/sessions/index.js'"'"'#g' index.js admin-server.js preflight.mjs

USER node
CMD ["node", "index.js"]
