# FXGA MT5 broker universe publisher

`FXGA_Broker_Universe_Publisher.mq5` publishes the terminal's actual broker symbol inventory to the Google Cloud MT5 ingress used by the **SMC Setups** page.

## Install

1. Copy `FXGA_Broker_Universe_Publisher.mq5` into `MQL5/Experts/FXGA/` and compile it in MetaEditor.
2. In MetaTrader 5 open **Tools → Options → Expert Advisors** and enable **Allow WebRequest for listed URL**.
3. Add this origin:
   `https://fxga-mt5-signal-ingress-kbjj66blka-uc.a.run.app`
4. Attach the EA to one chart.
5. Set `InpMT5Token` to the same plain MT5 token already used by the FXGA webhook publisher. Do not commit the token to GitHub.
6. Leave `InpScannerIncludesAllBrokerSymbols=true` when the SMC scanner is intended to cover the broker-wide universe. Set it to `false` to mark only Market Watch symbols as scanner-included.

The publisher refreshes every 30 seconds by default. A successful upload prints `FXGA broker universe published` in the Experts log and displays the terminal/scanner symbol totals on the chart.

## Production contract

- Endpoint: `/api/mt5/scanner-universe`
- Schema: `fxga.mt5.scanner-universe.v1`
- Source: `MetaTrader5`
- Engine: `FXGA_SMC2000`
- Stream: `fxga_smc2000_mt5_multi_asset`
- Authentication: `X-FXGA-MT5-Token`, validated by the Google Secret Manager-backed SHA-256 token digest.

The dashboard never fabricates a broker inventory. Until MT5 publishes a snapshot, the server returns `WAITING_FOR_MT5_UNIVERSE_SNAPSHOT` with zero broker symbols. Once the EA publishes, SMC Setups reads the real terminal inventory automatically.
