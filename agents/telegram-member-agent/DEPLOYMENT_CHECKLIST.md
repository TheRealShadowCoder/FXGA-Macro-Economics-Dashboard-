# Deployment checklist

1. Add `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, and `TELEGRAM_CHANNEL` as GitHub Actions secrets.
2. Import the private roster into Firestore using `npm run import -- /path/to/members.csv` from authenticated Cloud Shell.
3. Merge the feature branch into `main` so the deployment workflow builds the Cloud Run Job and creates the daily Cloud Scheduler trigger.
4. Verify the first execution in Cloud Run logs and confirm Firestore state at `agent_state/telegram-member-agent`.

Do not commit the private member roster or Telegram session to the repository.
