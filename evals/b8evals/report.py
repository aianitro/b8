"""Rendering a Report — console for a human, JSON for CI."""

from __future__ import annotations

import json
from typing import Any

from .runner import Report

BOLD, DIM, RED, GREEN, YELLOW, RESET = "\033[1m", "\033[2m", "\033[31m", "\033[32m", "\033[33m", "\033[0m"


def to_text(report: Report, color: bool = True) -> str:
    def c(code: str, text: str) -> str:
        return f"{code}{text}{RESET}" if color else text

    lines: list[str] = ["", c(BOLD, "Golden-question results"), ""]

    for result in report.results:
        if result.passed:
            mark = c(YELLOW, "FLAKY") if result.flaky else c(GREEN, "PASS ")
        else:
            mark = c(RED, "FAIL ")
        votes = "".join("." if a.ok else "x" for a in result.attempts)
        lines.append(f"  {mark} {result.question.id:<28} [{votes}]  {result.mean_latency_s:.1f}s")

        if not result.passed:
            for attempt in result.attempts:
                if attempt.error:
                    lines.append(c(DIM, f"          error: {attempt.error}"))
                    continue
                if attempt.grade is None:
                    continue
                for failure in attempt.grade.tool_failures:
                    lines.append(c(DIM, f"          tool:   {failure}"))
                for failure in attempt.grade.answer_failures:
                    lines.append(c(DIM, f"          answer: {failure}"))

    total = len(report.results)
    lines += [
        "",
        f"  {len(report.passed)}/{total} passed"
        + (f", {len(report.failed)} failed" if report.failed else ""),
    ]

    # First, loudest, and before any per-question detail: a partial run is not a pass.
    if report.stopped_early:
        lines.append(c(RED, f"  RUN DID NOT FINISH — {report.stopped_early}"))
        lines.append(c(RED, "  This is NOT a pass. The questions that did not run were not checked."))
    if report.inconclusive:
        ids = ", ".join(r.question.id for r in report.inconclusive)
        lines.append(c(RED, f"  inconclusive (no attempt produced a verdict): {ids}"))

    # The split that decides which file you open next.
    if report.routing_failures:
        ids = ", ".join(r.question.id for r in report.routing_failures)
        lines.append(c(RED, f"  routing failures (wrong tool or wrong arguments): {ids}"))
    if report.presentation_failures:
        ids = ", ".join(r.question.id for r in report.presentation_failures)
        lines.append(c(RED, f"  answer failures (right tool, wrong answer):      {ids}"))

    flaky = [r for r in report.results if r.flaky]
    if flaky:
        lines.append(
            c(YELLOW, f"  flaky (passed by majority, not unanimously): {', '.join(r.question.id for r in flaky)}")
        )

    lines += [
        "",
        c(DIM, f"  {report.requests_made} requests · "
               f"{report.input_tokens:,} in / {report.output_tokens:,} out tokens"),
        "",
    ]
    return "\n".join(lines)


def to_json(report: Report) -> str:
    payload: dict[str, Any] = {
        "ok": report.ok,
        "complete": report.complete,
        "stopped_early": report.stopped_early,
        "planned": report.planned,
        "inconclusive": [r.question.id for r in report.inconclusive],
        "passed": len(report.passed),
        "failed": len(report.failed),
        "requests_made": report.requests_made,
        "input_tokens": report.input_tokens,
        "output_tokens": report.output_tokens,
        "questions": [
            {
                "id": r.question.id,
                "kind": r.question.kind,
                "passed": r.passed,
                "flaky": r.flaky,
                "tools_passed": r.tools_passed,
                "answer_passed": r.answer_passed,
                "mean_latency_s": round(r.mean_latency_s, 3),
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "attempts": [
                    {
                        "ok": a.ok,
                        "error": a.error,
                        "tools": list(a.run.tool_names) if a.run else [],
                        "tool_failures": list(a.grade.tool_failures) if a.grade else [],
                        "answer_failures": list(a.grade.answer_failures) if a.grade else [],
                        "reply": a.run.reply if a.run else None,
                    }
                    for a in r.attempts
                ],
            }
            for r in report.results
        ],
    }
    return json.dumps(payload, indent=2)
