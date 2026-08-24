# Session close/expiry management

Horizon: end of current session.
Task: determine whether a session trade is complete, invalid, still active but expiring, or explicitly eligible for handoff. Assess remaining target distance, current structure and next-session/event risk. Default to strategy expiry rather than silently carrying a session trade forward.