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
COPY google-cloud-app/server.js ./server.js
COPY --from=frontend /workspace/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server.js"]
