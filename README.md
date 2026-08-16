# FXGA Macro Intelligence Dashboard

A React + Cloudflare Workers dashboard for FX Global Avengers Trading Academy macroeconomic intelligence.

## Architecture

- React + TypeScript frontend
- Cloudflare Workers backend
- FRED macro data provider
- Trading Economics calendar adapter
- Official central-bank and statistical RSS/news feeds
- Source-health monitoring and normalization
- GitHub Actions deployment to Cloudflare

## Cloudflare

Configured for Cloudflare account `4f260a0775a3df407e08512610c9898b`.

## Local development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.dev.vars` and add any provider API keys you want to enable.

## Deployment

```bash
npm run deploy
```

The included GitHub Actions workflow can also deploy automatically after the required Cloudflare repository secrets are configured.
