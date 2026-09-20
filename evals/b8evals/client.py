"""HTTP client for `POST /api/v1/chat`.

Authenticates with a personal bearer token minted by `npm run tokens` on the server, over SSH.
A read-only token is sufficient and is what should be used: `/api/v1/chat` is in the app's
READ_SAFE_POSTS set (`lib/bearerAuth.ts`), so a `--read` token may POST to it and can do nothing
else. Running the harness with a full-scope token buys nothing and widens the blast radius of a
leaked fixture environment.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping

import httpx


class ChatError(RuntimeError):
    pass


class RateLimited(ChatError):
    def __init__(self, message: str, retry_after: float | None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True)
class ChatRun:
    """One response from the agent, mirroring the `ChatRun` type in the route handler."""

    reply: str
    trace: tuple[Mapping[str, Any], ...]
    turns: int
    stopped_at_max_turns: bool
    input_tokens: int
    output_tokens: int
    latency_s: float

    @property
    def tool_names(self) -> tuple[str, ...]:
        return tuple(str(c.get("name")) for c in self.trace)


# 5xx and timeouts are the upstream having a bad minute, not the agent being wrong. Counting one
# as a failed vote corrupts the measurement: it is indistinguishable in the report from the model
# choosing the wrong tool. Observed live — a run hit two 500s with "Request timed out" from the
# Anthropic SDK inside the route while the API was degraded, and one request took 4.2 minutes.
#
# 429 is deliberately NOT retried here. That is the app's own rate limiter, it carries Retry-After,
# and the runner has a policy for it: stop, rather than sit in a backoff loop burning the ceiling.
RETRY_STATUSES = frozenset({500, 502, 503, 504, 529})


@dataclass(frozen=True)
class ChatClient:
    base_url: str
    token: str
    timeout_s: float = 120.0
    max_retries: int = 2
    backoff_s: float = 2.0

    @classmethod
    def from_env(
        cls,
        base_url: str | None = None,
        token_env: str = "B8_EVAL_TOKEN",
        timeout_s: float = 120.0,
    ) -> "ChatClient":
        url = base_url or os.environ.get("B8_BASE_URL")
        if not url:
            raise ChatError(
                "No base URL. Pass --base-url or set B8_BASE_URL "
                "(e.g. https://<machine>.tail368cae.ts.net)"
            )
        token = os.environ.get(token_env)
        if not token:
            raise ChatError(
                f"No token in ${token_env}. Mint a read-only one on the server:\n"
                f"  npm run tokens -- create 'eval runner' --read\n"
                f"then export it here. The token is shown once."
            )
        return cls(base_url=url.rstrip("/"), token=token, timeout_s=timeout_s)

    def _post_with_retries(
        self,
        http: httpx.Client,
        question: str,
        sleep: Callable[[float], None],
    ) -> httpx.Response:
        """POST, retrying only transport failures and 5xx. Raises the last error if all fail."""
        last: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = http.post(
                    f"{self.base_url}/api/v1/chat",
                    json={"messages": [{"role": "user", "content": question}]},
                    headers={"Authorization": f"Bearer {self.token}"},
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = exc
            else:
                if response.status_code not in RETRY_STATUSES:
                    return response
                last = ChatError(
                    f"HTTP {response.status_code}: {_error_message(response)}"
                )
            if attempt < self.max_retries:
                sleep(self.backoff_s * (attempt + 1))
        raise ChatError(f"upstream failed after {self.max_retries + 1} attempts: {last}")

    def ask(
        self,
        question: str,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> ChatRun:
        """Send one question as a fresh single-message conversation.

        Fresh every time and deliberately so: carrying history between golden questions would let
        question 7 pass because question 6 had already fetched the data, which measures the
        transcript rather than the routing.
        """
        owns = client is None
        http = client or httpx.Client(timeout=self.timeout_s)
        started = time.monotonic()
        try:
            response = self._post_with_retries(http, question, sleep)
        finally:
            if owns:
                http.close()
        latency = time.monotonic() - started

        if response.status_code == 429:
            retry = response.headers.get("Retry-After")
            raise RateLimited(
                _error_message(response) or "rate limited",
                float(retry) if retry and retry.isdigit() else None,
            )
        if response.status_code == 401:
            raise ChatError(
                "401 — the token was rejected. It may be revoked, expired, or for another host."
            )
        if response.status_code >= 400:
            raise ChatError(f"HTTP {response.status_code}: {_error_message(response)}")

        body = response.json()
        if not body.get("success"):
            raise ChatError(f"request failed: {_error_message(response)}")

        data = body["data"]
        if "trace" not in data:
            raise ChatError(
                "The response carries no `trace`. This harness needs the tool trace the chat route "
                "returns; the server is running a build from before that landed."
            )
        usage = data.get("usage") or {}
        return ChatRun(
            reply=data.get("reply", ""),
            trace=tuple(data.get("trace") or ()),
            turns=int(data.get("turns", 0)),
            stopped_at_max_turns=bool(data.get("stoppedAtMaxTurns", False)),
            input_tokens=int(usage.get("inputTokens", 0)),
            output_tokens=int(usage.get("outputTokens", 0)),
            latency_s=latency,
        )


def _error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except Exception:
        return response.text[:200]
    error = body.get("error") or {}
    return error.get("message") or str(body)[:200]
