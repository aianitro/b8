#!/usr/bin/env node
// scope-guard — PreToolUse hook enforcing BUILD.md I2 (single-writer contracts).
//
// A `tools:` allowlist in an agent definition grants TOOLS, not PATHS. `tools: Read, Edit`
// lets contract-guardian edit *any* file in the repo; "contract surface only" is a prompt
// instruction, and prompt instructions are not enforcement. Nothing in the tool grant stops
// the implementer from editing `migrations/` or `shared/types.ts` either. This hook closes
// both holes at the filesystem level.
//
// Rules (BUILD.md §13.2):
//
//   1. Generated files          Never hand-edited by anyone. Produced by npm/next.
//                               (.next/**, next-env.d.ts, tsconfig.tsbuildinfo,
//                                package-lock.json, node_modules/**)
//   2. Contract surface         Writable only while a contract lease is open — the G1 window.
//                               (shared/types.ts, shared/contracts/**, migrations/**,
//                                db/schema.sql)
//   3. Committed migrations     Immutable, lease or no lease. A migration that is tracked in
//                               git may already have been applied somewhere; editing it makes
//                               `migrate:up` on a fresh database produce a different schema
//                               than the one running here. Add a new migration instead.
//   4. plan/tasks/<id>/SPEC.md  Immutable once the task is frozen at G0.
//
// Why a lease instead of agent identity: the PreToolUse payload carries no stable subagent
// identifier, so "is the caller contract-guardian?" is not a question this hook can answer
// reliably. The orchestrator opens a lease immediately before dispatching the guardian and
// closes it when G1 passes (`.claude/bin/lease open|close`). The lease is therefore not a
// workaround — it *is* the contract-freeze protocol from BUILD.md §6, made mechanical:
// the contract surface is writable exactly during the guardian's window and frozen at every
// other moment. It is also auditable, because it leaves a file.
//
// Bash is matched too. The implementer holds Bash, so `sed -i`, `>`, `tee`, `cp` and friends
// are a live bypass of any Edit/Write-only rule.
//
// Failure posture: fail OPEN when the target cannot be determined (malformed payload, no path
// field, unparseable command) — a hook that blocks on parse errors bricks the session for
// everyone. Fail CLOSED only on a positively identified violation. Every rule denies a
// specific known-bad path; none denies "everything it did not understand".
//
// Exit codes: 0 = allow, 2 = block (stderr is fed back to the calling agent).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOW = 0;
const BLOCK = 2;

const LEASE = '.claude/.contract-lease';

// Build output and package-manager output. Hand-editing any of these produces a file that
// the next `npm ci` or `next build` silently reverts — a change that appears to work and
// then evaporates.
const GENERATED_PREFIXES = ['.next/', 'node_modules/'];
const GENERATED_FILES = [
  'next-env.d.ts',
  'tsconfig.tsbuildinfo',
  'package-lock.json',
];

// The contract surface: the type shapes and the database schema that every route, component,
// and query in the app agrees on. Single-writer per BUILD.md I2.
const CONTRACT_PREFIXES = ['shared/contracts/', 'migrations/'];
const CONTRACT_FILES = ['shared/types.ts', 'db/schema.sql'];

// The blessed producers of the generated set. Recognised so the hook does not block the very
// commands that are supposed to write there.
const SANCTIONED_GENERATORS = [
  /\bnpm\s+(?:ci|install|i|update|dedupe|prune|audit)\b/,
  /\bnpm\s+run\s+build\b/,
  /\bnext\s+(?:dev|build|start)\b/,
  /\bnpx\s+next\s+(?:dev|build|start)\b/,
];

// Bash constructs that can write to a file, BOUND TO THE TARGET PATH.
//
// The naive version of this ("command mentions a protected path" AND "command contains a
// redirect anywhere") is far too coarse: a read-only `grep -r foo migrations/` in a command
// that also had an unrelated `2>/dev/null` would be blocked. Mutation must be tied to the
// path it targets, not merely co-present on the same command line. `{p}` is the escaped
// path, so a match means the path is the *object* of a write.
const MUTATION_TEMPLATES = [
  String.raw`>>?\s*['"]?{p}`,                                  // echo x > path / >> path
  String.raw`\btee\b[^;&|]*{p}`,                               // ... | tee path
  String.raw`\bsed\b[^;&|]*-i[^;&|]*{p}`,                      // sed -i ... path
  String.raw`\b(?:cp|mv|truncate|dd|patch|install)\b[^;&|]*{p}`,
  String.raw`\bgit\s+(?:checkout|restore|apply|mv|rm)\b[^;&|]*{p}`,
  String.raw`\b(?:mkdir|touch)\b[^;&|]*{p}`,                   // creating under a protected tree
];

// Deletion is destructive on the contract surface and harmless on generated output, so it is not
// in the shared list. `rm migrations/0001.sql` loses schema history that exists nowhere else;
// `rm -rf .next` is the documented remedy for a stale build cache and regenerates on the next
// run. A guard that blocks the standard fix for a broken build teaches people to bypass the
// guard, which costs more than the rule was ever worth.
const DELETION_TEMPLATES = [String.raw`\b(?:rm|rmdir|unlink)\b[^;&|]*{p}`];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes heredoc bodies before analysis.
 *
 * A heredoc body is DATA, not a command. Without this, writing a document that merely mentions
 * `rm -rf .next` — this repo's own BUILD.md and gate logs do — is read as an attempt to delete
 * build output, and blocked. That is the false-positive shape amendment A3 was written about, and
 * it reappeared here the first time the orchestrator wrote a gate log.
 *
 * The redirect that OPENS a heredoc (`cat > shared/types.ts <<'EOF'`) sits before the operator and
 * survives stripping, so the write itself is still caught — only the payload stops being scanned.
 * An unterminated heredoc is stripped to end-of-input rather than left intact: leaving it would
 * restore exactly the false positive this removes.
 *
 * Not airtight, deliberately: `bash <<EOF` with a mutation inside the body evades this. The hook
 * cannot identify its caller (that is why the lease exists) and has never been a sandbox — it is a
 * guardrail against accident and habit. What it must never do is block honest work.
 */
function stripHeredocs(command) {
  // `$(?![\s\S])` is end-of-INPUT, not end-of-line. Under the /m flag a bare `$` matches at every
  // newline, so with a lazy body the match ended at the heredoc's first line and left the rest
  // exposed — a fix that worked only on single-line documents. Caught by the multi-line cases in
  // the regression suite, which is precisely why §13.2 requires them.
  return command.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?(?:^[ \t]*\2[ \t]*$|$(?![\s\S]))/gm,
    '<<HEREDOC'
  );
}

/** True only if `command` writes to something under `protectedPath`. */
function mutates(command, protectedPath, { includeDeletion = true } = {}) {
  const p = escapeRe(protectedPath.replace(/\/$/, ''));
  const templates = includeDeletion
    ? [...MUTATION_TEMPLATES, ...DELETION_TEMPLATES]
    : MUTATION_TEMPLATES;
  return templates.some((t) => new RegExp(t.replace('{p}', p)).test(command));
}

function repoRoot(payload) {
  for (const c of [payload.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()]) {
    if (c) return path.resolve(c);
  }
  return path.resolve('.');
}

/** Repo-relative POSIX path, or null if the path escapes the repo. */
function relative(pathStr, root) {
  if (!pathStr) return null;
  const abs = path.resolve(root, pathStr);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** Task id currently holding the contract lease, or null if closed. */
function leaseHolder(root) {
  const f = path.join(root, LEASE);
  if (!existsSync(f)) return null;
  const body = readFileSync(f, 'utf8').trim();
  return body ? body.split('\n')[0] : 'unknown';
}

/** A migration already committed to git may already have been applied. */
function isTrackedInGit(rel, root) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false; // untracked, or no git — fail open, the lease rule still applies
  }
}

/** plan/tasks/<id>/SPEC.md is frozen once plan/tasks/<id>/.frozen exists. */
function specIsFrozen(rel, root) {
  const m = /^(plan\/tasks\/[^/]+)\/SPEC\.md$/.exec(rel);
  return Boolean(m) && existsSync(path.join(root, m[1], '.frozen'));
}

function deny(msg) {
  process.stderr.write(msg.trim() + '\n');
  process.exit(BLOCK);
}

const isGenerated = (rel) =>
  GENERATED_PREFIXES.some((p) => rel.startsWith(p)) || GENERATED_FILES.includes(rel);

const isContract = (rel) =>
  CONTRACT_PREFIXES.some((p) => rel.startsWith(p)) || CONTRACT_FILES.includes(rel);

const LEASE_CLOSED_MESSAGE = `The contract surface has a single writer: contract-guardian, and only while a contract
lease is open (BUILD.md I2, §6 contract freeze).

If you are the implementer and believe a type or a column is wrong: STOP and report it
upward. Do not work around it locally — a local widened type or a second copy of a shared
shape is how this codebase ended up computing "latest valuation" in two places, and it is
the same class of defect as a dashboard showing four different totals for one number.

Orchestrator: open the G1 window with \`.claude/bin/lease open <task-id>\`.`;

/** Apply the four path rules. Returns normally to allow. */
function checkPath(rel, root) {
  if (isGenerated(rel)) {
    deny(
      `BLOCKED by scope-guard: ${rel}\n` +
        'This file is build or package-manager output and is never hand-edited (BUILD.md §2).\n' +
        'It is regenerated by `npm ci` / `next build`, so a hand edit is a change that appears\n' +
        'to work and then silently evaporates on the next install or build.'
    );
  }

  if (rel.startsWith('migrations/') && isTrackedInGit(rel, root)) {
    deny(
      `BLOCKED by scope-guard: ${rel}\n` +
        'This migration is committed, which means it may already have been applied — to the dev\n' +
        'database, to CI, or to the host. Editing it makes `npm run migrate:up` on a fresh\n' +
        'database produce a different schema than the one actually running (BUILD.md §9.3).\n' +
        'Write a NEW migration that alters the schema forward. `npm run migrate:create <name>`.'
    );
  }

  if (isContract(rel) && leaseHolder(root) === null) {
    deny(`BLOCKED by scope-guard: ${rel}\n${LEASE_CLOSED_MESSAGE}`);
  }

  if (specIsFrozen(rel, root)) {
    deny(
      `BLOCKED by scope-guard: ${rel}\n` +
        'This spec is frozen at G0 (BUILD.md §6). Acceptance criteria may not be edited to fit\n' +
        'an implementation — that inverts the contract-first invariant.\n' +
        'If the spec is genuinely wrong, the task returns to spec-writer and restarts at G0.'
    );
  }
}

/** Bash can write to protected paths without ever touching Edit/Write. */
function checkBash(rawCommand, root) {
  // Heredoc bodies are payload, not instructions. Everything below inspects the command proper.
  const command = stripHeredocs(rawCommand);

  if (SANCTIONED_GENERATORS.some((re) => re.test(command))) return;

  for (const target of [...GENERATED_PREFIXES, ...GENERATED_FILES]) {
    // includeDeletion: false — removing build output is safe and regenerates. The rule here is
    // "never hand-EDIT generated files", not "never delete them".
    if (mutates(command, target, { includeDeletion: false })) {
      deny(
        'BLOCKED by scope-guard: shell write to generated output\n' +
          `  ${command.trim().slice(0, 200)}\n` +
          'These files come from `npm ci` / `next build`. Never write them directly.\n' +
          '(Deleting them is fine — they regenerate.)'
      );
    }
  }

  if (leaseHolder(root) !== null) return; // G1 window open — the guardian may write

  for (const target of [...CONTRACT_PREFIXES, ...CONTRACT_FILES]) {
    if (mutates(command, target)) {
      deny(
        'BLOCKED by scope-guard: shell write to the contract surface\n' +
          `  ${command.trim().slice(0, 200)}\n` +
          LEASE_CLOSED_MESSAGE
      );
    }
  }

  // `npm run migrate:create` writes a new file into migrations/ without any redirect the
  // templates above would catch.
  if (/\bnpm\s+run\s+migrate:create\b/.test(command) || /\bnode-pg-migrate\s+create\b/.test(command)) {
    deny(
      'BLOCKED by scope-guard: creating a migration outside the G1 window\n' +
        `  ${command.trim().slice(0, 200)}\n` +
        LEASE_CLOSED_MESSAGE
    );
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return ALLOW; // cannot determine a target — fail open
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ALLOW;

  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return ALLOW;

  const root = repoRoot(payload);

  if (payload.tool_name === 'Bash') {
    checkBash(String(toolInput.command ?? ''), root);
    return ALLOW;
  }

  const raw = toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path ?? '';
  const rel = relative(String(raw), root);
  if (rel === null) return ALLOW; // unresolvable or outside the repo

  checkPath(rel, root);
  return ALLOW;
}

process.exit(main());
