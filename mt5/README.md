# FXGA MT5 integrations

This folder contains the MetaTrader 5 components used by the FXGA dashboard.

## Elliott Wave website PDF bridge

`EA Bridge.mq5` is the authenticated on-demand screenshot bridge for the **Elliott Wave PDF Reports** section.

### Version 13.21 behavior

The EA now loads safely even when its API URL or bridge secret has not been entered yet.

Instead of failing initialization and being removed from the chart, it stays attached in a passive state and prints:

`EA Bridge v13.21 | CONFIGURATION REQUIRED | ...`

While configuration is incomplete it performs:

- no website polling,
- no screenshot capture,
- no upload,
- no temporary chart creation.

When correctly configured it prints:

`EA Bridge v13.21 | READY | terminal=FXGA-MT5-PRIMARY | ...`

Screenshots are generated only after the user presses **Analyze Elliott Waves** on the website.

### Install EA Bridge

1. Copy `EA Bridge.mq5` into `MQL5/Experts/FXGA/` and compile it in MetaEditor.
2. In MetaTrader 5 open **Tools → Options → Expert Advisors**.
3. Enable **Allow WebRequest for listed URL**.
4. Add the deployed FXGA Google Cloud Run API base URL.
5. Attach **EA Bridge** to one chart and keep Algo Trading enabled.
6. Configure:
   - `InpWebsiteReportBridge = true`
   - `InpWebsiteReportApiBase = <Cloud Run API URL>`
   - `InpWebsiteReportSecret = <same private value as FXGA_MT5_REPORT_SECRET>`
   - `InpWebsiteReportTerminalId = FXGA-MT5-PRIMARY`
   - `InpWebsiteReportTemplateName = FXGA_Elliott_Web_Report_v13_20.tpl`
7. Do not commit the populated secret into source control.

The companion Elliott indicator renders each requested timeframe and publishes the render-ready handshake. `WebRequest()` remains isolated in EA Bridge because MT5 custom indicators cannot call it safely.

See `docs/ELLIOTT_MT5_PDF_REPORT_BRIDGE.md` for the complete website/backend workflow.

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
