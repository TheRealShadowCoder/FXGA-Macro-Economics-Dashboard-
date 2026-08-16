# FXGA Macro Intelligence Dashboard

Full-stack React + Cloudflare Workers application for the FX Global Avengers macroeconomic intelligence pipeline.

## What it collects

- FRED macro series and historical observations
- Trading Economics economic calendar when a key is configured
- Official central-bank and statistical-agency RSS/Atom feeds
- Source health and configuration status
- Cross-source macro dashboard payload for React

## Architecture

- React 19 + Vite frontend
- Cloudflare Worker API backend
- Cloudflare Vite plugin for a single deployable Worker + SPA
- Server-side secrets; no API keys are exposed to the browser
- Cache API to reduce upstream requests and rate-limit pressure
- Provider allowlist: no open arbitrary URL proxy

## Required secrets

```bash
npx wrangler secret put FRED_API_KEY
npx wrangler secret put TRADING_ECONOMICS_API_KEY
```

FRED is used for historical macro data. Trading Economics is optional but enables the full near-real-time economic calendar with Actual, Previous, Consensus/Forecast, TE forecast and importance.

## Run locally

```bash
npm install
cp .env.example .dev.vars
npm run dev
```

## Deploy

The Cloudflare account ID is already configured in `wrangler.jsonc`.

```bash
npm install
npm run deploy
```

## API

- `GET /api/health`
- `GET /api/sources`
- `GET /api/dashboard`
- `GET /api/fred?series=CPIAUCSL,UNRATE,FEDFUNDS`
- `GET /api/calendar?days=7&importance=2`
- `GET /api/news?source=fed-all`

## Security

All third-party credentials are Cloudflare secrets. The Worker only allows known upstream data providers. User-supplied arbitrary remote URLs are not accepted.

## GitHub automatic deployment

A workflow is included at `.github/workflows/deploy.yml`. Add one GitHub repository secret named `CLOUDFLARE_API_TOKEN`; pushes to `main` will then build and deploy the Worker to the configured Cloudflare account.

The upstream data keys should be stored as Cloudflare Worker secrets, not GitHub variables or frontend environment variables.

## Current collector coverage

| Source | Adapter | Key |
|---|---|---|
| FRED | JSON API | Required |
| Trading Economics | Economic Calendar JSON API | Required |
| Federal Reserve | RSS | No |
| ECB | RSS | No |
| Bank of England | RSS | No |
| Reserve Bank of Australia | RSS | No |
| U.S. BLS | RSS | No |

The provider architecture is intentionally modular so EIA, BEA, ONS, Eurostat, Bundesbank, BoJ, BoC, SNB and market-data adapters can be added without changing the React UI contract.
