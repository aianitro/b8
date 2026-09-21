"""The golden set: questions whose answers are known before the agent is asked.

The expected figures are constants, derived once by SQL against a frozen seed database and
checked in. They are deliberately NOT computed at run time by calling the same code the agent
calls — a bug in a shared query would then move both sides together and the test would pass.
See `golden/README.md` for the derivation commands.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence

Kind = Literal["tool_use", "refusal"]

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "golden"


@dataclass(frozen=True)
class ExpectedToolCall:
    """One tool call the agent is expected to make.

    `args` is a SUBSET match: the listed keys must be present and equal, and keys the fixture does
    not mention are ignored. Asserting the whole argument object would make every fixture fail the
    day a new optional parameter is added to a tool, which is a schema change, not a regression.

    `forbid_args` is the negative control for that leniency — keys that must NOT appear. Without
    it, "called with no date filter" is unassertable, and an agent that silently starts filtering
    to a narrower range would pass on a total that happens to match.
    """

    name: str
    args: Mapping[str, Any] = field(default_factory=dict)
    forbid_args: Sequence[str] = ()


@dataclass(frozen=True)
class ExpectedAmount:
    """A figure that must appear in the reply.

    Matched numerically, not as a substring: the model may render 1040.4 as "$1,040.40", "$1,040",
    or "1040.4", and all three are the same correct answer. `tolerance` defaults to half a dollar
    so rounding to whole dollars passes and a genuinely different figure does not.
    """

    value: float
    tolerance: float = 0.5
    label: str = ""


@dataclass(frozen=True)
class GoldenQuestion:
    id: str
    question: str
    kind: Kind = "tool_use"
    expect_tools: Sequence[ExpectedToolCall] = ()
    expect_amounts: Sequence[ExpectedAmount] = ()
    expect_phrases: Sequence[str] = ()
    forbid_phrases: Sequence[str] = ()
    # Refusal questions set this to 0: the point of "what is my credit score" is that no tool in
    # the app can answer it, so reaching for one is itself the defect.
    max_tools: int | None = None
    allow_extra_tools: bool = True
    # Numbers a refusal is allowed to contain. "What will my rent be in 2030" is refused by saying
    # so, and saying so repeats the year — without this the confabulation check would fail every
    # refusal whose question contains a figure, which is most of the interesting ones.
    allow_numbers: Sequence[float] = ()
    # Refusal only: phrases naming the quantity being refused. A figure in the SAME SENTENCE as
    # one of these is the confabulation; a figure elsewhere in the reply is context.
    forbid_figures_near: Sequence[str] = ()
    # Tools that must NOT appear in the trace at all. The write-tool case: an injection ordering
    # the agent to categorize something must never reach categorize_transaction, and "it produced
    # no proposal" is a weaker claim than "it never called the tool" — the first could be luck.
    forbid_tools: Sequence[str] = ()
    note: str = ""

    def __post_init__(self) -> None:
        if self.kind == "refusal" and not self.forbid_figures_near:
            raise ValueError(
                f"{self.id}: a refusal question must name forbid_figures_near — without it the "
                "confabulation check has nothing to look for and the case passes vacuously"
            )
        if self.kind == "refusal" and self.expect_amounts:
            raise ValueError(
                f"{self.id}: a refusal question must not expect a figure — the whole assertion "
                "is that no figure is produced"
            )
        if not self.question.strip():
            raise ValueError(f"{self.id}: empty question")


def _tool(raw: Mapping[str, Any]) -> ExpectedToolCall:
    return ExpectedToolCall(
        name=raw["name"],
        args=raw.get("args", {}),
        forbid_args=tuple(raw.get("forbid_args", ())),
    )


def _amount(raw: Mapping[str, Any] | float | int) -> ExpectedAmount:
    if isinstance(raw, (int, float)):
        return ExpectedAmount(value=float(raw))
    return ExpectedAmount(
        value=float(raw["value"]),
        tolerance=float(raw.get("tolerance", 0.5)),
        label=raw.get("label", ""),
    )


def parse_question(raw: Mapping[str, Any]) -> GoldenQuestion:
    return GoldenQuestion(
        id=raw["id"],
        question=raw["question"],
        kind=raw.get("kind", "tool_use"),
        expect_tools=tuple(_tool(t) for t in raw.get("expect_tools", ())),
        expect_amounts=tuple(_amount(a) for a in raw.get("expect_amounts", ())),
        expect_phrases=tuple(raw.get("expect_phrases", ())),
        forbid_phrases=tuple(raw.get("forbid_phrases", ())),
        max_tools=raw.get("max_tools"),
        allow_numbers=tuple(float(n) for n in raw.get("allow_numbers", ())),
        forbid_figures_near=tuple(raw.get("forbid_figures_near", ())),
        forbid_tools=tuple(raw.get("forbid_tools", ())),
        allow_extra_tools=raw.get("allow_extra_tools", True),
        note=raw.get("note", ""),
    )


def load_questions(path: Path | None = None) -> tuple[GoldenQuestion, ...]:
    path = path or (GOLDEN_DIR / "questions.json")
    raw = json.loads(path.read_text())
    questions = tuple(parse_question(q) for q in raw["questions"])

    seen: set[str] = set()
    for q in questions:
        if q.id in seen:
            raise ValueError(f"duplicate question id: {q.id}")
        seen.add(q.id)
    return questions
