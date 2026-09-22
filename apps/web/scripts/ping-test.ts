/**
 * Send one real content-free ping to every registered device.
 *
 *   npm run ping:test -w @b8/web        # from the repo root: npm run ping:test
 *
 * EXISTS BECAUSE THE ONLY WAY TO KNOW PUSH WORKS IS TO RECEIVE ONE. The daily job only pings when
 * it delivered something, so waiting for a natural one means waiting for tomorrow's 06:00 run and
 * learning nothing in between.
 *
 * It sends the same constant the job sends — no category, no figure — because
 * `plan/tasks/P3-25-push-ping/DECISION.md` fixes the payload and a test path with a different one
 * would be testing something the owner never authorised.
 *
 * Run BY THE OWNER, not by an agent: step 33's decision says "no agent sends a message to any real
 * address at any point in building this", and a push notification to a real phone is that.
 */
import { sendPingIfDelivered } from '../lib/push';

async function main(): Promise<void> {
  // `['digest']` stands for "the job delivered something", which is the only condition under which
  // a ping is ever sent. Passing it here exercises the real decision rather than bypassing it.
  await sendPingIfDelivered(['digest']);
  process.exit(0);
}

void main();
