"""b8evals — a golden-question eval harness for the b8 finance chat agent.

ROADMAP.md §5 step 14. The agent at `/api/v1/chat` picks a tool, calls it, and writes prose around
the result; none of that was covered by a test. This package asks it a fixed set of questions whose
answers are known in advance, and grades the tool call separately from the answer.
"""

from .client import ChatClient, ChatRun
from .fixtures import GoldenQuestion, load_questions
from .grading import Grade, grade, majority
from .runner import Report, QuestionResult, run_suite

__all__ = [
    "ChatClient", "ChatRun",
    "GoldenQuestion", "load_questions",
    "Grade", "grade", "majority",
    "Report", "QuestionResult", "run_suite",
]
