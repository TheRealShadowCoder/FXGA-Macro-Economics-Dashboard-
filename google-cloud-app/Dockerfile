FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY google-cloud-app/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY google-cloud-app/*.js ./
COPY google-cloud-app/prompts ./prompts

# Install the on-demand Elliott Wave PDF report API into the canonical server,
# then inject the existing latency-sensitive fast paths. MT5 screenshots are
# captured only after the website creates an Analyze job.
RUN node install-elliott-reports.js \
 && node optimize-server.js \
 && node --check server.js \
 && node --check elliott-reports.js \
 && node --check install-elliott-reports.js \
 && node --check gemini-bootstrap.js \
 && node --check startup.js \
 && node --check gemini-legacy-resilience.js \
 && node --check gemini-hook.js \
 && node --check fxga-error-catalog.js \
 && node --check fxga-prompt-library.js \
 && node --check fxga-intelligence-extension.js \
 && node --check fxga-gemini-streaming-extension.js \
 && test -f prompts/program-chat.md \
 && test -f prompts/live-intelligence-report.md

# Cloudflare is the only frontend host. This container is intentionally API-only,
# so a React/TypeScript build can never block recreation of the Cloud Run API.
# Same-instance WebSocket broadcasts remain immediate; the cross-instance
# Firestore watcher is only a fallback and is capped at 15 seconds.
RUN sed -i 's/setInterval(pollUpdates,3000)/setInterval(pollUpdates,15000)/' server.js \
 && grep -q 'setInterval(pollUpdates,15000)' server.js

USER node
EXPOSE 8080

# startup.js resolves Gemini from the already-configured Cloud Run secret env first
# and falls back to Google Secret Manager through the runtime service account. Only
# then are the Gemini modules imported, preventing a false "not configured" state.
CMD ["node", "startup.js"]
