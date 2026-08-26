# FXGA Telegram Member Agent

A separate, persistent FXGA operational agent that processes a Telegram member queue every day.

## Runtime architecture

`member CSV -> Firestore queue -> Cloud Scheduler -> Cloud Run Job -> Telegram MTProto -> Firestore state`

The agent is independent of the macro dashboard process. Google Cloud persists its queue, cursor, per-day totals, status history, rate-limit state, and run summaries even when the Cloud Run container is not running.

## Direct-add-only contract

This agent uses **direct Add only**.

It does **not**:

- send private messages or DMs;
- create or send invite links;
- create join-request links;
- message a person first when Telegram blocks a direct add;
- switch to any invitation-link fallback;
- rotate accounts to work around Telegram restrictions.

For channels and supergroups, Telegram's MTProto API unfortunately names the direct-add RPC `channels.inviteToChannel`. Despite that API name, this operation is the platform's direct member-add operation: it attempts to place the selected user directly into the channel/supergroup. The agent uses that RPC only as the direct Add action. If Telegram does not allow the add, the member is marked with the relevant skip/defer status and the agent moves on.

The CI workflow enforces this contract and fails if messaging or invite-link APIs are introduced into the agent source.

## Daily behavior

- Reads member records in source order and resumes from the persisted Firestore cursor.
- Uses `DAILY_TARGET_MIN=20` as the desired minimum and `DAILY_TARGET_MAX=50` as the hard daily success cap.
- Enforces the maximum across the whole Africa/Johannesburg calendar day, not merely per Cloud Run execution.
- Stops after `MAX_ATTEMPTS_PER_RUN=100` direct-add attempts even if the success target was not reached.
- Continues past people who are already members.
- Treats Telegram `missing_invitees` responses as unsuccessful direct additions instead of counting them as added.
- Skips privacy-restricted, non-mutual-contact, deactivated, invalid, blocked, kicked, bot, Premium-required, or channel-limit cases instead of messaging them first.
- Waits between direct-add requests, stops immediately on `FLOOD_WAIT`/`PEER_FLOOD`, and stores the block-until time.
- Defers unknown transient failures and retries them on a later run.
- Uses a Firestore transaction lock so scheduled/manual runs cannot process the queue concurrently.
- Re-importing the roster preserves existing `added`, skipped, retry and attempt state rather than resetting everybody to pending.

The agent does not bypass Telegram privacy/contact restrictions or evade Telegram flood controls.

## Telegram account requirement

Directly adding a Telegram user to a channel/supergroup is an MTProto user-account action, not a Bot API action. Use a dedicated Telegram user account that you control and make that account an administrator of the target channel with permission to add members.

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

Export the member worksheet to CSV. The importer accepts extra columns, but these headers must exist:

```text
username,user id,access hash,name,group,group id
```

From an authenticated Google Cloud Shell or another environment with Application Default Credentials and Firestore access:

```bash
cd agents/telegram-member-agent
npm install
npm run import -- "/path/to/Forex Telegram members 1 - FXGA Agent Import.csv"
```

The importer deduplicates rows by Telegram user ID, or by username when no user ID is present. `user id` and `access hash` are stored as strings so 64-bit Telegram values are not rounded by JavaScript. Existing queue outcomes are preserved on re-import.

## Firestore

Queue collection: `telegram_member_queue`

Main fields include:

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
- `lastImportedAt`

Persistent state document: `agent_state/telegram-member-agent`

It stores the queue cursor, run lock, `blockedUntil`, daily date/count, last error, and last run summary.

## Member statuses

- `pending` or no status yet for a newly imported member
- `added`
- `already_member`
- `privacy_restricted`
- `requires_mutual_contact`
- `premium_required`
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

Cloud Scheduler invokes the Cloud Run Job through the authenticated Cloud Run v2 `jobs:run` API.

## Manual execution

After deployment:

```bash
gcloud run jobs execute fxga-telegram-member-agent \
  --region us-central1 \
  --project fxglobalavengerstradingacademy \
  --wait
```

Manual execution does not reset the daily counter; the daily cap remains enforced.

## Dry run

Set `DRY_RUN=true` on the Cloud Run Job to inspect queue selection without performing direct member-add requests. Dry-run selection is capped by the remaining daily capacity and does not mark members as added.
