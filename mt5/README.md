# FXGA MT5 integrations

This folder contains the MetaTrader 5 components used by the FXGA dashboard.

## Elliott Wave website PDF bridge

`EA Bridge.mq5` is the authenticated on-demand screenshot bridge for the **Elliott Wave PDF Reports** section.

### Version 13.22 behavior

EA Bridge now ships with the production Cloud Run API already configured:

`https://fxga-macro-dashboard-kbjj66blka-uc.a.run.app`

The default terminal ID is also preconfigured as `FXGA-MT5-PRIMARY` and the poll interval is 3 seconds.

The bridge secret is deliberately **not committed to GitHub**. v13.22 first uses `InpWebsiteReportSecret` when supplied; otherwise it automatically looks for the private local file:

`MQL5/Files/Elliot Wave Indicator Report/EA_Bridge.secret`

A one-time Windows helper is included as `Configure-EA-Bridge.ps1`. It securely prompts for `FXGA_MT5_REPORT_SECRET` and writes the local private secret file to the MT5 terminal data directory without printing the secret.

When configuration is incomplete the EA stays attached in a passive state and performs no screenshots or uploads.

When correctly connected it prints:

`EA Bridge CONNECTED + AUTHENTICATED | terminal=FXGA-MT5-PRIMARY | ...`

Screenshots are generated only after the user presses **Analyze Elliott Waves** on the website.

### Install EA Bridge

1. Copy `EA Bridge.mq5` into `MQL5/Experts/FXGA/` and compile it in MetaEditor.
2. Run `Configure-EA-Bridge.ps1` once and enter the same private value stored as `FXGA_MT5_REPORT_SECRET`.
3. In MetaTrader 5 open **Tools → Options → Expert Advisors**.
4. Enable **Allow WebRequest for listed URL**.
5. Add `https://fxga-macro-dashboard-kbjj66blka-uc.a.run.app`.
6. Attach **EA Bridge** to one chart and keep Algo Trading enabled.
7. The default inputs already use the production API and `FXGA-MT5-PRIMARY` terminal ID.
8. Do not commit `EA_Bridge.secret` or a populated bridge secret into source control.

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
