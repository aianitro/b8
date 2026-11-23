# P8-42c2 — gates

## G0 — spec gate — 2026-11-22 — PASS (amendment A1)

The spec-writer's draft has 18 commands, 20 scenarios (T42c2-U1 to U6, I1 to I14 and H15), 21 open questions each
with a chosen default, and a mutation list.

**Fixtures (T16):** `apps/web/lib/fixtures/loyalty-read/` was written by the orchestrator from scratchpad
`gen_read_fixtures.py`. The generator computes every expected value from the spec's rules and asserts them:
- 29 decisions;
- 26 clean cases;
- 12 suffix cases;
- 17 jump cases;
- 11 retry scripts;
- 22 memberships, with no two applying decisions sharing a membership.

The shape check prints `fixture shape ok`. The digest `a63773c1…4cd8` is pinned in command 16.

**A1:** command 18's thousands-separator scan matched the spec's own `sed` line ranges, so those two forms are now
excluded. After the fix, #18 gives `OK spec has no money-looking text`.

**Toolchain, measured:**
- T1 `1`.
- T2 head `1793000000000_loyalty_inbox`, `loyalty_inbox_reads` `none`.
- T3 `exit=0`.
- T4–T7, T9 and T10 come from 42c1's G4 run on this same tree (HEAD `1ecd44f`, dataless `0`): 108 files and 1421
  tests, lint 0 errors and 5 warnings, integration `OK 356 tests` with the KNOWN set, tsc `exit=0`, `OK H1-H14` with
  port 3198 free, build `exit=0`.
- T8 Node 26.
- T11: every extracted line starts as stated.
- T12: #9 gives `OK failing set stable and within KNOWN`; #10 gives every regression line and `OK classes`.
- T13: the 42c1 files are tracked, merge-base equals HEAD, and the only change outside `plan/` is this task's own
  fixture directory, which the spec requires to exist before the freeze.
- T14 `0,0`.
- T15 `reached`.
- T16 as above.
- T17: SDK `ANTHROPIC_BASE_URL` ×3, `maxRetries` ×10.
- T18 `exit=0`.
- T21 `exit=0`.
- T22 `exit=0`.

The model choice (claude-opus-5-5 with the server-side fallback, effort medium) follows the receipt reader. It is
accepted.

Spec frozen.

## G1 — contract gate — 2026-11-22 — PASS (amendment A2)

The guardian's run was cut off by the weekly usage limit while it was writing the migration. It resumed after the
reset from the partial file on disk.

**Deliverables, all additive:**
- `migrations/1793100000000_loyalty_inbox_read.sql`: three tables and the state row. It has 22 named CHECKs on
  reads that make a contradictory state row impossible, and jsonpath shape-checks on both arrays, so no free text can
  be stored. The down drops only the three tables, and the header carries backup commands.
- `db/schema.sql` mirror.
- `packages/contracts/loyalty.ts`: 13 constants in spec order, 9 vocabularies, `ITEM_RESOLVED`, request, panel, run
  and resolve schemas, and two new `*ResponseSchema` (7 become 9), with `inboxRead` required on the overview.
- `CONTRACT.md`.

**Orchestrator runs:**
- dataless `0`;
- #5 `OK migration up-down-up`, so the never-executed jsonpath CHECKs parse and every accepted or refused row in #5
  behaves;
- #6 `OK schema`;
- tsc errors only in the expected overview producers (`loyaltyResponses.ts` 2, `loyaltyStore.ts` 1).

The scan of the contract files for money-like figures and names is clean.

**A2** rules on the guardian's five points (the attempt written as a provisional `retry`/`api_error`, the unconstrained
`stale` membership, the FK refusal, the attempts range, a queued row always carrying a balance).

Lease closed.

## G2 — build gate — 2026-11-23 — PASS (amendment A4)

The implementer's bundle reported #4 and #13 failing on two spec contradictions (C1, C2) and routed around
neither. A4 (SPEC.md, written 2026-11-22) rules on both and on four further points. This is the first run of
the amended commands.

**Orchestrator runs, 2026-11-23T22:13Z to 22:18Z:**
- HEAD `38ab669` (`1ecd44f` plus a `.gitignore`-only merge; every command diffs against `git merge-base HEAD
  main`, so the task's diff is unchanged). SPEC.md sha256 prefix `374803d057480584`.
- Each command extracted unchanged from SPEC.md into its own file and run in its own `/bin/bash` 3.2 from the
  repo root, in order 1 to 19. `ANTHROPIC_*` and `LOYALTY_IMAP_*` unset, `PRIOR_REDUCER=6` exported, port 3198
  free, Postgres accepting connections.
- dataless `0` before every command.

**Verdicts as printed:**
- #1 `exit=0`.
- #2 `OK lint 0 errors, warnings not above 5` (5 warnings).
- #3 `OK unit 111 files 1427 tests`.
- #4 `OK dependencies` (A4.1: `chat/route.ts` in the importer list).
- #5 `OK migration up-down-up`.
- #6 `OK schema`.
- #7 `OK 6 scenarios T42c2-U1..U6 each present once and passed`, for `TZ=UTC` and `TZ=Pacific/Auckland`.
- #8 `OK 370 tests, … T42c2-I1-I14 each present once and passed`, then `OK no fixture rows left`.
- #9 `[]`, `[]`, `OK failing set stable and within KNOWN`.
- #10 all 15 OK lines, including both `fixture shape ok` lines and `OK classes`.
- #11 `H1 PASS` to `H15 PASS` each once, `OK H1-H15`, `OK surface`.
- #12 `OK two registry lines added, none changed`.
- #13 `OK task source guards` (A4.2 and A4.3: the panel may name the key as text only; component scans run
  over `$TC`).
- #14 no output, exit 0.
- #15 `OK existing tests edited only as allowed; removed lines 12`.
- #16 `fixture shape ok`, `OK fixtures pinned and covered`.
- #17 `OK mutation evidence rows 27`.
- #18 `OK spec has no money-looking text`.
- #19 `✓ Compiled successfully`, 45 static pages, `exit=0`.

**Checklist (BUILD.md §7.3):**
- Every command run by the orchestrator, output captured: yes.
- All pass: yes.
- `tsc` and lint: #1 and #2.
- `git status --short` reviewed line by line: 46 paths, all on the declared surface (loyalty routes,
  components and lib, the two domain modules, fixtures, the migration, `db/schema.sql`, contracts, the gift
  registry and surface script, `scheduler.ts`, `plan/QUEUE.md`, this task's directory).
- `AGENTS.md`: clean.
- Evidence bundle: present. Its #4 and #13 failures predate A4 and are superseded by this run.

Next: G3 (adversarial reviewer), with this entry and the verbatim outputs as its input.

## G3 — adversarial gate — 2026-11-23 — PASS (cycle 1)

Verdict `ACCEPT_WITH_NITS` ([REVIEW-1.md](REVIEW-1.md)). The falsification log has 48 hypotheses: 43 refuted, 4
confirmed as nits, 1 split into a nit and an inconclusive item. No BLOCK. The reviewer checked the A4-amended commands
for vacuous passes: #4, #13 (the `$TC` scans run over 9 component files) and #11. None passes without the behaviour.

**INCONCLUSIVE items, run by the orchestrator** (the reviewer's commands, verbatim, from the repo root; their
`simpleParser` options match `textForReader`'s exactly):
- **I-1** (attached `message/rfc822` forward): `{"embeddedBody":false,"memberAddr":false,"brandAddr":false}`. No
  address from inside the attachment reaches the model, so the possible BLOCK does not hold. The embedded body is not
  read either, so a statement forwarded as an attachment never yields a balance. Recorded as follow-up N11.
- **I-2** (HTML `mailto:`): `{"mailtoAddr":true,"token":false}`. Link tokens are removed; a `mailto:` address is
  not. Confirms N2.

Ten nits from the review plus N11 are recorded in [NITS.md](NITS.md) as follow-ups.

## G4 — integration gate — 2026-11-23 — PASS

**Fresh full run on the final tree**, 2026-11-23T22:39Z to 22:43Z. HEAD `38ab669`, SPEC.md sha256 prefix unchanged
since G2 (`374803d057480584`); only `plan/` docs (REVIEW-1.md, NITS.md, GATES.md, QUEUE.md) changed since G2.
Same method as G2 (each command extracted unchanged, own `/bin/bash`, `PRIOR_REDUCER=6`, `ANTHROPIC_*` and
`LOYALTY_IMAP_*` unset), dataless `0` before every command:
- #1 `exit=0`;
- #2 `OK lint 0 errors, warnings not above 5`;
- #3 `OK unit 111 files 1427 tests`;
- #4 `OK dependencies`;
- #5 `OK migration up-down-up`;
- #6 `OK schema`;
- #7 both zones OK;
- #8 `OK 370 tests, … T42c2-I1-I14 each present once and passed`, `OK no fixture rows left`;
- #9 `[]`, `[]`, `OK failing set stable and within KNOWN`;
- #10 all 15 OK lines and both `fixture shape ok`;
- #11 `H1 PASS` to `H15 PASS`, `OK H1-H15`, `OK surface`;
- #12 `OK two registry lines added, none changed`;
- #13 `OK task source guards`;
- #14 no output;
- #15 `OK existing tests edited only as allowed; removed lines 12`;
- #16 `fixture shape ok`, `OK fixtures pinned and covered`;
- #17 `OK mutation evidence rows 27`;
- #18 `OK spec has no money-looking text`;
- #19 `✓ Compiled successfully`, 45 static pages, `exit=0`.

**BUILD.md §7.5:**
- Full suite, tsc, lint and build: green (#3, #1, #2, #19).
- Migration round trip: clean (#5, against the throwaway database).
- Review INCONCLUSIVEs: I-1 and I-2 run by the orchestrator at G3, recorded there.
- Truthfulness: `lib/domain/netWorth.test.ts` and `lib/domain/drift.test.ts` are in #3's unit suite; the overview,
  gift-surface and loyalty route suites are in the integration config #8 and #9 run.
- No real data: #13's quoted-digit scan, #16's pinned fabricated fixtures, #18's spec scan, and the reviewer's
  hypothesis 44.

**PASS → MERGED.**
