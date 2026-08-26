# FXGA Elliott Wave MT5 -> Website 60-Day AI Dossier Bridge

## What the Analyze button now does

The bridge remains deliberately on-demand. Nothing heavy happens merely because MT5 is open.

1. The website user enters a symbol and clicks **Build + Analyze Dossier**.
2. `POST /api/elliott-reports/request` creates a Firestore capture job for all 21 standard MT5 timeframes and at least 60 calendar days of closed-bar market history.
3. **EA Bridge v13.41** performs a lightweight authenticated poll. When no job exists it does not capture charts or upload history.
4. After a job is claimed, EA Bridge saves the current parent-chart template, exports CLOSED-BAR M5/H1/H4/D1 history, opens/retargets one background worker chart, and captures all 21 timeframes without taking over the user's working chart.
5. For every timeframe the FXGA Elliott indicator publishes two causal handshakes:
   - `FXGA_EW_AI_EVIDENCE_READY_<chartId>`
   - `FXGA_EW_REPORT_READY_<chartId>`
6. The indicator writes the matching structured snapshot as `FXGA_EW_AI_EVIDENCE_<chartId>.json`. EA Bridge v13.41 waits for the current evidence file and ready keys instead of using a fixed sleep as proof that the analysis is complete.
7. EA Bridge uploads both the strict Elliott evidence and the PNG screenshot for every timeframe.
8. Cloud Run validates symbol, timeframe, job ownership, evidence schema and strict non-repaint flags before accepting evidence.
9. Cloud Run builds **one private self-contained PDF dossier** containing the price history, economic chronology, event-to-price mapping, event-to-Elliott mapping, Elliott theory/governance, numerical price ledgers, strict indicator evidence and all 21 charts.
10. Gemini reads that **one PDF only** and returns the structured Elliott decision. The raw JSON evidence is not sent to Gemini as a second large input.

## Standard timeframe set

`M1, M2, M3, M4, M5, M6, M10, M12, M15, M20, M30, H1, H2, H3, H4, H6, H8, H12, D1, W1, MN1`

The dossier has more than 21 pages because it also contains governance, macro/economic evidence, numerical ledgers, event reaction analysis and a structured evidence page for every chart timeframe.

## Current contracts

- EA Bridge: **v13.41**
- Indicator AI evidence schema: **`FXGA_EW_AI_EVIDENCE_1`**
- Dossier schema: **`FXGA_60D_AI_DOSSIER_2`**
- Gemini prompt/governance version: **`EW-DOSSIER-AI-3`**
- Gemini transport: **single PDF dossier**
- Gemini Interactions API: **`/v1beta/interactions`**
- Automatic order placement: **disabled**

## MT5 components

The bridge is intentionally split:

- `FXGA_RealTime_Elliott_Wave_Setups` owns Elliott calculations, strict causal confirmation, chart rendering and structured evidence generation.
- `mt5/EA Bridge.mq5` owns `WebRequest`, 60-day history export, background worker charts, screenshot/evidence upload and report finalization.

`WebRequest()` remains isolated in the EA because MetaTrader 5 does not permit it from a custom indicator thread.

## EA Bridge v13.41 reliability upgrades

v13.41 fixes the evidence contract and removes the previous short render race:

- uses the indicator's actual filename: `FXGA_EW_AI_EVIDENCE_<chartId>.json`,
- waits for `FXGA_EW_AI_EVIDENCE_READY_<chartId>` and `FXGA_EW_REPORT_READY_<chartId>`,
- provides a configurable 90-second render timeout for heavy multi-timeframe Elliott analysis,
- deletes stale evidence/ready keys before each worker retarget,
- keeps the evidence file until **both** evidence and screenshot uploads succeed,
- retries transient uploads without silently switching to stale evidence,
- keeps the working chart in front while the separate worker chart performs capture,
- remains loaded and passive when configuration is incomplete,
- requires a bridge secret of at least 16 characters,
- exports history using CLOSED-BAR data only.

## 60-day market-history export

EA Bridge exports four closed-bar series:

- M5: event reaction and short-horizon response mapping,
- H1: canonical 60-day coverage and ATR/context calculations,
- H4: higher-timeframe supporting ledger,
- D1: daily macro/structural supporting ledger.

The history payload records `#causal_policy,CLOSED_BARS_ONLY`.

### Broker time / UTC limitation

MT5 can provide current broker-server versus GMT offset, but it does not automatically provide a perfect historical broker-DST offset ledger. The export therefore labels UTC quality as:

`CURRENT_SERVER_OFFSET_ESTIMATE`

The dossier explicitly warns that a broker DST change inside the 60-day window can create a roughly one-hour historical timestamp error. The system does **not** claim historical UTC precision it does not possess.

## Elliott evidence compatibility

Dossier v2 reads the indicator's current snake_case schema directly, including:

- `strict_non_repaint`
- `timeframe_states.*.confirmed_pivots`
- `count_scenarios.primary / alternate`
- `setups.selected`
- `signal_risk_plan`
- `wave_actionability`
- `count_integrity`
- `unified_wave`
- `rule_summary`
- `roadmap`
- `h4_m15_join`
- `intermediate_projections`
- `micro_forecasts`
- `precision_forecast`
- `apew3000`
- `fwd3200`

This replaces the older server-side reader that expected obsolete camelCase names and could leave Elliott summary fields or the pivot ledger empty.

## Strict non-repaint gate

A dossier cannot finalize as AI-ready unless every requested timeframe has the current evidence schema and passes the strict snapshot audit. Dossier v2 requires:

- strict mode enabled,
- closed-bar pivots,
- frozen confirmed pivots,
- closed-bar indicators,
- closed-bar signals,
- replay parity.

Confirmed pivots are read from `confirmed_pivots`. A pivot occurrence time is not presented as a separate pivot-confirmation timestamp unless that timestamp is explicitly available; the PDF says so instead of inventing one.

## Economic events and causality

The dossier reads persisted Google Cloud dashboard state for calendar/event/macro evidence. Matching historical events inside the price window are mapped to:

- pre-event baseline price,
- +5m, +15m, +1h, +4h and +1d reactions where data exists,
- H1 ATR-normalized reaction size,
- nearest confirmed Elliott pivot,
- surrounding confirmed Elliott leg.

Timing proximity is labelled as context, **not proof of causation**. Economic releases can explain or contextualize movement but can never legalize a hard-invalid Elliott count.

If no matching stored historical event record exists, the dossier states that this is a data-coverage limitation and Gemini is instructed not to invent the release.

## Gemini decision safety

Gemini receives the completed PDF as the canonical evidence input. Server normalization rejects executable output unless the dossier itself is complete.

A `TRADE_SETUP` requires:

- complete 60-day H1 coverage,
- all 21 screenshots/evidence snapshots,
- strict non-repaint completeness,
- exact entry **or a valid entry zone**,
- stop loss,
- explicit Elliott structural invalidation,
- at least one target,
- geometrically consistent BUY/SELL levels.

Invalid or incomplete executable geometry is downgraded to `WAIT` rather than patched with invented prices.

The AI response is decision support only. No order is submitted by this bridge.

## Security

Screenshots, market-history payloads and PDFs are held in private Google Cloud Firestore documents/subcollections and are not exposed as public object URLs. The browser never receives the MT5 bridge secret or Google Cloud credentials.

MT5 endpoints require:

`X-FXGA-MT5-Secret: <shared secret>`

The deployment workflow synchronizes GitHub Actions secret `FXGA_MT5_REPORT_SECRET` into Google Secret Manager secret `fxga-mt5-report-secret`, then exposes it only to the Cloud Run runtime as a secret-backed environment variable.

The same secret must be entered locally in EA Bridge's `InpWebsiteReportSecret` input. Never commit the populated secret into the `.mq5` source or template repository.

## One-time GitHub setup

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:

- Name: `FXGA_MT5_REPORT_SECRET`
- Value: a long random secret (32+ random bytes recommended)

Gemini also requires the existing protected `GEMINI_API_KEY` / Google Secret Manager configuration used by the Cloud Run application.

## Private Firestore binary storage

Large byte streams are split into bounded private chunks:

- blob metadata: `fxga_elliott_report_blobs`
- per-blob `chunks` subcollection
- 700 KiB payload chunks
- deterministic job/timeframe blob IDs
- screenshot/history input chunks deleted after successful dossier creation
- final PDF reconstructed only through the Cloud Run report endpoint

## MT5 setup

1. Compile the matching FXGA Elliott indicator build that emits `FXGA_EW_AI_EVIDENCE_1`.
2. Compile `mt5/EA Bridge.mq5` and attach **EA Bridge** to one parent chart that also contains the desired Elliott indicator/template settings.
3. MT5 -> **Tools -> Options -> Expert Advisors**.
4. Enable **Allow WebRequest for listed URL**.
5. Add the deployed Cloud Run API base URL.
6. EA Bridge inputs:
   - `InpWebsiteReportBridge = true`
   - `InpWebsiteReportApiBase = <Cloud Run API base URL>`
   - `InpWebsiteReportSecret = <same private FXGA_MT5_REPORT_SECRET>`
   - `InpWebsiteReportTerminalId = FXGA-MT5-PRIMARY` or another unique terminal ID
   - `InpWebsiteReportHistoryDays = 60` or greater
   - `InpWebsiteReportRenderTimeoutSeconds = 90`
   - `InpWebsiteReportTemplateName = FXGA_Elliott_Web_Report_AUTO.tpl`
7. Keep Algo Trading enabled.
8. Keep the parent EA Bridge attached. Only the parent instance can own the terminal-wide worker lock; the template-loaded child instance remains passive.

### Expected Experts log

Incomplete local configuration:

`EA Bridge v13.41 | CONFIGURATION REQUIRED | ...`

Configured and authenticated:

`EA Bridge v13.41 CONNECTED + AUTHENTICATED | terminal=FXGA-MT5-PRIMARY | ...`

After finalization:

`EA Bridge READY | ... | 60-day history + 21 charts + strict Elliott evidence -> ONE AI dossier PDF`

## API

Website/report endpoints:

- `POST /api/elliott-reports/request`
- `GET /api/elliott-reports/jobs/:jobId`
- `GET /api/elliott-reports`
- `GET /api/elliott-reports/:reportId/pdf`

MT5 authenticated bridge:

- `GET /api/elliott-reports/jobs/next?terminalId=...`
- `POST /api/elliott-reports/history?jobId=...&terminalId=...`
- `POST /api/elliott-ai/evidence?jobId=...&timeframe=...&terminalId=...`
- `POST /api/elliott-reports/upload?jobId=...&timeframe=...&terminalId=...`
- `POST /api/elliott-reports/complete?jobId=...&terminalId=...`
- `POST /api/elliott-reports/fail?jobId=...&terminalId=...`

Website AI endpoints:

- `GET /api/elliott-ai/jobs/:jobId`
- `POST /api/elliott-ai/analyze?jobId=...`

## Deployment status

Code on the feature branch is an implementation state, not proof that production has deployed it. Merge/deploy separately, then verify Cloud Run health, the 21-timeframe contract, dossier version 2, strict non-repaint status and one complete end-to-end Analyze run before treating it as live.
