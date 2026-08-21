# FXGA × dceoy/mt5api Integration

This integration uses the open-source [`dceoy/mt5api`](https://github.com/dceoy/mt5api)
project as a **read-only MetaTrader 5 REST adapter** on a persistent Windows host.

Pinned upstream revision used by this setup:

`ea2ed8fdf53e2a765a50e24b7f74700e03b3e378`

Upstream package version at that revision: `mt5api 1.0.5`.

## Why this architecture

The official `MetaTrader5` Python package requires Windows and a running MetaTrader 5
terminal. It therefore does **not** belong inside the Linux Google Cloud Run services.

The production path is:

```text
Broker
  ↓
MetaTrader 5 terminal on persistent Windows host
  ↓
dceoy/mt5api on 127.0.0.1:8000
  ↓
FXGA read-only bridge agent
  ↓ outbound HTTPS
FXGA Google Cloud MT5 ingress
  ↓
Firestore canonical M1 history
  ↓
M5 / M15 / M30 / H1 / H4 / D1 derived bars
  ↓
Event Study / SMC / Cross Asset / dashboard research
```

`mt5api` is deliberately bound to `127.0.0.1`; it is **not exposed to the public internet**.
Only the FXGA bridge makes outbound HTTPS requests to Google Cloud.

## What is imported from MT5

The bridge uses `dceoy/mt5api` read-only endpoints:

- `GET /health`
- `GET /symbols?group=*`
- `GET /symbols/{symbol}/tick`
- `GET /rates/range`

The bridge does **not** send orders and does not add trade-execution permissions.

Each M1 bar is normalized to the existing FXGA canonical shape:

```text
[
  time_ms,
  open,
  high,
  low,
  close,
  tick_volume,
  spread,
  real_volume
]
```

The cloud database remains authoritative for retention, deduplication, gap diagnostics,
derived timeframes, the 60-day FIFO and Event Study access.

## Requirements

- Windows 10/11 or Windows Server with an interactive user session
- MetaTrader 5 installed
- Broker account logged into the MT5 terminal
- Internet access from the Windows machine
- Existing FXGA MT5 webhook token
- Git and Python 3.11–3.14 (the setup script can install Git/Python 3.12 using winget)

## Install

From the FXGA repository on the Windows MT5 machine, open PowerShell and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\integrations\mt5api\install-windows.ps1
```

The installer will:

1. install/check Git and Python 3.12;
2. clone `dceoy/mt5api`;
3. pin it to the audited upstream commit;
4. create an isolated virtual environment;
5. install `mt5api` and `pdmt5`;
6. generate a local `MT5API_SECRET_KEY`;
7. ask for the existing FXGA MT5 token;
8. store both secrets using Windows DPAPI for the current user;
9. copy the bridge runtime;
10. optionally register logon tasks for the API and bridge.

No plaintext credentials are committed to GitHub.

## First launch

Keep MetaTrader 5 open and logged in.

Start the local API:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\FXGA\MT5API\runtime\start-mt5api.ps1"
```

In a second window:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\FXGA\MT5API\runtime\test-mt5api.ps1"
```

The doctor performs:

- local mt5api health;
- FXGA Google Cloud ingress health;
- broker symbol discovery;
- canonical symbol resolution;
- one complete read-only M1 synchronization dry run.

After the dry run passes, start the bridge:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\FXGA\MT5API\runtime\start-fxga-bridge.ps1"
```

The registered bridge task automatically retries every five minutes.

## Broker symbol mapping

Broker names vary. Examples:

- Gold may be `XAUUSD`, `GOLD`, `XAUUSD.a`, etc.
- S&P 500 may be `US500`, `SPX`, `SP500`.
- Nasdaq may be `NAS100`, `US100`, `USTEC`.
- WTI may be `USOIL`, `WTI`, `XTIUSD`.

The bridge first requires an exact safe match. It accepts a broker suffix only when
the match is unique. Ambiguous matches are **not guessed**.

Edit:

`%LOCALAPPDATA%\FXGA\MT5API\runtime\config.json`

and set explicit mappings when necessary:

```json
{
  "symbol_map": {
    "GOLD": "XAUUSD.a",
    "SPX": "US500.cash",
    "NASDAQ": "USTEC.cash"
  }
}
```

Run `test-mt5api.ps1` again after changing mappings.

## Bootstrap policy

FXGA asks the cloud MT5 ingress for a per-symbol sync plan.

If a symbol has less than the required 60-day M1 history, the bridge moves backward one
UTC day per cycle. Once the bootstrap is complete it automatically switches to the
existing FXGA incremental-overlap policy.

This prevents repeated 60-day downloads.

## Security

- `mt5api` binds to `127.0.0.1` only.
- The local MT5 API has an API key generated during setup.
- The FXGA webhook token is stored using Windows DPAPI.
- The bridge performs outbound HTTPS only.
- No broker login/password is stored in this repository.
- No order-send endpoint is used by the bridge.
- The cloud ingestion service still performs its own authentication and validation.

## Logs

Runtime logs are stored locally:

```text
%LOCALAPPDATA%\FXGA\MT5API\logs\mt5api.log
%LOCALAPPDATA%\FXGA\MT5API\logs\fxga-mt5api-bridge.log
```

## Updating upstream

Do not automatically track an unpinned upstream branch in production.

Audit a newer `dceoy/mt5api` commit first, then update the `UpstreamCommit` value in
`install-windows.ps1` and repeat the integration tests.

## Source

Upstream:

https://github.com/dceoy/mt5api

The upstream repository is MIT licensed. FXGA does not vendor or modify its source in
this integration; the setup script clones the pinned upstream project directly.
