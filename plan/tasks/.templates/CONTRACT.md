# CONTRACT — <task-id>
**Author:** contract-guardian
**Lease:** opened <ts> · closed <ts>

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| shared/types.ts | <field added / widened / renamed> | additive / breaking |
| migrations/<ts>_<slug>.sql | <column, index, constraint> | additive / breaking |
| db/schema.sql | <reflects the migration> | — |

## Rationale
<!-- The why, not the delta. Whoever reads this in six months can see the diff; what they
     cannot recover is the reason this shape was chosen over the obvious alternative. -->

## Domain invariants preserved
- **Derived, not stored:** <confirm no new "current"/"latest" column; observation tables stay append-only>
- **Money:** <NUMERIC(_,2); no float>
- **Null semantics:** <what a missing observation means, and that it is not defaulted to 0>
- **Inheritance:** <if a nullable column means "inherit", where that is documented>

## Migration
```
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
<verbatim output against a throwaway database>

## Backfill / data correction required
<!-- Specified here, executed by the implementer. CSV backup first, always. -->
- <none> | <rows affected, backup path, before/after figures to record in EVIDENCE.md>

## Consumers checked
- `npx tsc --noEmit` → <exit 0: every existing consumer still compiles>
- <surfaces that read this shape, and why each is unaffected>
