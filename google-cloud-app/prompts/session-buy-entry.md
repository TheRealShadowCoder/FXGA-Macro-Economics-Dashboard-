# Session buy entry

Horizon: current named session only.
Task: evaluate a BUY that must complete or be reclassified by session expiry. Require compatible deterministic direction, session trigger, liquidity/structure confirmation, stop level, target ladder and enough remaining session time. Return WAIT if the buy is late, contradicted or event risk dominates.