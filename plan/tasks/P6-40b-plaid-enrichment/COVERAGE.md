# Plaid field coverage — measured before 40b was specified

Read-only, run by the orchestrator on the home server 2026-10-07 against the owner's five linked
Plaid items, `/transactions/get` over the last 90 days, posted rows only. Percentages and counts of
rows only — no names, merchants, places, amounts or ids were printed. Institutions are anonymised.

| Field | All items (531 posted rows) | Largest item (462) | Second (60) |
|---|---|---|---|
| `personal_finance_category.detailed` | 100% | 100% | 100% |
| `authorized_date` | 97% | 99% | 100% |
| `authorized_datetime` | 68% | 65% | 100% |
| `counterparties` non-empty | 80% | 79% | 97% |
| `merchant_name` | 70% | 68% | 97% |
| `logo_url` / `website` / `merchant_entity_id` | 40% each | 38% | 63% |
| `location.city` | 27% (47% of in-store rows) | 19% | 90% |
| `location.address` | 18% | 16% | 40% |
| `location.lat`/`lon` | 13% | 13% | 18% |
| `location.store_number` | 13% | 13% | 10% |

`payment_channel` across all rows: in store 299, online 69, other 163.

**Reading:** the detailed category and authorized date are near-universal; logo/website/entity are
present on two rows in five; city is worth a column for in-store rows; coordinates and street
address are too sparse to justify columns of their own, but are kept in the retained raw object.
