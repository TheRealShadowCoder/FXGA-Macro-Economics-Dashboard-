# FXGA Elliott Wave MT5 -> Website PDF Report Bridge

## Behavior

The report bridge is deliberately on-demand.

1. The website user enters a symbol and clicks **Analyze Elliott Waves**.
2. `POST /api/elliott-reports/request` creates one Firestore capture job containing all 21 standard MT5 timeframes.
3. The MT5 Elliott indicator performs a lightweight authenticated poll. It does **not** take screenshots while no job exists.
4. When the job is claimed, MT5 opens temporary charts, applies the FXGA Elliott template, captures each timeframe, and uploads each PNG to the authenticated report API.
5. Cloud Run combines the 21 PNG files into one PDF with `pdf-lib`.
6. The final PDF is stored in a private Google Cloud Storage bucket. Temporary PNG objects are deleted after successful PDF creation.
7. The Analysis page lists completed PDFs and streams them through `/api/elliott-reports/:id/pdf` for the embedded viewer or full-screen viewing.

## Standard timeframe set

`M1, M2, M3, M4, M5, M6, M10, M12, M15, M20, M30, H1, H2, H3, H4, H6, H8, H12, D1, W1, MN1`

One successful request therefore produces a 21-page PDF.

## Security

The Google Cloud Storage bucket is private. The browser never receives the MT5 bridge secret or a storage credential.

MT5 endpoints require:

`X-FXGA-MT5-Secret: <shared secret>`

The deployment workflow synchronizes the GitHub Actions secret `FXGA_MT5_REPORT_SECRET` into Google Secret Manager secret `fxga-mt5-report-secret`, then exposes it only to the Cloud Run runtime as a secret-backed environment variable.

The same secret must be entered locally in the indicator's `InpWebsiteReportSecret` input. Never commit the populated secret into the `.mq5` source.

## One-time GitHub setup

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:

- Name: `FXGA_MT5_REPORT_SECRET`
- Value: a long random secret (32+ random bytes recommended)

The deployment workflow will create/reuse:

- Secret Manager: `fxga-mt5-report-secret`
- Private bucket: `gs://fxglobalavengerstradingacademy-fxga-elliott-reports`
- Runtime secret binding: `FXGA_MT5_REPORT_SECRET`
- Runtime environment: `FXGA_REPORT_BUCKET`

## MT5 setup

1. Compile and attach the matching FXGA Elliott indicator bridge build.
2. In MetaTrader 5 open **Tools -> Options -> Expert Advisors**.
3. Enable **Allow WebRequest for listed URL**.
4. Add the deployed Cloud Run API base URL shown by the `Deploy FXGA Google Cloud Application` workflow.
5. Indicator inputs:
   - `InpWebsiteReportBridge = true`
   - `InpWebsiteReportApiBase = <Cloud Run API base URL>`
   - `InpWebsiteReportSecret = <same value as GitHub Actions FXGA_MT5_REPORT_SECRET>`
   - `InpWebsiteReportTerminalId = FXGA-MT5-PRIMARY` (or another unique terminal name)
6. Keep one chart with the indicator attached. That instance owns the terminal-wide report worker lock. Temporary charts spawned for screenshots cannot claim jobs.

## API

Website:

- `POST /api/elliott-reports/request`
- `GET /api/elliott-reports/jobs/:jobId`
- `GET /api/elliott-reports`
- `GET /api/elliott-reports/:reportId/pdf`

MT5 authenticated bridge:

- `GET /api/elliott-reports/jobs/next?terminalId=...`
- `POST /api/elliott-reports/upload?jobId=...&timeframe=...&terminalId=...`
- `POST /api/elliott-reports/complete?jobId=...&terminalId=...`
- `POST /api/elliott-reports/fail?jobId=...&terminalId=...`

## Non-repaint guarantee

The bridge does not alter Elliott calculations. It only captures rendered charts. The underlying v13.10+ strict non-repaint engine continues using closed-bar causal pivots/signals. The screenshot PDF is a point-in-time report of what the indicator displayed for each timeframe at the requested analysis run.
