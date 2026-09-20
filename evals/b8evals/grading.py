"""Grading — pure functions over a recorded run. No network, no model, no database.

This module is the reason the harness is testable at zero cost: every rule below is exercised by
`tests/test_grading.py` against hand-written traces, so a change to the grader is verified without
spending a single Anthropic call. Only `runner.py` talks to the app.

The central decision here is that TOOL CORRECTNESS AND ANSWER CORRECTNESS ARE GRADED SEPARATELY
and both are reported. An agent that calls the wrong tool and still produces the right number has
a routing bug that will surface on the next question; an agent that calls the right tool and
describes it badly has a phrasing bug. Collapsing those into one pass/fail throws away the
distinction that decides which file you open.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

from .fixtures import ExpectedAmount, ExpectedToolCall, GoldenQuestion

# ── Reading numbers out of prose ───────────────────────────────────────────────

# Matches 1040, 1,040.40, $1,040.40, 1040.4 — and deliberately NOT a bare year like 2030, which is
# filtered afterwards by context rather than by the pattern, since $2,030 is a legitimate figure.
# The comma-grouped alternative requires at least one group (`+`, not `*`). With `*` it matched
# the bare prefix of an ungrouped number — "1040.4" came apart into 104 and 0.4, and the harness
# would then have reported a correct answer as wrong.
#
# The two guards are not cosmetic, and both were put here by a real false positive on the first
# live run. `(?<![A-Za-z0-9])` stops the 8 in "B8 Finance" being read as a figure, which failed
# three correct refusals for confabulating. `(?![A-Za-z0-9])` stops "401k" being read as 401 — and it must
# exclude digits too, or the pattern simply backtracks and matches the 40.
_NUMBER = re.compile(
    r"(?<![A-Za-z0-9])-?\$?\s?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![A-Za-z0-9])"
)


def numbers_in(text: str) -> tuple[float, ...]:
    """Every number in the text, as floats. Commas and dollar signs are stripped."""
    out: list[float] = []
    for raw in _NUMBER.findall(text):
        cleaned = raw.replace("$", "").replace(",", "").replace(" ", "")
        if cleaned in ("", "-", "."):
            continue
        try:
            out.append(float(cleaned))
        except ValueError:
            continue
    return tuple(out)


def mentions_amount(text: str, expected: ExpectedAmount) -> bool:
    """True when some number in the text is within tolerance of the expected figure.

    Absolute tolerance, not relative: a half-dollar slack means the same thing on $12 and on
    $12,000, whereas a percentage would silently accept a $60 error on the larger figure.
    """
    return any(abs(n - expected.value) <= expected.tolerance for n in numbers_in(text))


# ── Refusal detection ──────────────────────────────────────────────────────────

REFUSAL_MARKERS: tuple[str, ...] = (
    "don't have", "do not have", "dont have",
    "can't", "cannot", "can not",
    "no data", "not available", "unable to", "not able to",
    "isn't something", "is not something",
    "don't track", "do not track", "not tracked",
    "outside", "no access", "not in", "no information",
    # Added after a live run: a perfectly good refusal ("I'm not able to check the weather...
    # I only have access to your financial data") matched none of the markers above. The list is a
    # heuristic over prose and will need extending again; that is cheaper than an LLM judge here,
    # because a refusal is the one answer shape with a reliable surface form.
    "only have access", "don't support", "do not support", "i'm sorry", "im sorry",
    # Added when a plainly-refusing test sentence matched nothing: "I have no way to know...".
    "no way to", "don't know", "do not know", "couldn't say", "could not say",
)


def looks_like_refusal(text: str) -> bool:
    low = text.lower()
    return any(marker in low for marker in REFUSAL_MARKERS)


# ── Tool-call grading ──────────────────────────────────────────────────────────


def _args_match(expected: ExpectedToolCall, actual: Mapping[str, Any]) -> bool:
    for key, want in expected.args.items():
        if key not in actual:
            return False
        got = actual[key]
        # Numeric equality across int/float, string equality case-insensitively: a model writing
        # "groceries" for a category named "Groceries" routed correctly, and failing it would make
        # the harness measure capitalisation.
        if isinstance(want, str) and isinstance(got, str):
            if want.strip().lower() != got.strip().lower():
                return False
        elif isinstance(want, (int, float)) and isinstance(got, (int, float)):
            if float(want) != float(got):
                return False
        elif want != got:
            return False
    return all(key not in actual for key in expected.forbid_args)


def match_tools(
    expected: Sequence[ExpectedToolCall],
    trace: Sequence[Mapping[str, Any]],
) -> tuple[tuple[str, ...], tuple[int, ...]]:
    """Match expected calls against the trace as an ORDERED SUBSEQUENCE.

    Ordered, because "look up the budget, then the transactions" is a different plan from the
    reverse and sometimes a worse one. A subsequence rather than an exact list, because an extra
    call is reported separately (see `grade`) instead of failing the match outright — whether an
    extra call is a defect depends on the question, and `allow_extra_tools` decides it.

    Returns (failures, matched trace indices).
    """
    failures: list[str] = []
    matched: list[int] = []
    cursor = 0
    for want in expected:
        for i in range(cursor, len(trace)):
            call = trace[i]
            if call.get("name") == want.name and _args_match(want, call.get("input") or {}):
                matched.append(i)
                cursor = i + 1
                break
        else:
            seen = ", ".join(
                f"{c.get('name')}({_brief(c.get('input') or {})})" for c in trace
            ) or "no tools called"
            failures.append(
                f"expected {want.name}({_brief(dict(want.args))}) — trace was: {seen}"
            )
    return tuple(failures), tuple(matched)


def _brief(args: Mapping[str, Any]) -> str:
    return ", ".join(f"{k}={v!r}" for k, v in sorted(args.items()))


# ── Confabulation: a figure attached to the quantity that was refused ──────────

_SENTENCE = re.compile(r"[^.!?\n]+[.!?]?")


def confabulated_figures(
    text: str,
    subjects: Sequence[str],
    allowed: Sequence[float] = (),
) -> tuple[tuple[str, tuple[float, ...]], ...]:
    """Sentences that name a refused subject AND carry a figure.

    The rule this replaces was "a refusal may contain no figures at all", and it was wrong in a way
    the first live runs made obvious: it failed two correct refusals out of three. "I can't predict
    that — your rental income budget is $62,400/year" states a true, tracked figure about a
    DIFFERENT quantity, and the blanket ban caught it exactly as hard as an invented credit score.
    A grader that fails correct answers gets ignored, which costs more than the defect it catches.

    So the fixture names the refused subject and the sentence is the unit: a figure in the same
    sentence as "credit score" is answering the question that was just declined; a figure elsewhere
    in the reply is context. This is a heuristic over prose and it will have edge cases — it is
    still strictly sharper than counting digits, and every case it decides is visible in the fixture
    rather than buried in the grader.

    A subject that is itself numeric ("2030") contributes its own value to the allowed set, so
    naming the year while refusing to predict it is not read as predicting it.
    """
    auto_allowed = list(allowed)
    for subject in subjects:
        auto_allowed.extend(numbers_in(subject))

    findings: list[tuple[str, tuple[float, ...]]] = []
    for raw in _SENTENCE.findall(text):
        sentence = raw.strip()
        if not sentence:
            continue
        low = sentence.lower()
        if not any(subject.lower() in low for subject in subjects):
            continue
        figures = tuple(
            n for n in numbers_in(sentence)
            if abs(n) >= 1 and not any(abs(n - a) <= 0.001 for a in auto_allowed)
        )
        if figures:
            findings.append((sentence, figures))
    return tuple(findings)


# ── The verdict for one run ────────────────────────────────────────────────────


@dataclass(frozen=True)
class Grade:
    tools_ok: bool
    answer_ok: bool
    tool_failures: tuple[str, ...] = ()
    answer_failures: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.tools_ok and self.answer_ok


def grade(question: GoldenQuestion, reply: str, trace: Sequence[Mapping[str, Any]]) -> Grade:
    tool_failures, matched = match_tools(question.expect_tools, trace)

    if question.max_tools is not None and len(trace) > question.max_tools:
        called = ", ".join(str(c.get("name")) for c in trace)
        tool_failures = tool_failures + (
            f"called {len(trace)} tool(s) but at most {question.max_tools} allowed: {called}",
        )

    if not question.allow_extra_tools:
        extra = [c for i, c in enumerate(trace) if i not in set(matched)]
        if extra:
            tool_failures = tool_failures + (
                "unexpected extra tool calls: "
                + ", ".join(f"{c.get('name')}({_brief(c.get('input') or {})})" for c in extra),
            )

    answer_failures: list[str] = []
    low = reply.lower()

    for amount in question.expect_amounts:
        if not mentions_amount(reply, amount):
            label = f" ({amount.label})" if amount.label else ""
            answer_failures.append(
                f"reply does not contain {amount.value:,.2f}{label} "
                f"(±{amount.tolerance}); numbers present: {numbers_in(reply)}"
            )

    for phrase in question.expect_phrases:
        if phrase.lower() not in low:
            answer_failures.append(f"reply is missing the phrase {phrase!r}")

    for phrase in question.forbid_phrases:
        if phrase.lower() in low:
            answer_failures.append(f"reply contains the forbidden phrase {phrase!r}")

    if question.kind == "refusal":
        if not looks_like_refusal(reply):
            answer_failures.append(
                "reply does not read as a refusal — no marker from REFUSAL_MARKERS is present"
            )
        for sentence, figures in confabulated_figures(
            reply, question.forbid_figures_near, question.allow_numbers
        ):
            answer_failures.append(
                f"refusal states {figures} for the quantity it just declined: {sentence!r}"
            )

    return Grade(
        tools_ok=not tool_failures,
        answer_ok=not answer_failures,
        tool_failures=tuple(tool_failures),
        answer_failures=tuple(answer_failures),
    )


# ── Majority vote across repeats ───────────────────────────────────────────────


def majority(outcomes: Iterable[bool]) -> bool:
    """Strictly more than half. A 1-of-2 split is a failure, not a pass.

    The whole reason repeats exist is that one flaky sample is noise. Requiring every sample to
    pass would make the suite red on nondeterminism and it would be ignored within a week; taking
    any sample as enough would hide a regression that only fires half the time.
    """
    votes = list(outcomes)
    if not votes:
        return False
    return sum(1 for v in votes if v) * 2 > len(votes)
