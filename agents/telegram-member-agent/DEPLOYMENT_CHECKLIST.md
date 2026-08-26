# Deployment checklist

1. Add `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, and `TELEGRAM_CHANNEL` as GitHub Actions secrets.
2. Add a strong `FXGA_AGENT_ADMIN_KEY` GitHub Actions secret (minimum 16 characters) if the browser-based Agents Settings page should be deployed.
3. `TELEGRAM_BOT_TOKEN` is optional at deployment time. If provided as a GitHub secret it is synchronized to Secret Manager; otherwise the Agents Settings page can test and save the first/current token later.
4. Import the private roster into Firestore using `npm run import -- /path/to/members.csv` from authenticated Cloud Shell.
5. Merge the feature branch into `main` so the deployment workflow builds the direct-add Cloud Run Job, creates the daily Cloud Scheduler trigger, and optionally deploys the secure Agents Settings Cloud Run service.
6. Verify the first execution in Cloud Run logs and confirm Firestore state at `agent_state/telegram-member-agent`.
7. Open the **Agents Settings** URL printed by the deployment workflow, enter the admin key, and use **Check bot status** or **Test & save**. The stored bot token is never displayed back to the browser.

The bot token is isolated from the direct-add worker. Do not commit the private member roster, Telegram session, bot token, or admin key to the repository.
