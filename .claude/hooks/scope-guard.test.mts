// Tests for the scope-guard PreToolUse hook (BUILD.md §13.2).
//
// BUILD.md amendment A3 — inherited from the project this build system was adapted from —
// requires every hook change to carry BOTH a true-positive and a false-positive case. The
// escape that produced that rule was a guard whose 26 tests were all single-purpose: none
// combined a protected path with unrelated shell plumbing, so a `2>/dev/null` on a read-only
// command was enough to block the orchestrator's own gate commands. The `allows` blocks
// below are not padding; they are the half of the specification that regressed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = fileURLToPath(new URL('./scope-guard.mjs', import.meta.url));

let root: string;

/** Run the hook against a payload; returns its exit code (0 allow, 2 block). */
function run(payload: Record<string, unknown>): number {
  try {
    execFileSync('node', [HOOK], {
      input: JSON.stringify({ cwd: root, ...payload }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

const edit = (file_path: string) => run({ tool_name: 'Edit', tool_input: { file_path } });
const bash = (command: string) => run({ tool_name: 'Bash', tool_input: { command } });

const openLease = () => writeFileSync(path.join(root, '.claude/.contract-lease'), 'T1\n');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'scope-guard-'));
  mkdirSync(path.join(root, '.claude'), { recursive: true });
  mkdirSync(path.join(root, 'migrations'), { recursive: true });
  mkdirSync(path.join(root, 'shared'), { recursive: true });
  mkdirSync(path.join(root, 'lib/domain'), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('generated output', () => {
  it.each([
    'next-env.d.ts',
    'tsconfig.tsbuildinfo',
    'package-lock.json',
    '.next/server/app/page.js',
    'node_modules/next/package.json',
  ])('blocks Edit of %s', (file) => {
    expect(edit(file)).toBe(2);
  });

  it('blocks a shell redirect into generated output', () => {
    expect(bash('echo "{}" > package-lock.json')).toBe(2);
  });

  it('allows the sanctioned producers', () => {
    expect(bash('npm ci')).toBe(0);
    expect(bash('npm install pg')).toBe(0);
    expect(bash('npm run build')).toBe(0);
  });

  // False positive that a "mentions the path + contains a redirect" rule would produce.
  it('allows reading generated output with unrelated shell plumbing', () => {
    expect(bash('grep -c "" package-lock.json 2>/dev/null')).toBe(0);
    expect(bash('cat next-env.d.ts | head -5 2>/dev/null')).toBe(0);
  });
});

describe('contract surface', () => {
  it.each(['shared/types.ts', 'db/schema.sql', 'shared/contracts/account.ts'])(
    'blocks Edit of %s with no lease open',
    (file) => {
      expect(edit(file)).toBe(2);
    },
  );

  it('allows the same edits while the lease is open', () => {
    openLease();
    expect(edit('shared/types.ts')).toBe(0);
    expect(edit('db/schema.sql')).toBe(0);
  });

  it('blocks a shell write to the contract surface with no lease', () => {
    expect(bash("sed -i '' 's/foo/bar/' shared/types.ts")).toBe(2);
    expect(bash('echo "ALTER TABLE accounts;" >> db/schema.sql')).toBe(2);
  });

  // §13.2 requires both a true positive and a false positive for every rule. The pair below is
  // the test-file carve-out: a test under the contract surface is implementation, not contract.
  // The false-positive half is the one that matters — without it the lease, closed for
  // implementation exactly as §7.2 demands, made the natural home for a contract's tests
  // unwritable by the only role allowed to write tests, and G2 was unreachable.
  it('still blocks a contract MODULE under the surface with no lease (true positive)', () => {
    expect(edit('shared/contracts/shapes.ts')).toBe(2);
    expect(bash('printf x >> shared/contracts/shapes.ts')).toBe(2);
  });

  it('allows a contract TEST under the surface with no lease (false positive fixed)', () => {
    expect(edit('shared/contracts/shapes.test.ts')).toBe(0);
    expect(bash('printf x >> shared/contracts/shapes.test.ts')).toBe(0);
  });

  // The carve-out is a lookahead on the path, not a licence for the whole command: writing a real
  // contract file stays blocked even when the same command also names a test path.
  it('blocks a real contract write that merely mentions a test path alongside it', () => {
    expect(bash('printf x >> shared/contracts/shapes.ts; echo shared/contracts/ok.test.ts')).toBe(2);
  });

  it('blocks creating a migration outside the G1 window', () => {
    expect(bash('npm run migrate:create add-column')).toBe(2);
  });

  it('allows creating a migration while the lease is open', () => {
    openLease();
    expect(bash('npm run migrate:create add-column')).toBe(0);
  });

  // The reviewer and the orchestrator read these files constantly at every gate.
  it('allows reading the contract surface with no lease', () => {
    expect(bash('cat shared/types.ts')).toBe(0);
    expect(bash('grep -rn "valuation_mode" migrations/ 2>/dev/null')).toBe(0);
    expect(bash('git diff --stat -- db/schema.sql')).toBe(0);
  });
});

describe('committed migrations are immutable', () => {
  const migration = 'migrations/1786029579465_baseline-schema.sql';

  beforeEach(() => {
    writeFileSync(path.join(root, migration), '-- baseline\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], {
      cwd: root,
    });
  });

  it('blocks editing a committed migration even with the lease open', () => {
    openLease();
    expect(edit(migration)).toBe(2);
  });

  it('allows editing a brand-new uncommitted migration while the lease is open', () => {
    openLease();
    expect(edit('migrations/1799999999999_new-thing.sql')).toBe(0);
  });
});

describe('frozen specs', () => {
  beforeEach(() => mkdirSync(path.join(root, 'plan/tasks/P1-11-overview'), { recursive: true }));

  it('allows editing a spec that is not yet frozen', () => {
    expect(edit('plan/tasks/P1-11-overview/SPEC.md')).toBe(0);
  });

  it('blocks editing a spec frozen at G0', () => {
    writeFileSync(path.join(root, 'plan/tasks/P1-11-overview/.frozen'), '');
    expect(edit('plan/tasks/P1-11-overview/SPEC.md')).toBe(2);
  });

  it('still allows the gate log and evidence in a frozen task', () => {
    writeFileSync(path.join(root, 'plan/tasks/P1-11-overview/.frozen'), '');
    expect(edit('plan/tasks/P1-11-overview/GATES.md')).toBe(0);
    expect(edit('plan/tasks/P1-11-overview/EVIDENCE.md')).toBe(0);
  });
});

describe('everything else is untouched', () => {
  it.each([
    'lib/domain/netWorth.ts',
    'lib/domain/netWorth.test.ts',
    'app/dashboard/page.tsx',
    'components/PropertyPnlCard.tsx',
    'BUILD.md',
  ])('allows Edit of %s', (file) => {
    expect(edit(file)).toBe(0);
  });

  it('allows the gate commands the orchestrator runs', () => {
    expect(bash('npx tsc --noEmit')).toBe(0);
    expect(bash('npm test 2>&1 | tail -20')).toBe(0);
    expect(bash('npm run lint')).toBe(0);
    expect(bash('npm run migrate:up && npm run migrate:down && npm run migrate:up')).toBe(0);
  });

  it('fails open on payloads it cannot interpret', () => {
    expect(run({ tool_name: 'Edit', tool_input: {} })).toBe(0);
    expect(edit('/etc/hosts')).toBe(0); // outside the repo — not ours to police
    expect(bash('')).toBe(0);
  });
});

// Regression suite for PD-1 (see plan/tasks/P0-09a-tenant-held-funds/GATES.md): the guard's two
// false positives, found on its first day of real use. Both halves are required by §13.2 — the
// true-positive cases here are the ones that must NOT regress while fixing the false positives,
// which is the whole failure mode amendment A3 describes.
describe('heredoc bodies are data, not commands', () => {
  const doc = (body: string) => `cat > notes.md <<'EOF'\n${body}\nEOF`;

  // FALSE POSITIVES — the defect. A document that merely quotes a command is not that command.
  it('allows writing a document that mentions destructive commands', () => {
    expect(bash(doc('To clear a stale build cache, run `rm -rf .next`.'))).toBe(0);
    expect(bash(doc('Never run `sed -i s/a/b/ shared/types.ts` by hand.'))).toBe(0);
    expect(bash(doc('The baseline is migrations/1786029579465_baseline-schema.sql — do not edit it.'))).toBe(0);
    expect(bash(doc('Regenerate with `npm ci`, which rewrites package-lock.json.'))).toBe(0);
  });

  it('allows an unterminated heredoc rather than falling back to scanning it', () => {
    expect(bash("cat > notes.md <<'EOF'\nmention of rm -rf .next with no closing delimiter")).toBe(0);
  });

  it('allows a multi-line heredoc whose body names every protected path', () => {
    expect(
      bash(doc('rm migrations/x.sql\nsed -i "" s/a/b/ db/schema.sql\necho hi > shared/types.ts')),
    ).toBe(0);
  });

  // TRUE POSITIVES — stripping the body must not blind the guard to the redirect that opens it.
  // The `>` sits BEFORE the `<<`, so it survives and must still be caught.
  it('still blocks a heredoc written INTO a protected path', () => {
    expect(bash("cat > shared/types.ts <<'EOF'\nexport type X = 1;\nEOF")).toBe(2);
    expect(bash("cat > db/schema.sql <<'EOF'\nCREATE TABLE x ();\nEOF")).toBe(2);
    expect(bash("cat >> package-lock.json <<'EOF'\n{}\nEOF")).toBe(2);
  });

  it('still blocks a real mutation that appears after a heredoc ends', () => {
    expect(bash("cat > notes.md <<'EOF'\nharmless text\nEOF\nsed -i '' s/a/b/ shared/types.ts")).toBe(2);
  });
});

describe('deleting generated output is allowed; deleting the contract surface is not', () => {
  // FALSE POSITIVE — the defect. Build output regenerates; blocking its removal blocks the
  // documented fix for a stale cache and teaches people to route around the guard.
  it('allows removing build output', () => {
    expect(bash('rm -rf .next')).toBe(0);
    expect(bash('rm -rf node_modules && npm ci')).toBe(0);
    expect(bash('rm ".next/types/routes.d 2.ts"')).toBe(0);
  });

  // TRUE POSITIVE — deletion here destroys history that exists nowhere else.
  it('still blocks removing the contract surface with no lease', () => {
    expect(bash('rm migrations/1786029579465_baseline-schema.sql')).toBe(2);
    expect(bash('rm -rf shared/contracts')).toBe(2);
    expect(bash('rm db/schema.sql')).toBe(2);
  });

  // Editing generated output stays blocked — this fix narrows deletion only, nothing else.
  it('still blocks WRITING to generated output', () => {
    expect(bash('echo "{}" > package-lock.json')).toBe(2);
    expect(bash("sed -i '' s/a/b/ next-env.d.ts")).toBe(2);
  });
});
