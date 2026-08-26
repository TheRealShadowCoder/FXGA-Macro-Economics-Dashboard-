# FXGA R0 Production Migration

## Target production architecture

FXGA production is being moved from Google Cloud managed infrastructure to a hard-capped/free-first runtime:

- Frontend/static assets: Cloudflare Worker Static Assets
- API gateway/runtime: Cloudflare Workers Free
- Database/state/cache: Cloudflare D1 Free
- Scheduled market collection: GitHub Actions in this public repository
- Scheduled macro collection: GitHub Actions + FRED
- MT5 ingress: Cloudflare Worker `/api/mt5/batch`
- AI: Google Gemini Developer API only
- Secrets used by deployment/collectors: GitHub Actions secrets + Cloudflare Worker encrypted secrets

The production Worker health endpoint must report `googleCloudRuntime: false`.

## GitHub secrets location

The deployment and collector workflows use **Actions secrets**, not GitHub Agent secrets.

Add/verify them here:

`https://github.com/TheRealShadowCoder/FXGA-Macro-Economics-Dashboard-/settings/secrets/actions`

### Required

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `GEMINI_API_KEY`
- `FRED_API_KEY`
- One ingestion secret: `FXGA_INGEST_TOKEN` or the existing `FXGA_MT5_REPORT_SECRET`

### Optional free market-data keys

The free collector can still use public-source fallbacks when these are absent, but these keys improve coverage when their provider free quotas are available:

- `TWELVE_DATA_API_KEY`
- `FINNHUB_API_KEY`
- `ALPHA_VANTAGE_API_KEY`
- `MARKETSTACK_API_KEY`
- `FMP_API_KEY`
- `NASDAQ_DATA_LINK_API_KEY`

Do not put secret values in source files, issues, pull requests, logs, or browser environment variables.

## Active R0 workflows

`deploy-cloudflare-static.yml` now deploys the complete R0 runtime. It builds the frontend, creates or attaches the `fxga-free-db` D1 database, applies `worker/schema.sql`, deploys the Worker/static assets, installs the Gemini secret, and verifies the production health contract.

`r0-free-market-collector.yml` runs the free data collectors. Market data runs every 15 minutes. FRED macro evidence runs hourly. Manual dispatch runs both jobs.

`verify-production-runtime.yml` is a pull-request/build guard that rejects the known paid Google deployment dependencies from the active Cloudflare deployment workflow.

## Gemini AI retained

The R0 Worker keeps the browser AI contract, including:

- `/api/gemini/health`
- `/api/gemini/intelligence-health`
- `/api/gemini/prompts`
- `/api/gemini/chat`
- `/api/gemini/chat-stream`
- `/api/gemini/live-report`
- `/api/gemini/analyze`
- `/api/gemini/explain-smc`
- `/api/errors/catalog`

The Gemini API key stays server-side as a Cloudflare Worker secret and is never compiled into the browser bundle.

Gemini is intentionally the only retained Google-hosted production dependency. This repository cannot determine whether the Google/Gemini account has billing enabled, so the account/project must separately remain on the desired free/non-billing Gemini configuration.

## Google Cloud deployment paths retired

The migration removes the workflows that deployed or invoked:

- Cloud Run application
- Cloud Run collector
- Cloud Run MT5 ingress
- Artifact Registry build/deployment path
- Cloud Scheduler event-research jobs
- Firestore canary/architecture checks
- Google Cloud collector refresh jobs

The legacy Google source folders may remain temporarily as reference/migration code, but the R0 production workflow must not deploy them.

## Important: repository migration does not stop existing Google Cloud resources

Deleting deployment workflows does **not** delete already-running Google Cloud resources. Existing resources can continue to generate charges until they are explicitly disabled or deleted in Google Cloud.

Only after the Cloudflare R0 deployment is verified should the old Google production resources be shut down. Review at minimum:

1. Cloud Scheduler jobs — pause/delete old FXGA jobs.
2. Cloud Run services — delete the old FXGA app, collector, and MT5 ingress after traffic has moved.
3. Cloud Tasks queues — delete/disable queues no longer required.
4. Artifact Registry — remove old images/repositories if they are not needed for rollback.
5. Secret Manager — remove secrets only after confirming no remaining service needs them.
6. Firestore — export any data that must be retained, then decide whether to disable/delete the old database/project resources.
7. Google Cloud billing/project — inspect Billing after shutdown and detach/close only if that is consistent with the Gemini setup being used.

Do not destroy the old data store before verifying that anything historically required has been exported or migrated.

## Cutover verification

After merge and deployment, the target production checks are:

- `/api/health` returns `architecture: cloudflare-r0`.
- `/api/health` returns `googleCloudRuntime: false`.
- `/api/health` reports `Cloudflare D1 Free`.
- `/api/gemini/health` reports Gemini configured.
- `/api/gemini/prompts` returns the FXGA prompt registry.
- The site loads normally from the Cloudflare Worker URL.
- The free data collector writes `market`, `technical`, `data-quality`, and `macro` evidence into D1.

Only after those checks pass should the old Google runtime be removed.
