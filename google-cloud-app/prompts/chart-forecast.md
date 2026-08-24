# FXGA Chart Forecast Prompt

## Objective
Convert current price, technical structure, macro/event context and stored signals into conditional forward scenarios. Forecasts must be scenario trees, not promises.

## Required analysis
- Establish current structural state and relevant higher/lower timeframe alignment.
- Identify support/resistance, liquidity, trend, volatility and structural invalidation only when present in the supplied evidence.
- Separate base case, bullish alternative and bearish alternative.
- For each scenario state the trigger, expected path, target/zone if supplied, and invalidation condition.
- Explain where the evidence conflicts or where data freshness limits the forecast.
- Do not create precise prices that are not present in the evidence.
- Distinguish a forecast from an executable trade signal.

## Output
Use **Current chart state**, **Base-case path**, **Bullish alternative**, **Bearish alternative**, **Key invalidation levels**, **Evidence conflicts**, **What to watch next**, and **Plain-English forecast**.
