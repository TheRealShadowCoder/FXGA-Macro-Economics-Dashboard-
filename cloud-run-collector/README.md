# FXGA Google Cloud Run Collector

This service moves upstream macro/calendar acquisition away from Cloudflare. Cloudflare remains the dashboard/state/webhook edge; Google Cloud performs external collection and sends signed deltas only when state changes.

## Active Google Cloud target

- Project ID: `fxglobalavengerstradingacademy`
- Initial region: `us-central1`
- Cloud Run service: `fxga-macro-collector`

Deployment authentication is provided by GitHub Actions through Workload Identity Federation. No long-lived Google service-account key is stored in the repository.

## Runtime architecture

1. Cloud Scheduler calls `/bootstrap` once daily.
2. The collector fetches FXStreet, Myfxbook and CNBC, normalizes the calendar, persists the last state in Firestore and creates exact-time Cloud Tasks for each release cluster.
3. Cloud Tasks call `/release-check` at the release and short post-release checkpoints.
4. A narrow FXStreet public calendar request refreshes Actual/Consensus/Previous/Revised/Deviation for the whole release cluster.
5. If the release fingerprint did not change, no webhook is sent.
6. If state changed, one HMAC-signed webhook is sent to Cloudflare.
7. The fast macro job refreshes market-sensitive FRED/rates/FX/risk series hourly, while the full global 109+ universe is rebuilt daily.

Firestore uses aggregate state documents rather than one document per poll to reduce reads/writes. Cloud Tasks use deterministic task IDs so repeated calendar bootstraps do not create duplicate release tasks.

## Required Google Cloud services

- Cloud Run
- Artifact Registry
- Firestore `(default)` database
- Cloud Tasks
- Cloud Scheduler
- Secret Manager
- IAM / Workload Identity Federation

Run `infra/bootstrap-gcp.sh` once from Google Cloud Shell after setting `PROJECT_ID`.

## GitHub configuration

The deployment workflow is pinned to project `fxglobalavengerstradingacademy` and derives these service-account emails automatically:

- `fxga-github-deployer@fxglobalavengerstradingacademy.iam.gserviceaccount.com`
- `fxga-collector-runtime@fxglobalavengerstradingacademy.iam.gserviceaccount.com`

Optional repository variable:

- `GCP_REGION` (defaults to `us-central1`)

Required Actions values:

- `GCP_WIF_PROVIDER` — may be stored as an Actions Variable or Secret
- `COLLECTOR_WEBHOOK_SECRET` — store as an Actions Secret
- `FRED_API_KEY` — store as an Actions Secret

Do not put API keys, service-account JSON, or webhook secrets in source files.

## Endpoints

All endpoints are intended to remain IAM-authenticated/private on Cloud Run.

- `GET /health`
- `POST /bootstrap`
- `POST /release-check`
- `POST /macro-sync`
- `GET /state`

## Webhook signature

The collector sends:

- `X-FXGA-Timestamp`
- `X-FXGA-Request-Id`
- `X-FXGA-Signature: sha256=<hex>`

Signature payload:

`HMAC_SHA256(secret, timestamp + "." + requestId + "." + rawRequestBody)`

Cloudflare must reject stale timestamps, invalid signatures and replayed request IDs.

## Protection policy

The collector may use normal public HTTP, public machine-readable feeds and standard browser rendering. It does not implement CAPTCHA solving, login bypass, paywall bypass, fingerprint spoofing or anti-bot challenge circumvention. When a source refuses access, it degrades to the remaining configured sources and its previously persisted state.
