# Session real-time trade management

Horizon: current session with 15-second evidence checks in the FXGA UI.
Task: compare original session signal with current price/technical/calendar/signal state. Report entry validity, active invalidation, remaining objectives, protection/partial/exit state, event risk, time remaining and whether the session setup has expired. Do not convert it into another horizon without an explicit rule.