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
