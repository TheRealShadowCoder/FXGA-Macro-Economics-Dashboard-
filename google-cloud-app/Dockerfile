FROM node:24-bookworm-slim AS frontend
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY google-cloud-app/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY google-cloud-app/*.js ./
# Cross-instance WebSocket detection is only a fallback. Same-instance signal
# broadcasts remain immediate; this guard caps Firestore meta polling so an
# idle open dashboard does not consume the free read quota every 3 seconds.
RUN sed -i 's/setInterval(pollUpdates,3000)/setInterval(pollUpdates,15000)/' server.js \
 && grep -q 'setInterval(pollUpdates,15000)' server.js
COPY --from=frontend /workspace/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server.js"]
