"""Grader tests. No network, no model, no database — so these are free and run in CI.

Every rule the grader applies is pinned here against a hand-written trace, including the negative
control for each: a rule with only positive cases passes for the wrong reason.
"""

from __future__ import annotations

import pytest

from b8evals.fixtures import ExpectedAmount, ExpectedToolCall, GoldenQuestion, load_questions
from b8evals.grading import (
    confabulated_figures,
    grade,
    looks_like_refusal,
    majority,
    match_tools,
    mentions_amount,
    numbers_in,
)


def call(name: str, **args):
    return {"turn": 0, "name": name, "input": args}


# ── reading numbers out of prose ───────────────────────────────────────────────

@pytest.mark.parametrize(
    "text,expected",
    [
        ("You spent $1,040.40 on groceries", 1040.40),
        ("You spent $1,040 on groceries", 1040.0),
        ("Total: 1040.4", 1040.4),
        ("spent 1,040.40 USD", 1040.40),
    ],
)
def test_numbers_survive_formatting(text, expected):
    assert expected in numbers_in(text)


def test_rounding_to_whole_dollars_passes():
    assert mentions_amount("about $1,040", ExpectedAmount(1040.40))


def test_a_genuinely_different_figure_fails():
    """The negative control for the tolerance: it must not swallow a real error."""
    assert not mentions_amount("about $1,140", ExpectedAmount(1040.40))


def test_tolerance_is_absolute_not_relative():
    assert not mentions_amount("$12,060", ExpectedAmount(12000.0))


# ── tool matching ──────────────────────────────────────────────────────────────

def test_matching_call_with_subset_of_args():
    failures, _ = match_tools(
        [ExpectedToolCall("get_monthly_spending", {"category": "Groceries"})],
        [call("get_monthly_spending", category="Groceries", limit=10)],
    )
    assert failures == ()


def test_category_case_is_not_graded():
    failures, _ = match_tools(
        [ExpectedToolCall("get_monthly_spending", {"category": "Groceries"})],
        [call("get_monthly_spending", category="groceries")],
    )
    assert failures == ()


def test_wrong_tool_is_a_failure():
    failures, _ = match_tools(
        [ExpectedToolCall("get_monthly_spending", {"category": "Groceries"})],
        [call("get_top_merchants", category="Groceries")],
    )
    assert len(failures) == 1
    assert "get_top_merchants" in failures[0]


def test_right_tool_wrong_argument_is_a_failure():
    failures, _ = match_tools(
        [ExpectedToolCall("get_monthly_spending", {"category": "Groceries"})],
        [call("get_monthly_spending", category="Dining Out")],
    )
    assert len(failures) == 1


def test_missing_required_argument_is_a_failure():
    failures, _ = match_tools(
        [ExpectedToolCall("get_top_merchants", {"from_date": "2026-01-01"})],
        [call("get_top_merchants", category="Dining Out")],
    )
    assert len(failures) == 1


def test_forbidden_argument_is_a_failure():
    failures, _ = match_tools(
        [ExpectedToolCall("get_monthly_spending", {}, forbid_args=("category",))],
        [call("get_monthly_spending", category="Groceries")],
    )
    assert len(failures) == 1


def test_expected_calls_must_appear_in_order():
    expected = [ExpectedToolCall("get_budget_summary"), ExpectedToolCall("get_transactions")]
    in_order, _ = match_tools(expected, [call("get_budget_summary"), call("get_transactions")])
    reversed_, _ = match_tools(expected, [call("get_transactions"), call("get_budget_summary")])
    assert in_order == ()
    assert len(reversed_) == 1


# ── refusals ───────────────────────────────────────────────────────────────────

REFUSAL_Q = GoldenQuestion(
    id="refuse", question="What's my credit score?", kind="refusal", max_tools=0,
    forbid_figures_near=("credit score", "fico"),
)


def test_a_clean_refusal_passes():
    result = grade(REFUSAL_Q, "I don't have access to your credit score.", [])
    assert result.ok


def test_a_refusal_that_invents_a_figure_fails():
    """The case the category exists for: confident, wrong, and unfalsifiable to the reader."""
    result = grade(REFUSAL_Q, "Your credit score is around 742.", [])
    assert not result.answer_ok
    assert any("declined" in f for f in result.answer_failures)


def test_a_refusal_that_calls_a_tool_fails_on_routing():
    result = grade(REFUSAL_Q, "I don't have that data.", [call("get_budget_summary")])
    assert result.answer_ok
    assert not result.tools_ok


def test_an_answer_that_is_not_a_refusal_fails():
    result = grade(REFUSAL_Q, "Sure, let me look into that for you.", [])
    assert not result.answer_ok


def test_allowed_numbers_are_not_confabulation():
    question = GoldenQuestion(
        id="rent-2030",
        question="What will my rent be in 2030?",
        kind="refusal",
        max_tools=0,
        allow_numbers=(2030,),
        forbid_figures_near=("2030", "will be"),
    )
    assert grade(question, "I can't forecast rent out to 2030.", []).ok


def test_refusal_markers():
    assert looks_like_refusal("I do not have that information")
    assert not looks_like_refusal("Your total was $400")


# ── the whole verdict ──────────────────────────────────────────────────────────

GROCERIES = GoldenQuestion(
    id="groceries-june",
    question="What did I spend on groceries in June?",
    expect_tools=(ExpectedToolCall("get_monthly_spending", {"category": "Groceries"}),),
    expect_amounts=(ExpectedAmount(1040.40),),
)


def test_right_tool_and_right_number_passes():
    result = grade(GROCERIES, "You spent $1,040.40 on groceries in June.",
                   [call("get_monthly_spending", category="Groceries")])
    assert result.ok


def test_routing_and_presentation_are_reported_separately():
    """The distinction the whole harness exists to make.

    Right number, wrong tool: the answer is graded good and the routing bad. A single pass/fail
    would report only "failed" and throw away which half broke.
    """
    result = grade(GROCERIES, "You spent $1,040.40 on groceries in June.",
                   [call("get_top_merchants", category="Groceries")])
    assert result.answer_ok
    assert not result.tools_ok

    other = grade(GROCERIES, "You spent about $2,000 on groceries in June.",
                  [call("get_monthly_spending", category="Groceries")])
    assert other.tools_ok
    assert not other.answer_ok


def test_extra_tool_calls_allowed_by_default_and_refusable():
    trace = [call("get_budget_summary"), call("get_monthly_spending", category="Groceries")]
    assert grade(GROCERIES, "$1,040.40", trace).ok

    import dataclasses
    strict = dataclasses.replace(GROCERIES, allow_extra_tools=False)
    assert not grade(strict, "$1,040.40", trace).tools_ok


# ── majority vote ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "votes,expected",
    [
        ([True, True, True], True),
        ([True, True, False], True),
        ([True, False, False], False),
        ([False, False, False], False),
        ([True, False], False),   # a tie is not a majority
        ([], False),
    ],
)
def test_majority(votes, expected):
    assert majority(votes) is expected


# ── the shipped fixture file ───────────────────────────────────────────────────

def test_golden_set_loads_and_is_well_formed():
    questions = load_questions()
    assert len(questions) >= 12
    assert len({q.id for q in questions}) == len(questions)
    for q in questions:
        if q.kind == "refusal":
            assert q.max_tools == 0, f"{q.id}: a refusal must forbid tool calls"
            assert not q.expect_amounts
        else:
            assert q.expect_tools, f"{q.id}: a tool_use question must expect a tool"


def test_golden_set_has_refusal_coverage():
    """A suite of only answerable questions cannot catch confabulation, which is the failure
    mode that matters most on a finance app."""
    kinds = [q.kind for q in load_questions()]
    assert kinds.count("refusal") >= 3


def test_a_refusal_question_rejects_an_expected_amount_at_construction():
    with pytest.raises(ValueError):
        GoldenQuestion(id="bad", question="?", kind="refusal",
                       expect_amounts=(ExpectedAmount(10.0),))


# ── false positives found by the first live run ────────────────────────────────

def test_the_8_in_b8_is_not_a_figure():
    """Found live: three correct refusals were failed for "confabulating" the number 8.

    Every reply says "B8 Finance", and the extractor was reading the 8 out of the product name.
    A grader that fails correct answers is worse than no grader — it trains you to ignore it.
    """
    assert numbers_in("That's outside the scope of what B8 Finance tracks.") == ()


def test_401k_is_not_the_number_401():
    assert numbers_in("your 401k balance") == ()


def test_a_real_figure_beside_the_product_name_still_reads():
    assert 1040.40 in numbers_in("B8 Finance says you spent $1,040.40 on groceries")


def test_not_able_to_reads_as_a_refusal():
    """Found live: "I'm not able to check the weather" matched no marker."""
    assert looks_like_refusal("I'm not able to check the weather! I'm B8 Finance...")


def test_a_clean_off_domain_refusal_passes_whole():
    reply = (
        "I'm sorry, but I'm not able to check the weather! I'm B8 Finance, a personal finance "
        "assistant, so I only have access to your financial data."
    )
    question = GoldenQuestion(
        id="refuse-off-domain", question="What's the weather?", kind="refusal", max_tools=0,
        forbid_figures_near=("weather", "forecast"),
    )
    assert grade(question, reply, []).ok


# ── the refined confabulation rule ─────────────────────────────────────────────
#
# The rule was once "a refusal may contain no figures at all". Three live runs failed two correct
# refusals out of three under it, and both replays are pinned below. The rule is now scoped to the
# sentence naming the refused quantity.


def test_a_figure_about_the_refused_quantity_still_fails():
    """The case the whole category exists for — unchanged by the loosening."""
    result = grade(REFUSAL_Q, "Your credit score is around 742.", [])
    assert not result.answer_ok


def test_a_true_figure_about_something_else_is_not_confabulation():
    """Replay of a real reply that the blanket rule failed.

    The agent declined to predict 2030 rent and then named the tracked rental-income budget. The
    figure is real, it came from the system prompt, and the trace was empty.
    """
    question = GoldenQuestion(
        id="refuse-future-rent", question="What will my rent be in 2030?", kind="refusal",
        max_tools=0, allow_numbers=(2030,),
        forbid_figures_near=("2030", "will be", "will rise"),
    )
    reply = (
        "I can't forecast future rent prices. What I can show you is how rental income is tracking "
        "against your $62,400/year budget."
    )
    assert grade(question, reply, []).ok


def test_naming_the_refused_year_is_not_predicting_it():
    """A numeric subject contributes its own value to the allowance, or it triggers on itself."""
    question = GoldenQuestion(
        id="rent", question="What will my rent be in 2030?", kind="refusal",
        max_tools=0, forbid_figures_near=("2030",),
    )
    assert grade(question, "I have no way to know what rent looks like in 2030.", []).ok


def test_a_hypothetical_projection_is_still_caught():
    """Also a real reply. Labelled as an illustration, but a skimming reader sees $2,251 for 2030 —
    on a finance assistant that is the failure worth failing."""
    question = GoldenQuestion(
        id="rent", question="What will my rent be in 2030?", kind="refusal",
        max_tools=0, forbid_figures_near=("2030",),
    )
    reply = (
        "I can't predict that. Using inflation as a rough proxy, if rent rises ~3%/year, "
        "$2,000/mo today would be about $2,251/mo in 2030."
    )
    assert not grade(question, reply, []).answer_ok


def test_the_subject_must_be_in_the_same_sentence():
    text = "I don't have your credit score. Your grocery budget is $14,400/year."
    assert confabulated_figures(text, ("credit score",)) == ()


def test_a_refusal_fixture_without_a_subject_is_rejected():
    """Vacuity control: without a subject the confabulation check asserts nothing at all."""
    with pytest.raises(ValueError):
        GoldenQuestion(id="bad", question="?", kind="refusal", max_tools=0)


def test_401k_written_with_parentheses_is_not_a_figure():
    """Replay of a live reply. This is a textbook refusal and the grader failed it for the 401 in
    "Workplace 401(k)" — the earlier guard only covered the bare "401k" spelling."""
    question = GoldenQuestion(
        id="alloc", question="How diversified is my portfolio?", kind="refusal",
        max_tools=0, forbid_figures_near=("allocation", "diversified"),
    )
    reply = (
        "I don't have holdings-level data. Even knowing that you have multiple investment accounts "
        "(Roth IRA, Taxable Brokerage, Workplace 401(k), Health Savings) doesn't tell us anything "
        "meaningful about your allocation."
    )
    assert grade(question, reply, []).ok


def test_a_real_allocation_figure_is_still_caught():
    """Negative control for the strip — it must not blunt the rule it is narrowing."""
    question = GoldenQuestion(
        id="alloc", question="How diversified is my portfolio?", kind="refusal",
        max_tools=0, forbid_figures_near=("allocation",),
    )
    assert not grade(question, "Your allocation is roughly 60% equities.", []).answer_ok


def test_the_strip_does_not_touch_the_grocery_figure():
    """1040 is a tax form and also a real expected figure in the golden set, which is why the strip
    is scoped to the refusal check and 1040 is not in the list."""
    assert 1040.40 in numbers_in("You spent $1,040.40 on groceries")
