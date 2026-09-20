"""Retry policy. No network: a stub transport decides what each attempt returns.

These exist because a transient 500 was being recorded as a failed grading vote, which is
indistinguishable in the report from the agent choosing the wrong tool.
"""

from __future__ import annotations

import httpx
import pytest

from b8evals.client import ChatClient, ChatError, RateLimited

OK_BODY = {
    "success": True,
    "data": {
        "reply": "You spent $1,040.40.",
        "trace": [{"turn": 0, "name": "get_monthly_spending", "input": {"category": "Groceries"}}],
        "turns": 2,
        "stoppedAtMaxTurns": False,
        "usage": {"inputTokens": 10, "outputTokens": 5},
    },
}


def client_with(responses: list[httpx.Response]) -> tuple[ChatClient, httpx.Client, list[float]]:
    remaining = list(responses)
    calls: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return remaining.pop(0)

    transport = httpx.MockTransport(handler)
    return (
        ChatClient(base_url="http://x", token="t", backoff_s=0.0),
        httpx.Client(transport=transport),
        calls,
    )


def test_a_transient_500_is_retried_and_then_succeeds():
    client, http, slept = client_with([
        httpx.Response(500, json={"success": False, "error": {"message": "Request timed out."}}),
        httpx.Response(200, json=OK_BODY),
    ])
    run = client.ask("q", client=http, sleep=slept.append)
    assert run.reply.startswith("You spent")
    assert len(slept) == 1


def test_persistent_5xx_gives_up_and_says_how_many_attempts():
    client, http, slept = client_with([httpx.Response(503, text="nope")] * 3)
    with pytest.raises(ChatError, match="after 3 attempts"):
        client.ask("q", client=http, sleep=slept.append)
    assert len(slept) == 2


def test_429_is_not_retried():
    """The app's own limiter. Retrying it burns the daily ceiling the runner is protecting."""
    client, http, slept = client_with([
        httpx.Response(429, headers={"Retry-After": "8"},
                       json={"success": False, "error": {"message": "Too many requests."}}),
    ])
    with pytest.raises(RateLimited) as exc:
        client.ask("q", client=http, sleep=slept.append)
    assert exc.value.retry_after == 8
    assert slept == []


def test_401_is_not_retried():
    client, http, slept = client_with([httpx.Response(401, text="")])
    with pytest.raises(ChatError, match="401"):
        client.ask("q", client=http, sleep=slept.append)
    assert slept == []


def test_a_response_without_a_trace_is_a_clear_error():
    """Guards the one cross-language coupling: the route must return `trace`."""
    body = {"success": True, "data": {"reply": "hi"}}
    client, http, slept = client_with([httpx.Response(200, json=body)])
    with pytest.raises(ChatError, match="no `trace`"):
        client.ask("q", client=http, sleep=slept.append)


def test_usage_and_trace_are_parsed():
    client, http, slept = client_with([httpx.Response(200, json=OK_BODY)])
    run = client.ask("q", client=http, sleep=slept.append)
    assert run.tool_names == ("get_monthly_spending",)
    assert (run.input_tokens, run.output_tokens) == (10, 5)
    assert run.turns == 2 and not run.stopped_at_max_turns


# ── a truncated run must never look like a pass ────────────────────────────────

from b8evals.fixtures import GoldenQuestion, ExpectedToolCall  # noqa: E402
from b8evals.runner import run_suite  # noqa: E402

Q = GoldenQuestion(
    id="q", question="What did I spend on groceries in June?",
    expect_tools=(ExpectedToolCall("get_monthly_spending"),),
)


def _client(responses):
    remaining = list(responses)
    transport = httpx.MockTransport(lambda r: remaining.pop(0))
    return ChatClient(base_url="http://x", token="t", backoff_s=0.0), httpx.Client(transport=transport)


def test_a_pacing_429_is_waited_out_not_fatal():
    """The per-session bucket refills in seconds. Abandoning the run over it drops questions."""
    client, http = _client([
        httpx.Response(429, headers={"Retry-After": "2"},
                       json={"success": False, "error": {"message": "Too many requests."}}),
        httpx.Response(200, json=OK_BODY),
    ])
    slept: list[float] = []
    report = run_suite(client, [Q], repeats=1, sleep=slept.append, http=http)
    assert report.ok and report.complete
    assert slept == [2.0]


def test_an_unwaitable_rate_limit_stops_the_run_and_it_is_not_ok():
    """The regression this exists for: a 429 on request 36 of 39 once produced
    'ok: True, 12/12 passed' with question 13 silently unrun."""
    client, http = _client([
        httpx.Response(429, json={"success": False,
                                  "error": {"message": "today's request ceiling"}}),
    ])
    report = run_suite(client, [Q, Q], repeats=1, sleep=lambda _s: None, http=http)
    assert not report.ok
    assert report.stopped_early is not None
    assert not report.complete


def test_an_errored_attempt_is_not_counted_as_a_failed_vote():
    """Two clean passes and one dead socket is a pass, not a flaky [..x]."""
    client, http = _client([
        httpx.Response(200, json=OK_BODY),
        httpx.Response(200, json=OK_BODY),
        httpx.Response(401, text=""),
    ])
    report = run_suite(client, [Q], repeats=3, sleep=lambda _s: None, http=http)
    result = report.results[0]
    assert result.passed and not result.flaky and not result.inconclusive


def test_all_attempts_erroring_is_inconclusive_not_passed():
    client, http = _client([httpx.Response(401, text="")] * 2)
    report = run_suite(client, [Q], repeats=2, sleep=lambda _s: None, http=http)
    assert report.results[0].inconclusive
    assert not report.results[0].passed
    assert not report.ok
