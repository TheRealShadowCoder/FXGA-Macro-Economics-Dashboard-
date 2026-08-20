FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY google-cloud-app/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY google-cloud-app/*.js ./

# Cloudflare is the only frontend host. This container is intentionally API-only,
# so a React/TypeScript build can never block recreation of the Cloud Run API.
# Same-instance WebSocket broadcasts remain immediate; the cross-instance
# Firestore watcher is only a fallback and is capped at 15 seconds.
RUN sed -i 's/setInterval(pollUpdates,3000)/setInterval(pollUpdates,15000)/' server.js \
 && grep -q 'setInterval(pollUpdates,15000)' server.js

USER node
EXPOSE 8080
CMD ["node", "server.js"]
