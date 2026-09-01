import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();
const snap = await db
  .collection(process.env.FIRESTORE_STATE_COLLECTION || 'agent_state')
  .doc(process.env.FIRESTORE_STATE_DOCUMENT || 'telegram-member-agent')
  .get();

const state = snap.exists ? snap.data() : {};
const summary = state.lastRunSummary || {};
const errors = summary.errors || {};
const blockedUntil = state.blockedUntil?.toDate?.();
const blocked = Boolean(blockedUntil && blockedUntil > new Date());
const dailyAdded = Math.max(0, Number(state.dailyAdded || summary.dailyAddedTotal || 0));
const attempted = Math.max(0, Number(summary.attempted || 0));
const added = Math.max(0, Number(summary.added || 0));
const target = Math.max(0, Number(process.env.RUN_TARGET || 0));
const dailyHardMax = Math.max(1, Number(process.env.DAILY_HARD_MAX || 50));

console.error(
  `Redacted single-user result: attempted=${attempted}; added=${added}; dailyAdded=${dailyAdded}; ` +
  `rateLimited=${summary.stoppedByRateLimit || blocked ? 'yes' : 'no'}; ` +
  `mutualContact=${Number(errors.USER_NOT_MUTUAL_CONTACT || 0) > 0 ? 'yes' : 'no'}.`
);

let decision = 'continue';
if (Number(errors.USER_NOT_MUTUAL_CONTACT || 0) > 0 || summary.stoppedByMutualContact) {
  decision = 'mutual_contact_required';
} else if (summary.stoppedByRateLimit || blocked) {
  decision = 'rate_limit';
} else if (summary.fatalError) {
  decision = 'fatal_error';
} else if (dailyAdded >= target) {
  decision = 'run_target';
} else if (dailyAdded >= dailyHardMax) {
  decision = 'daily_max';
} else if (attempted === 0) {
  decision = 'no_progress';
}

process.stdout.write(decision);
