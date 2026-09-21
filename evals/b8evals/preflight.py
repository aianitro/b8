"""Is the database still the one the golden set was written against?

WHY THIS EXISTS. On 2026-09-21 the repo's integration suite was run against `b8_evals`; one of its
fixtures truncates `transactions, budget_categories, accounts`. The next 48-request run came back
5/16 and read convincingly as an eleven-question code regression. It was an empty database.

That is the harness's blind spot, stated precisely: it can tell "I could not ask" (an error, now
reported as inconclusive) from "the answer was wrong". It CANNOT tell "the answer was wrong" from
"you asked about the wrong data" — a wiped-but-populated database produces confident wrong answers,
not errors, and every assertion fails in a way that looks like the model's fault.

So before spending a single model call, check a few facts that hold if and only if the fixtures are
the ones the expected figures were derived from. This costs one request to a non-model endpoint.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import httpx

from .client import ChatClient, ChatError

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "golden"


@dataclass(frozen=True)
class Expectations:
    """Fingerprint of the fixture database, checked in beside the expected figures."""

    min_transactions: int
    month_operational: Mapping[str, float]
    tolerance: float = 0.005

    @classmethod
    def load(cls, path: Path | None = None) -> "Expectations":
        raw = json.loads((path or (GOLDEN_DIR / "questions.json")).read_text())
        pre = raw.get("preflight")
        if not pre:
            raise ChatError(
                "The golden file declares no `preflight` block. Add one, or the suite can be run "
                "against a database whose figures were never the ones it asserts."
            )
        return cls(
            min_transactions=int(pre["min_transactions"]),
            month_operational={k: float(v) for k, v in pre["month_operational"].items()},
            tolerance=float(pre.get("tolerance", 0.005)),
        )


@dataclass(frozen=True)
class Problem:
    what: str
    expected: str
    actual: str


def check(client: ChatClient, http: httpx.Client | None = None) -> tuple[Problem, ...]:
    """Fetch `/api/v1/overview` and compare it against the fingerprint. No model calls."""
    expectations = Expectations.load()

    owns = http is None
    session = http or httpx.Client(timeout=client.timeout_s)
    try:
        response = session.get(
            f"{client.base_url}/api/v1/overview",
            headers={"Authorization": f"Bearer {client.token}"},
        )
    finally:
        if owns:
            session.close()

    if response.status_code == 401:
        raise ChatError(
            "401 on /api/v1/overview — the token was rejected. If the integration suite was just "
            "run against this database it truncated auth_sessions; mint a new token."
        )
    if response.status_code >= 400:
        raise ChatError(f"preflight could not read /api/v1/overview: HTTP {response.status_code}")

    body = response.json()
    if not body.get("success"):
        raise ChatError("preflight: /api/v1/overview returned its error branch")
    data: Mapping[str, Any] = body["data"]

    problems: list[Problem] = []

    total = int((data.get("stats") or {}).get("totalTxns", 0))
    if total < expectations.min_transactions:
        problems.append(
            Problem(
                "transaction count",
                f">= {expectations.min_transactions}",
                str(total),
            )
        )

    by_month = {
        str(row.get("month")): float(row.get("operational") or 0)
        for row in (data.get("monthlySpending") or [])
    }
    for month, want in expectations.month_operational.items():
        got = by_month.get(month)
        if got is None:
            problems.append(Problem(f"{month} operational spend", f"{want:,.2f}", "month absent"))
        elif abs(got - want) > expectations.tolerance:
            problems.append(Problem(f"{month} operational spend", f"{want:,.2f}", f"{got:,.2f}"))

    return tuple(problems)


def describe(problems: Sequence[Problem]) -> str:
    lines = [
        "",
        "  PREFLIGHT FAILED — this database is not the one the golden figures came from.",
        "  Nothing was asked, so nothing was spent. Every question would have failed and it would",
        "  have looked like the model's fault.",
        "",
    ]
    for p in problems:
        lines.append(f"    {p.what}: expected {p.expected}, found {p.actual}")
    lines += [
        "",
        "  Rebuild it (see evals/golden/README.md), and do not point the repo's integration suite",
        "  at this database — it truncates transactions and budget categories.",
        "",
    ]
    return "\n".join(lines)
