# FXGA MT5 integrations

This folder contains the MetaTrader 5 components used by the FXGA dashboard.

## Elliott Wave 60-Day AI dossier bridge

`EA Bridge.mq5` is the authenticated, on-demand MT5 worker for the **60-Day Elliott + Macro AI Dossier** section.

### EA Bridge v13.41

The default Cloud Run API base is:

`https://fxga-macro-dashboard-kbjj66blka-uc.a.run.app`

The default terminal ID is `FXGA-MT5-PRIMARY` and the idle polling interval is 3 seconds.

The private report secret is deliberately **not committed to GitHub**. Enter the same protected value configured as `FXGA_MT5_REPORT_SECRET` into the local EA input `InpWebsiteReportSecret`. The v13.41 source requires a strong secret of at least 16 characters and remains safely attached/passive when configuration is incomplete.

Do not commit a populated secret, `.set` file or MT5 template containing the private value.

When correctly connected it prints:

`EA Bridge v13.41 CONNECTED + AUTHENTICATED | terminal=FXGA-MT5-PRIMARY | ...`

Heavy work begins only after the website Analyze request is claimed. EA Bridge then:

- exports at least 60 days of CLOSED-BAR M5/H1/H4/D1 history,
- saves the parent chart's current Elliott template/settings,
- uses one background worker chart so the user's working chart remains in front,
- cycles all 21 standard MT5 timeframes,
- waits for the indicator's `FXGA_EW_AI_EVIDENCE_READY_*` and `FXGA_EW_REPORT_READY_*` handshakes,
- reads `FXGA_EW_AI_EVIDENCE_<chartId>.json`,
- uploads strict structured evidence and one PNG for each timeframe,
- asks Cloud Run to finalize the single 60-day dossier PDF.

The current server contract is:

- indicator evidence: `FXGA_EW_AI_EVIDENCE_1`
- dossier: `FXGA_60D_AI_DOSSIER_2`
- Gemini input: one PDF only
- automatic order placement: disabled

### Install EA Bridge

1. Copy `EA Bridge.mq5` into `MQL5/Experts/FXGA/` and compile it in MetaEditor.
2. Attach the matching FXGA Elliott indicator build to the parent chart and configure its visual/analysis inputs as desired.
3. Attach **EA Bridge** to that same parent chart.
4. In MetaTrader 5 open **Tools → Options → Expert Advisors**.
5. Enable **Allow WebRequest for listed URL**.
6. Add `https://fxga-macro-dashboard-kbjj66blka-uc.a.run.app` or the current deployed Cloud Run origin.
7. In EA Bridge inputs set `InpWebsiteReportSecret` to the same private `FXGA_MT5_REPORT_SECRET` value held by the backend.
8. Keep `InpWebsiteReportHistoryDays = 60` or greater and `InpWebsiteReportRenderTimeoutSeconds = 90` unless a deliberate reason exists to change them.
9. Keep Algo Trading enabled.

The companion indicator owns Elliott calculations and the strict non-repaint evidence export. `WebRequest()` remains isolated in EA Bridge because MT5 custom indicators cannot safely perform it.

See `docs/ELLIOTT_MT5_PDF_REPORT_BRIDGE.md` for the complete dossier, non-repaint, economic-event and Gemini workflow.

---

## Broker universe publisher

`FXGA_Broker_Universe_Publisher.mq5` publishes the terminal's actual broker symbol inventory to the Google Cloud MT5 ingress used by the **SMC Setups** page.

### Install

1. Copy `FXGA_Broker_Universe_Publisher.mq5` into `MQL5/Experts/FXGA/` and compile it in MetaEditor.
2. In MetaTrader 5 open **Tools → Options → Expert Advisors** and enable **Allow WebRequest for listed URL**.
3. Add this origin:
   `https://fxga-mt5-signal-ingress-kbjj66blka-uc.a.run.app`
4. Attach the EA to one chart.
5. Set `InpMT5Token` to the same plain MT5 token already used by the FXGA webhook publisher. Do not commit the token to GitHub.
6. Leave `InpScannerIncludesAllBrokerSymbols=true` when the SMC scanner is intended to cover the broker-wide universe. Set it to `false` to mark only Market Watch symbols as scanner-included.

The publisher refreshes every 30 seconds by default. A successful upload prints `FXGA broker universe published` in the Experts log and displays the terminal/scanner symbol totals on the chart.

### Production contract

- Endpoint: `/api/mt5/scanner-universe`
- Schema: `fxga.mt5.scanner-universe.v1`
- Source: `MetaTrader5`
- Engine: `FXGA_SMC2000`
- Stream: `fxga_smc2000_mt5_multi_asset`
- Authentication: `X-FXGA-MT5-Token`, validated by the Google Secret Manager-backed SHA-256 token digest.

The dashboard never fabricates a broker inventory. Until MT5 publishes a snapshot, the server returns `WAITING_FOR_MT5_UNIVERSE_SNAPSHOT` with zero broker symbols. Once the EA publishes, SMC Setups reads the real terminal inventory automatically.
