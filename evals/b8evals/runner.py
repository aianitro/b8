"""Running the golden set: repeats, majority vote, and what a run costs."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
import time as _time
from typing import Callable, Sequence

import httpx

from .client import ChatClient, ChatRun, RateLimited
from .fixtures import GoldenQuestion
from .grading import Grade, grade, majority

# The app refuses past 200 chat requests in a local-time day (`lib/rateLimit.ts`, DAILY_CEILING),
# and each request may make up to five model calls. A run that would cross it is stopped before
# the first request rather than halfway through, so the ceiling is never spent on a partial result.
DAILY_CEILING = 200


@dataclass(frozen=True)
class Attempt:
    run: ChatRun | None
    grade: Grade | None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.grade is not None and self.grade.ok

    @property
    def graded(self) -> bool:
        """Did this attempt produce a verdict at all?

        An attempt that errored (a 429, a dead socket) has no opinion about the agent. Counting it
        as a failed vote would blame the model for the network.
        """
        return self.grade is not None


@dataclass
class QuestionResult:
    question: GoldenQuestion
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        graded = [a for a in self.attempts if a.graded]
        if not graded:
            return False
        return majority(a.ok for a in graded)

    @property
    def inconclusive(self) -> bool:
        """No attempt produced a verdict. NOT a pass, and not a failure of the agent either."""
        return not any(a.graded for a in self.attempts)

    @property
    def tools_passed(self) -> bool:
        return majority(a.grade.tools_ok for a in self.attempts if a.grade)

    @property
    def answer_passed(self) -> bool:
        return majority(a.grade.answer_ok for a in self.attempts if a.grade)

    @property
    def flaky(self) -> bool:
        """Passed by majority but not unanimously — worth seeing, and not a failure.

        Only graded attempts count. A rate-limited attempt once made a clean 3/3 look like [..x].
        """
        oks = [a.ok for a in self.attempts if a.graded]
        return self.passed and not all(oks)

    @property
    def input_tokens(self) -> int:
        return sum(a.run.input_tokens for a in self.attempts if a.run)

    @property
    def output_tokens(self) -> int:
        return sum(a.run.output_tokens for a in self.attempts if a.run)

    @property
    def mean_latency_s(self) -> float:
        runs = [a.run.latency_s for a in self.attempts if a.run]
        return sum(runs) / len(runs) if runs else 0.0


@dataclass
class Report:
    results: list[QuestionResult] = field(default_factory=list)
    requests_made: int = 0
    started_at: float = field(default_factory=time.time)
    # Set when the run did not get through the whole set. A partial run that reports a clean pass
    # is the worst output this harness can produce: it is a green CI build over a suite that never
    # ran. Observed once for real — a 429 on request 36 of 39 dropped a question and the report
    # said "12/12 passed", exit code 0.
    stopped_early: str | None = None
    planned: int = 0

    @property
    def passed(self) -> list[QuestionResult]:
        return [r for r in self.results if r.passed]

    @property
    def failed(self) -> list[QuestionResult]:
        return [r for r in self.results if not r.passed]

    @property
    def routing_failures(self) -> list[QuestionResult]:
        """Failed on the tool call — a routing defect, regardless of what the prose said."""
        return [r for r in self.results if not r.tools_passed]

    @property
    def presentation_failures(self) -> list[QuestionResult]:
        """Right tool, wrong answer — the defect is in the prose or the arithmetic, not the plan."""
        return [r for r in self.results if r.tools_passed and not r.answer_passed]

    @property
    def input_tokens(self) -> int:
        return sum(r.input_tokens for r in self.results)

    @property
    def output_tokens(self) -> int:
        return sum(r.output_tokens for r in self.results)

    @property
    def inconclusive(self) -> list[QuestionResult]:
        return [r for r in self.results if r.inconclusive]

    @property
    def complete(self) -> bool:
        return self.stopped_early is None and len(self.results) == self.planned

    @property
    def ok(self) -> bool:
        """A run is ok only if it FINISHED and everything passed."""
        return self.complete and not self.failed and not self.inconclusive


def planned_requests(questions: Sequence[GoldenQuestion], repeats: int) -> int:
    return len(questions) * repeats


# How long the whole run may spend sitting in the limiter's backoff before giving up.
MAX_RATE_LIMIT_WAIT_S = 120.0


def run_suite(
    client: ChatClient,
    questions: Sequence[GoldenQuestion],
    repeats: int = 3,
    on_event: Callable[[str], None] = lambda _msg: None,
    sleep: Callable[[float], None] = _time.sleep,
    http: httpx.Client | None = None,
) -> Report:
    planned = planned_requests(questions, repeats)
    if planned > DAILY_CEILING:
        raise RuntimeError(
            f"{planned} requests planned ({len(questions)} questions x {repeats} repeats) but the "
            f"app's daily ceiling is {DAILY_CEILING}. Lower --repeats or filter the set; a run "
            "that dies halfway spends the allowance and reports nothing."
        )

    report = Report(planned=len(questions))
    waited = 0.0
    owns_http = http is None
    http = http or httpx.Client(timeout=client.timeout_s)
    try:
        for question in questions:
            result = QuestionResult(question=question)
            attempt_index = 0
            while attempt_index < repeats:
                try:
                    run = client.ask(question.question, client=http)
                    report.requests_made += 1
                    verdict = grade(question, run.reply, run.trace)
                    result.attempts.append(Attempt(run=run, grade=verdict))
                    mark = "ok" if verdict.ok else "FAIL"
                    on_event(
                        f"  {question.id} [{attempt_index + 1}/{repeats}] {mark} "
                        f"({run.latency_s:.1f}s, {len(run.trace)} tool call(s))"
                    )
                except RateLimited as exc:
                    report.requests_made += 1
                    # The per-session bucket refills in seconds and is just pacing; waiting it out
                    # costs nothing and keeps the attempt. The DAILY ceiling is the one that means
                    # "come back tomorrow", and only that one ends the run.
                    pause = exc.retry_after
                    if pause is not None and waited + pause <= MAX_RATE_LIMIT_WAIT_S:
                        waited += pause
                        on_event(f"  {question.id} paced by the limiter; waiting {pause:.0f}s")
                        sleep(pause)
                        continue  # same attempt_index — the request did not produce a verdict
                    result.attempts.append(Attempt(run=None, grade=None, error=str(exc)))
                    report.results.append(result)
                    report.stopped_early = (
                        f"the app's rate limit was hit and not waitable ({exc}); "
                        f"{len(report.results)} of {len(questions)} questions ran"
                    )
                    on_event(f"STOPPING: {report.stopped_early}")
                    return report
                except Exception as exc:  # noqa: BLE001 - one bad question must not end the run
                    report.requests_made += 1
                    result.attempts.append(Attempt(run=None, grade=None, error=str(exc)))
                    on_event(f"  {question.id} [{attempt_index + 1}/{repeats}] ERROR {exc}")
                attempt_index += 1
            report.results.append(result)
    finally:
        if owns_http:
            http.close()
    return report
