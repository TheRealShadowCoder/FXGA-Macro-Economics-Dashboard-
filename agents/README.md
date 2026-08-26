# FXGA Agents

This directory contains autonomous operational agents that are deployed independently from the FXGA macro dashboard.

## Agents

- `telegram-member-agent/` — scheduled Telegram membership queue worker. It persists queue state in Firestore and runs as a Google Cloud Run Job.

Each agent must keep credentials out of source control and use Google Secret Manager for production secrets.
