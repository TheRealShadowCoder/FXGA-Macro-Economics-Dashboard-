FROM node:24-alpine
WORKDIR /app
COPY google-cloud-mt5-ingress/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY google-cloud-mt5-ingress/*.js ./
ENV NODE_ENV=production
CMD ["node","server.js"]
