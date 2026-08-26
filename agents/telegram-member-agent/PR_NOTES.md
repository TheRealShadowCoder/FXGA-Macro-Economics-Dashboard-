# Implementation notes

This subsystem is intentionally isolated from the macro dashboard runtime.

- Runtime: Google Cloud Run Job
- Persistence: Firestore
- Schedule: Cloud Scheduler, Africa/Johannesburg
- Secrets: Google Secret Manager
- Deployment: GitHub Actions via existing Workload Identity Federation
- Telegram: MTProto user account; privacy and flood restrictions are respected

The member roster itself must not be committed to this repository.
