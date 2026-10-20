// The findings digest (ROADMAP.md §5 Phase 5 step 36): every finding the nine producers report, in a
// reader's order, each saying how old its evidence is, and which sources were not evaluated.
//
// A THIN RENDERER, deliberately. One clock read, one loader call, one call to the pure function, and
// the view. Every sentence is composed in `lib/domain/findingsDigest.ts`; every figure is the
// producer's, carried as the contract's string. This page computes, formats and words nothing, so it
// cannot become a second place where "how bad" or "how old" is decided (T36-W5).
//
// Reachable by its URL only; nothing links to it in this step (SPEC.md Q6). Nothing is sent from it.
export const dynamic = 'force-dynamic';

import DigestView from '@/components/DigestView';
import { composeDigest } from '@/lib/domain/findingsDigest';
import { loadFindingsDigestInput } from '@/lib/findingsDigestRead';
import { pageViewer } from '@/lib/giftViewer';

export default async function DigestPage() {
  // The page's ONE clock read. The loader derives the as-of triple, the freshness instant and the
  // period date from this same value, with the process-local conversion the dashboard uses, so the
  // caption and the findings cannot straddle midnight.
  const now = new Date();
  // Fail closed: no session resolves to `null`, a non-giver. The digest's figures are the same for
  // every viewer, but the loader is told who is looking all the same (see its header).
  const { findings, notEvaluated, period } = await loadFindingsDigestInput(await pageViewer('/digest'), now);
  return <DigestView digest={composeDigest(findings, period, { notEvaluated })} />;
}
