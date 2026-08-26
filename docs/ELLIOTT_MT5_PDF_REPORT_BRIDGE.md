# FXGA Elliott Wave MT5 -> Website PDF Report Bridge

## Behavior

The report bridge is deliberately on-demand.

1. The website user enters a symbol and clicks **Analyze Elliott Waves**.
2. `POST /api/elliott-reports/request` creates one Firestore capture job containing all 21 standard MT5 timeframes.
3. The MT5 **EA Bridge** performs a lightweight authenticated poll. It does **not** take screenshots while no job exists.
4. When the job is claimed, EA Bridge opens temporary charts, applies the FXGA Elliott template, waits for the indicator render-ready handshake, captures each timeframe, and uploads each PNG to the authenticated report API.
5. Cloud Run stores incoming PNG payloads as private Firestore chunks and combines the 21 images into one PDF with `pdf-lib`.
6. The final PDF is stored as private Firestore chunks. Temporary screenshot chunks are deleted after successful PDF creation.
7. The Analysis page lists completed PDFs and streams them through `/api/elliott-reports/:id/pdf` for the embedded viewer or full-screen viewing.

This design deliberately uses the project's existing Firestore permissions. It does not require Cloud Storage bucket creation or new project-level storage IAM permissions.

## Standard timeframe set

`M1, M2, M3, M4, M5, M6, M10, M12, M15, M20, M30, H1, H2, H3, H4, H6, H8, H12, D1, W1, MN1`

One successful request therefore produces a 21-page PDF.

## MT5 components

The website bridge is split intentionally:

- `FXGA_RealTime_Elliott_Wave_Setups` renders the Elliott analysis and publishes the render-ready handshake.
- `EA Bridge.mq5` performs `WebRequest`, opens temporary charts, captures screenshots, uploads PNGs and signals completion.

`WebRequest()` is isolated in the EA because MetaTrader 5 does not permit it from a custom indicator thread.

### EA Bridge version 13.21

`EA Bridge.mq5` uses safe-idle initialization.

If the Cloud Run API URL or bridge secret is missing, the EA:

- remains attached to the chart,
- returns `INIT_SUCCEEDED`,
- performs no polling, screenshot capture or upload,
- prints a clear `CONFIGURATION REQUIRED` diagnostic in the Experts log,
- begins network activity only after valid inputs are supplied and MT5 reinitializes the EA.

This replaces the previous behavior where incomplete inputs could return initialization error 32767 and cause MT5 to remove the EA.

## Security

Screenshot and PDF bytes are held in private Google Cloud Firestore documents/subcollections and are not exposed as public object URLs. The browser never receives the MT5 bridge secret or Google Cloud credentials.

MT5 endpoints require:

`X-FXGA-MT5-Secret: <shared secret>`

The deployment workflow synchronizes the GitHub Actions secret `FXGA_MT5_REPORT_SECRET` into Google Secret Manager secret `fxga-mt5-report-secret`, then exposes it only to the Cloud Run runtime as a secret-backed environment variable.

The same secret must be entered locally in EA Bridge's `InpWebsiteReportSecret` input. Never commit the populated secret into the `.mq5` source.

## One-time GitHub setup

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:

- Name: `FXGA_MT5_REPORT_SECRET`
- Value: a long random secret (32+ random bytes recommended)

The deployment workflow creates/reuses:

- Secret Manager: `fxga-mt5-report-secret`
- Runtime secret binding: `FXGA_MT5_REPORT_SECRET`
- Existing project Firestore database for private report chunks

No new Cloud Storage bucket is required.

## Firestore binary storage

Firestore documents have a size limit, so screenshot/PDF byte streams are split into bounded chunks. The report service uses:

- metadata collection: `fxga_elliott_report_blobs`
- per-blob `chunks` subcollection
- 700 KiB payload chunks
- deterministic blob IDs per job/timeframe
- temporary screenshot chunk deletion after PDF completion
- private PDF reconstruction only through the Cloud Run API

## MT5 setup

1. Compile the matching FXGA Elliott indicator build.
2. Compile `mt5/EA Bridge.mq5` and attach **EA Bridge** to one chart.
3. In MetaTrader 5 open **Tools -> Options -> Expert Advisors**.
4. Enable **Allow WebRequest for listed URL**.
5. Add the deployed Cloud Run API base URL shown by the `Deploy FXGA Google Cloud Application` workflow.
6. EA Bridge inputs:
   - `InpWebsiteReportBridge = true`
   - `InpWebsiteReportApiBase = <Cloud Run API base URL>`
   - `InpWebsiteReportSecret = <same value as GitHub Actions FXGA_MT5_REPORT_SECRET>`
   - `InpWebsiteReportTerminalId = FXGA-MT5-PRIMARY` (or another unique terminal name)
   - `InpWebsiteReportTemplateName = FXGA_Elliott_Web_Report_v13_20.tpl`
7. Keep Algo Trading enabled.
8. Keep one parent chart with EA Bridge attached. That instance owns the terminal-wide report worker lock. Temporary screenshot charts cannot claim jobs.

### Expected Experts log

With incomplete configuration:

`EA Bridge v13.21 | CONFIGURATION REQUIRED | ...`

With valid configuration:

`EA Bridge v13.21 | READY | terminal=FXGA-MT5-PRIMARY | ...`

No screenshot is taken merely because the EA is loaded. Screenshots are produced only after a website Analyze job is claimed.

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

EA Bridge does not alter Elliott calculations. It only captures rendered charts. The underlying strict non-repaint engine continues using closed-bar causal pivots/signals. The screenshot PDF is a point-in-time report of what the indicator displayed for each timeframe at the requested analysis run.
