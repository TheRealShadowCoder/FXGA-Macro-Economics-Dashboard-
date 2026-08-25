FROM node:24-alpine
WORKDIR /app
COPY google-cloud-mt5-ingress/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY google-cloud-mt5-ingress/*.js ./
RUN node fix-price-cache-range.js \
 && node --check price-cache.js \
 && node --check scanner-universe-hook.js \
 && node --check server.js
ENV NODE_ENV=production
CMD ["node","--import","./scanner-universe-hook.js","server.js"]
