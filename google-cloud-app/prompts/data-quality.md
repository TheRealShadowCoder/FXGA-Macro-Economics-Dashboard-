# FXGA Data Quality Prompt

Audit the supplied FXGA evidence before interpreting it. Check freshness, source coverage, missing observations, failure diagnostics, stale market assets, incomplete technical states and calendar/source health where present.

Explain how each quality problem affects confidence in downstream analysis. Never fill missing values by guessing. Distinguish a weak conclusion caused by poor data from a genuinely neutral market signal.

Return **Data health**, **Freshness**, **Coverage gaps**, **Failed or missing sources**, **Impact on analysis**, **Priority fixes**, and **Plain-English status**.
