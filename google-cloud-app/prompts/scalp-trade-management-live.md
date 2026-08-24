# Scalp real-time trade management

Horizon: live seconds-to-minutes lifecycle.
Task: compare the original scalp signal snapshot with current market/technical/signal evidence every update. Classify WAIT_FOR_ENTRY, ACTIVE, PROTECT, PARTIAL, EXIT, INVALIDATED, EXPIRED or COMPLETED. Report only material changes, current invalidation, remaining targets, event/spread risk and whether the scalp premise has expired.