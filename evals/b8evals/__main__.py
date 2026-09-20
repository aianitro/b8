"""CLI: `python -m b8evals run` / `estimate` / `list`."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .client import ChatClient, ChatError
from .fixtures import load_questions
from .report import to_json, to_text
from .runner import DAILY_CEILING, planned_requests, run_suite


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="b8evals", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--questions", type=Path, default=None, help="path to questions.json")
        p.add_argument("--filter", default=None, help="only questions whose id contains this")
        p.add_argument("--repeats", type=int, default=3, help="samples per question (default 3)")

    run = sub.add_parser("run", help="ask the agent every golden question and grade the answers")
    common(run)
    run.add_argument("--base-url", default=None, help="e.g. https://<machine>.tail368cae.ts.net")
    run.add_argument("--token-env", default="B8_EVAL_TOKEN")
    run.add_argument("--json", type=Path, default=None, help="also write a JSON report here")
    run.add_argument("--quiet", action="store_true")

    estimate = sub.add_parser("estimate", help="what a run would cost, before spending it")
    common(estimate)

    listing = sub.add_parser("list", help="show the golden set")
    common(listing)

    args = parser.parse_args(argv)

    try:
        questions = load_questions(args.questions)
    except (OSError, ValueError) as exc:
        print(f"Could not load the golden set: {exc}", file=sys.stderr)
        return 2

    if args.filter:
        questions = tuple(q for q in questions if args.filter in q.id)
        if not questions:
            print(f"No question id contains {args.filter!r}", file=sys.stderr)
            return 2

    if args.command == "list":
        for q in questions:
            tools = ", ".join(t.name for t in q.expect_tools) or "(none — refusal)"
            print(f"  {q.id:<28} {q.kind:<9} {tools}")
            print(f"      {q.question}")
        print(f"\n  {len(questions)} questions")
        return 0

    if args.command == "estimate":
        planned = planned_requests(questions, args.repeats)
        print(
            f"\n  {len(questions)} questions x {args.repeats} repeats = {planned} requests\n"
            f"  the app's daily ceiling is {DAILY_CEILING}"
            f" ({planned / DAILY_CEILING:.0%} of it)\n"
            f"  each request may make up to 5 model calls\n"
        )
        return 0 if planned <= DAILY_CEILING else 1

    try:
        client = ChatClient.from_env(base_url=args.base_url, token_env=args.token_env)
    except ChatError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 2

    emit = (lambda _m: None) if args.quiet else (lambda m: print(m, flush=True))
    if not args.quiet:
        print(f"\nAsking {len(questions)} questions x {args.repeats} at {client.base_url}\n")

    try:
        report = run_suite(client, questions, repeats=args.repeats, on_event=emit)
    except RuntimeError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 2

    print(to_text(report, color=sys.stdout.isatty()))
    if args.json:
        args.json.write_text(to_json(report))
        print(f"  JSON report: {args.json}\n")

    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
