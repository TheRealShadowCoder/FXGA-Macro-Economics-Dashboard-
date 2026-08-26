# FXGA Telegram Member Agent

A separate, persistent FXGA operational agent that processes a Telegram member queue every day.

## Runtime architecture

`member CSV -> Firestore queue -> Cloud Scheduler -> Cloud Run Job -> Telegram MTProto -> Firestore state`

The agent is intentionally independent of the macro dashboard process. Google Cloud persists its queue, cursor, status history, rate-limit state, and run summaries even when the Cloud Run container is not running.

## Daily behavior

- Reads the next member records in source order.
- Tries to add up to `DAILY_TARGET_MAX=50` successful new members in a run.
- Tracks whether the desired minimum of `DAILY_TARGET_MIN=20` was reached.
- Continues past people who are already members.
- Skips privacy-restricted, non-mutual-contact, deactivated, invalid, blocked, kicked, bot, or channel-limit cases instead of messaging them first.
- Stops immediately on Telegram flood/rate-limit signals and stores the block-until time.
- Defers unknown transient failures and retries them on a later run.
- Uses a Firestore transaction lock so two scheduled/manual runs cannot process the same queue concurrently.
- Resumes from the persisted `nextSequence` cursor on the next day.

The agent does not bypass Telegram privacy/contact restrictions and does not rotate accounts or evade `FLOOD_WAIT`/`PEER_FLOOD` responses.

## Telegram account requirement

Directly adding a Telegram user to a channel/supergroup is an MTProto user-account action, not a Bot API action. Use a dedicated Telegram user account that you control and make that account an administrator of the target channel with permission to invite users.

Create an API application at `my.telegram.org`, then obtain:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`

Generate the reusable StringSession locally:

```bash
cd agents/telegram-member-agent
npm install
TELEGRAM_API_ID=123456 TELEGRAM_API_HASH='your_api_hash' npm run session
```

Store the printed session securely as `TELEGRAM_SESSION`. Anyone with that session can act as the logged-in Telegram account, so never commit it or paste it into issues/logs.

`TELEGRAM_CHANNEL` may be the target channel username (for example `@yourchannel`) or another entity reference resolvable by the authenticated account.

## GitHub Actions secrets

Add these repository Actions secrets:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `TELEGRAM_CHANNEL`

The existing `GCP_WIF_PROVIDER` secret/variable is reused by the deployment workflow. On deployment, Telegram credentials are synchronized to Google Secret Manager and injected into the Cloud Run Job as secret environment variables.

## Import the member list

Do not commit the workbook or member database to this public repository.

Export the `members` worksheet to CSV with these headers unchanged:

```text
username,user id,access hash,name,group,group id
```

Then, from an authenticated Google Cloud Shell or another environment with Application Default Credentials and Firestore access:

```bash
cd agents/telegram-member-agent
npm install
npm run import -- "/path/to/Forex Telegram members 1.csv"
```

`user id` and `access hash` are stored as strings so 64-bit Telegram values are not rounded by JavaScript. When a username exists, the runtime resolves it first to obtain a fresh input entity; the stored user ID/access hash pair is the fallback for records with no username.

## Firestore

Queue collection: `telegram_member_queue`

Main fields:

- `sequence`
- `username`
- `userId`
- `accessHash`
- `name`
- `sourceGroup`
- `sourceGroupId`
- `status`
- `attempts`
- `lastAttemptAt`
- `lastErrorCode`
- `nextRetryAt`
- `addedAt`

Persistent state document: `agent_state/telegram-member-agent`

It stores the queue cursor, scheduler/run lock, `blockedUntil`, last error, and last run summary.

## Member statuses

- `pending`
- `added`
- `already_member`
- `privacy_restricted`
- `requires_mutual_contact`
- `deactivated`
- `invalid_user`
- `user_channel_limit`
- `blocked`
- `kicked`
- `banned`
- `bot_account`
- `add_not_allowed`
- `retry_wait`

## Schedule

The GitHub deployment workflow creates/updates a Google Cloud Scheduler job named `fxga-telegram-member-agent-daily`.

Default schedule: **08:00 Africa/Johannesburg every day**.

Cloud Scheduler invokes the Cloud Run Job through the authenticated Cloud Run v2 `jobs:run` API. Change `SCHEDULE_CRON` in the workflow if a different daily time is preferred.

## Manual execution

After deployment:

```bash
gcloud run jobs execute fxga-telegram-member-agent \
  --region us-central1 \
  --project fxglobalavengerstradingacademy \
  --wait
```

## Dry run

Set `DRY_RUN=true` on the Cloud Run Job to inspect queue selection without sending Telegram invite requests. Dry-run records are not marked as added.
