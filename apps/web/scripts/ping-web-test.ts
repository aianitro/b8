/**
 * Send one real content-free ping to every installed PWA — the Web Push counterpart of
 * `ping-test.ts`.
 *
 *   npm run ping:web -w @b8/web        # from the repo root: npm run ping:web
 *
 * EXISTS BECAUSE THE ONLY WAY TO KNOW PUSH WORKS IS TO RECEIVE ONE, and on this path that matters
 * more than it did for Expo. Two things in the VAPID signing fail silently — a key Node cannot load
 * and a signature in the wrong encoding — and both surface as the push service answering 401 with
 * no indication of which claim it disliked. Waiting for the natural 06:00 ping means learning the
 * crypto was wrong by NOT being notified, which is the worst available signal.
 *
 * It sends the same constant the job sends — no category, no figure, no merchant — because
 * `plan/tasks/P3-25-push-ping/DECISION.md` fixes the payload, and a test path with a different one
 * would be testing something the owner never authorised. That also means a test ping is
 * indistinguishable from a real one on the lock screen: expect it, then ignore it.
 *
 * RUN BY THE OWNER, NOT BY AN AGENT. Step 33's decision is that no agent sends a message to any
 * real address at any point in building this, and a push notification to a real phone is that. The
 * same line sits at the top of `ping-test.ts` and means the same thing here.
 */
import { sendWebPushIfDelivered } from '../lib/webPush';

async function main(): Promise<void> {
  // `['digest']` stands for "the job delivered something", which is the only condition under which
  // a ping is ever sent. Passing it here exercises the real decision rather than bypassing it.
  await sendWebPushIfDelivered(['digest']);
  process.exit(0);
}

void main();
