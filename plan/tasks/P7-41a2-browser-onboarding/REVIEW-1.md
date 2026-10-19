# P7-41a2 — adversarial review, cycle 1 — 2026-10-18

**Verdict: ACCEPT_WITH_NITS.** No BLOCK. Four nits (NITS.md N1–N4), three INCONCLUSIVE items (X1–X3, run at G4).
Persisted by the orchestrator from the reviewer's report; the reviewer is read-only.

## Falsification log (hypothesis → method → outcome)
1. A failed create (401/400/403/network/malformed 200) shows a half-formed link → read InviteControl.tsx:63-88, invitationLink.ts:99-107 → REFUTED: a link is set only on `response.ok` and a structurally valid body; every error path leaves it null and shows the server message or a fixed fallback.
2. The code reaches a URL path or query → invitationLink.ts:46-48, U1 → REFUTED.
3. The code reaches a request body → passkeyCeremony.ts:75-92, C1 → REFUTED.
4. The code reaches storage, a cookie or a console line → changed sources, C7, I5, B1/B3 → REFUTED.
5. The code leaks in a Referer → next.config.ts, B3 (reads `requestWillBeSentExtraInfo`), B9 → REFUTED.
6. The code survives in DOM/state after Done, path change or drawer close → InviteControl dismiss, Sidebar key, drawer mount → REFUTED except N3.
7. An empty `x-invitation-code` can be sent → invitationHeaders, runCeremony, U5/C2 `toStrictEqual` → REFUTED.
8. The code is sent on login requests → passkeyCeremony.ts:72, page.tsx:95, C3 → REFUTED.
9. A retry/fallback enrols a passkey for the owner → page `attempt()`, proxy.ts:57-62 → REFUTED: one call, no fallback.
10. Fragment read during SSR / hydration mismatch → page.tsx:60, 74-85 → REFUTED (effect; Strict Mode second run is a no-op).
11. `hashchange` missed or Back returns to the code → listener, `replaceState`, B2 history checks → REFUTED.
12. The invalid state sends a request → page invalid branch, B5 → REFUTED.
13. Reader restates the rule by hand / U4 tautological → invitationFragment.ts:42-58, U4 → REFUTED.
14. `mayInvite` loose → invitationLink.ts:85-89, U6 → REFUTED.
15. zod in the shell bundle → import lines (type-only in Sidebar/InviteControl/invitationLink) → REFUTED.
16. Page still uses the old inline ceremony → page.tsx imports → REFUTED; G2's M1/M2 prove the page path is live.
17. C tests pass a weaker implementation → passkeyCeremony.test.ts → REFUTED.
18. Browser check claims more than it asserts → whole script → PARTLY: N1, N2.
19. Ordinary `/login` changed → none branch, C2, B7 → REFUTED by reading; byte comparison = X1.
20. Client-clock expiry or invitee name shown → formatExpiry, page → REFUTED.
21. Axis-specific refusal invented → refusalMessage → REFUTED.
22. Double-click race → ref guard + disabled, B1 → REFUTED.
23. Service worker caches/logs ceremony traffic → public/sw.js:48-83 → REFUTED.
24. Server file or PRE_AUTH_PATHS edited → G2 #8, T41a-S17 → REFUTED.
25. Real name / real code / money figure → all new files, EVIDENCE.md → REFUTED (screenshots viewed by the orchestrator at G2).
26. Non-goals exceeded → InviteControl, page → REFUTED.

## INCONCLUSIVE (for G4)
- X1 ordinary branch identical to the pre-change page (request inits, JSX, fallback string).
- X2 the scrub holds under `next start`, not only `next dev`.
- X3 bfcache cannot restore the owner's open panel.
