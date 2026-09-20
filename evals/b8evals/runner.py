"""Running the golden set: repeats, majority vote, and what a run costs."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
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


@dataclass
class QuestionResult:
    question: GoldenQuestion
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return majority(a.ok for a in self.attempts)

    @property
    def tools_passed(self) -> bool:
        return majority(a.grade.tools_ok for a in self.attempts if a.grade)

    @property
    def answer_passed(self) -> bool:
        return majority(a.grade.answer_ok for a in self.attempts if a.grade)

    @property
    def flaky(self) -> bool:
        """Passed by majority but not unanimously — worth seeing, and not a failure."""
        oks = [a.ok for a in self.attempts]
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
    def ok(self) -> bool:
        return not self.failed


def planned_requests(questions: Sequence[GoldenQuestion], repeats: int) -> int:
    return len(questions) * repeats


def run_suite(
    client: ChatClient,
    questions: Sequence[GoldenQuestion],
    repeats: int = 3,
    on_event: Callable[[str], None] = lambda _msg: None,
    stop_on_rate_limit: bool = True,
) -> Report:
    planned = planned_requests(questions, repeats)
    if planned > DAILY_CEILING:
        raise RuntimeError(
            f"{planned} requests planned ({len(questions)} questions x {repeats} repeats) but the "
            f"app's daily ceiling is {DAILY_CEILING}. Lower --repeats or filter the set; a run "
            "that dies halfway spends the allowance and reports nothing."
        )

    report = Report()
    with httpx.Client(timeout=client.timeout_s) as http:
        for question in questions:
            result = QuestionResult(question=question)
            for attempt_index in range(repeats):
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
                    result.attempts.append(Attempt(run=None, grade=None, error=str(exc)))
                    on_event(f"  {question.id} rate limited: {exc}")
                    if stop_on_rate_limit:
                        report.results.append(result)
                        on_event("Stopping: the app's rate limit was hit.")
                        return report
                except Exception as exc:  # noqa: BLE001 - one bad question must not end the run
                    report.requests_made += 1
                    result.attempts.append(Attempt(run=None, grade=None, error=str(exc)))
                    on_event(f"  {question.id} [{attempt_index + 1}/{repeats}] ERROR {exc}")
            report.results.append(result)
    return report
