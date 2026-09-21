"""Preflight tests. No network: a stub transport serves the overview payload.

The control that matters here is the NEGATIVE one. A preflight that passes on a good database
proves nothing on its own — the whole reason it exists is to fail on a wiped one, and that is the
case this file spends most of its lines on.
"""

from __future__ import annotations

import httpx
import pytest

from b8evals.client import ChatClient, ChatError
from b8evals.preflight import Expectations, check, describe

GOOD = {
    "success": True,
    "data": {
        "stats": {"totalTxns": 482},
        "monthlySpending": [
            {"month": "Mar", "operational": "8822.24", "received": "20700.00"},
            {"month": "Jun", "operational": "9612.95", "received": "20700.00"},
        ],
    },
}

WIPED = {
    "success": True,
    "data": {"stats": {"totalTxns": 6}, "monthlySpending": []},
}


def client_for(payload, status: int = 200):
    transport = httpx.MockTransport(lambda r: httpx.Response(status, json=payload))
    return ChatClient(base_url="http://x", token="t"), httpx.Client(transport=transport)


def test_a_good_database_reports_no_problems():
    c, http = client_for(GOOD)
    assert check(c, http=http) == ()


def test_a_wiped_database_is_caught():
    """The 2026-09-21 failure: the integration suite truncated transactions and the next run
    read as an eleven-question model regression."""
    c, http = client_for(WIPED)
    problems = check(c, http=http)
    assert len(problems) == 3
    what = " ".join(p.what for p in problems)
    assert "transaction count" in what and "Mar" in what and "Jun" in what


def test_a_subtly_reseeded_database_is_caught():
    """The count is fine and the figures are not — a reseed at a different date, which is the
    case a count-only check would wave through."""
    payload = {
        "success": True,
        "data": {
            "stats": {"totalTxns": 500},
            "monthlySpending": [
                {"month": "Mar", "operational": "8100.00", "received": "20700.00"},
                {"month": "Jun", "operational": "9612.95", "received": "20700.00"},
            ],
        },
    }
    c, http = client_for(payload)
    problems = check(c, http=http)
    assert len(problems) == 1
    assert problems[0].what.startswith("Mar")


def test_a_missing_month_is_caught_distinctly_from_a_wrong_figure():
    payload = {
        "success": True,
        "data": {
            "stats": {"totalTxns": 500},
            "monthlySpending": [{"month": "Jun", "operational": "9612.95"}],
        },
    }
    c, http = client_for(payload)
    problems = check(c, http=http)
    assert len(problems) == 1
    assert problems[0].actual == "month absent"


def test_rounding_within_tolerance_passes():
    payload = {
        "success": True,
        "data": {
            "stats": {"totalTxns": 482},
            "monthlySpending": [
                {"month": "Mar", "operational": "8822.243"},
                {"month": "Jun", "operational": "9612.95"},
            ],
        },
    }
    c, http = client_for(payload)
    assert check(c, http=http) == ()


def test_a_401_says_what_probably_truncated_the_sessions():
    c, http = client_for({"success": False, "error": {"message": "no"}}, status=401)
    with pytest.raises(ChatError, match="truncated auth_sessions"):
        check(c, http=http)


def test_the_message_names_every_problem_and_says_nothing_was_spent():
    c, http = client_for(WIPED)
    text = describe(check(c, http=http))
    assert "nothing was spent" in text.lower()
    assert "470" in text and "6" in text


def test_the_shipped_golden_file_declares_a_preflight():
    """Vacuity control: without a declared fingerprint the suite can be run against any database."""
    e = Expectations.load()
    assert e.min_transactions > 0
    assert len(e.month_operational) >= 2
