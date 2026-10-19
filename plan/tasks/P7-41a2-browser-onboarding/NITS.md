# P7-41a2 — nits (follow-ups, none blocking)

- **N1** `scripts/onboarding-browser-check.mjs:508` — B8's 390px presence check for the owner is document-wide; the desktop `<aside>` is CSS-hidden but mounted, so removing the control from the drawer alone would still pass B8. B1's phone pass is drawer-scoped and would catch it. Fix: scope B8's presence check to `div.fixed.inset-0` at phone width.
- **N2** `scripts/onboarding-browser-check.mjs:417-422` — the dev-server log grep for the code runs in B3, before B4 and B6, so those refusals' server output is not grepped in the browser. I5 covers them in integration. Fix: grep again at the end of the run.
- **N3** `components/Sidebar.tsx:119` — the control is keyed by pathname, so a query-only navigation keeps an open panel and its code. Done, a path change and closing the drawer all discard it.
- **N4** `app/login/page.tsx:77`, `lib/invitationFragment.ts:50` — a mangled key (`#Invite=…`, `#invite%3D…`) reads as `none`; the page shows ordinary `/login` and leaves the code in the address bar. Only reachable for a link damaged outside the app. Fix candidate: scrub any fragment on `/login`, not only one with an `invite` key.
