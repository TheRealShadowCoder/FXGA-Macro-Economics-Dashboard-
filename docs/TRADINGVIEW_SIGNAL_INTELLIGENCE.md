# FXGA TradingView Signal Intelligence

## Production architecture

Cloudflare serves the compiled website only. TradingView does not post to Cloudflare.

```text
TradingView alert()
      |
      | HTTPS POST
      v
Google Cloud Run: fxga-macro-dashboard
      |
      | validate + deduplicate + contextualize
      v
Google Firestore
      |
      +--> fxga_tradingview_signals
      +--> fxga_tradingview_signal_events
      +--> fxga_tradingview_live/metrics
      +--> fxga_tradingview_live/meta
      |
      v
Google Cloud Run WebSocket /api/live
      |
      v
Cloudflare-hosted browser UI
```

Cloudflare performs no webhook processing, market acquisition, signal scoring or Firestore work.

## Indicator contract

The production receiver accepts only the existing FXGA SMC2000 contract:

- schema: `fxga.smc.signal.v3`
- source: `TradingView`
- engine: `FXGA_SMC2000`
- stream: `fxga_smc2000`

Supported lifecycle events:

- `SIGNAL_NEW`
- `LIMIT_FILLED`
- `TP1_HIT`
- `TP2_HIT`
- `TP3_HIT`
- `INVALIDATED`
- `LIMIT_EXPIRED`
- `LIMIT_MISSED`

The receiver does not create a second alert schema. The Pine indicator remains authoritative for BUY/SELL direction, method identification, confluence telemetry, entry, stop, targets and lifecycle state.

## TradingView setup

After `Deploy FXGA Google Cloud Application` is green, open that workflow run and copy the `Application API` URL from the Production summary. The webhook is:

```text
<APPLICATION_API>/api/tradingview/webhook
```

Example shape:

```text
https://fxga-macro-dashboard-xxxxx-uc.a.run.app/api/tradingview/webhook
```

Do not use the Cloudflare website URL as the TradingView webhook.

In TradingView:

1. Add `Advanced Smart Money Concept [ FXGA ]` to the chart.
2. In indicator settings confirm:
   - Enable Google Cloud Webhook JSON = enabled
   - Send Lifecycle Events = enabled
   - Webhook Stream ID = `fxga_smc2000`
   - Payload Schema = `fxga.smc.signal.v3`
3. Click **Create alert**.
4. Under **Condition**, select the FXGA indicator.
5. Select **Any alert() function call**.
6. Enable **Webhook URL**.
7. Paste the Google Cloud Run webhook URL.
8. Do not replace the Pine-generated alert body with a hand-written alert message. The indicator's `alert()` calls generate the JSON payload dynamically.
9. Save the alert.

When the Pine script or its alert-affecting inputs are changed materially, recreate the TradingView alert so the running alert uses the intended script snapshot/settings.

## Security boundary

The webhook receiver:

- accepts HTTPS POST only
- checks the official TradingView webhook sender IP allowlist
- requires the exact FXGA schema/source/engine/event contract
- applies an ingress rate guard
- limits request body size
- deduplicates by `event_id`
- stores only after validation
- does not place credentials in the TradingView webhook URL or body

An optional `X-FXGA-Webhook-Secret` path exists for controlled manual tests. Normal TradingView traffic is intended to be identified by TradingView's documented source IPs.

## Idempotency

TradingView can retry failed webhook deliveries. `event_id` is therefore the idempotency key.

A repeated lifecycle event updates nothing and does not increment metrics twice.

The canonical setup ID is deterministic from ticker, original signal time and SMC method ID. All later lifecycle events update the same setup.

## Firestore model

### `fxga_tradingview_signals`

One canonical document per setup. Includes:

- symbol / ticker / exchange / timeframe
- indicator BUY or SELL
- SMC method ID, code, family and source method score
- entry / stop / TP1 / TP2 / TP3
- risk-reward geometry
- H4 / M15 / M1 hierarchy
- SMC evidence at signal
- current market evidence supplied by the indicator
- invalidation model
- current lifecycle status
- latest event
- FXGA Google contextual quality score

### `fxga_tradingview_signal_events`

Immutable lifecycle audit records. Each unique TradingView `event_id` is stored once with the original/compacted v3 payload.

### `fxga_tradingview_live/metrics`

Prospective signal statistics such as:

- total signals
- BUY / SELL counts
- filled setups
- TP1 / TP2 / TP3 hits
- completed setups
- invalidations
- expiries
- missed entries

These statistics begin accumulating from the time the production webhook is activated. They are not fabricated for historical periods before the webhook existed.

## Contextual signal policy

The Google intelligence layer is separate from the indicator's own SMC method score.

It uses:

- source SMC method score
- H4/M15/M1 alignment
- detailed SMC evidence breadth
- risk-reward geometry
- exact method matches
- signal freshness
- counter-trend penalty
- major-bias-change penalty

The dashboard can preserve the source BUY/SELL or downgrade the suggested action to `WAIT`. It does not manufacture a new opposite trade direction.

Examples:

- fresh aligned BUY -> `BUY setup confirmed`
- pending limit -> `BUY setup · wait for limit`
- entry filled -> `manage active`
- TP1 -> `manage active`
- TP2 -> `protect winner`
- TP3 -> `WAIT / completed`
- invalidated -> `WAIT / setup invalidated`
- expired or missed -> `WAIT`
- major H4 bias changed -> `WAIT for confirmation`

The contextual score is a setup-quality score, not a guaranteed win probability.

## Public Google Cloud API

```text
POST /api/tradingview/webhook
GET  /api/tradingview/config
GET  /api/tradingview/signals/live
GET  /api/tradingview/signals
GET  /api/tradingview/signals/metrics
GET  /api/tradingview/signals/:setupId
WS   /api/live
```

Useful filters for the history feed:

```text
?symbol=EURUSD
?timeframe=M1
?side=BUY
?status=ACTIVE_FILLED
?limit=100
```

## Visual desk

The website navigation includes **TradingView Signals**. The section provides:

- live connection status
- active setup count
- latest/selected indicator signal
- separate source signal and FXGA contextual action
- SMC method identity and score
- H4/M15/M1 hierarchy
- entry/SL/TP graphical ladder
- current signal market price from the alert payload
- RR to targets
- lifecycle status
- active feed
- signal anatomy/evidence
- contextual score components
- prospective performance metrics
- searchable/filterable signal history
- structural invalidation guidance
- double-click beginner explanations

## First live verification

After creating the TradingView alert, wait for an actual indicator lifecycle event. Then verify:

1. TradingView alert log reports webhook delivery.
2. Google Cloud Run logs show `POST /api/tradingview/webhook` returning HTTP 200.
3. `GET /api/tradingview/signals?limit=5` contains the setup.
4. `GET /api/tradingview/signals/metrics` increments exactly once for that event.
5. The website's **TradingView Signals** section updates through `/api/live` without a manual refresh.

If TradingView receives HTTP 403, inspect the Google Cloud request's forwarded client IP before changing security policy. Do not solve an IP-forwarding issue by making the webhook universally unauthenticated.
