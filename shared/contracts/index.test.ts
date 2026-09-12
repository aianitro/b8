// Does this directory actually correspond to `shared/types.ts`, and can that be checked rather than
// reviewed? Both fixtures here answer yes by reading the declarations out of `shared/types.ts`'s own
// AST, so neither can pass against a list kept up to date by hand in this file.
//
// The AST, not a regex over the source: this task has already been burned once by a text search
// standing in for a structural rule (GATES.md G1-D1 — a comment describing compliance failed the
// compliance check, and a real import written with the other quote character passed it). The
// `typescript` package is already the tool SPEC.md's own acceptance #40-#43 parse with, and already
// a resolvable devDependency.
//
// The compile-time `Assert<Equals<...>>` lines in enums.ts and shapes.ts check a strictly stronger
// property than these two fixtures do, and they check it at `npx tsc --noEmit`. These exist anyway
// because a type-level assertion is invisible in a test report: SPEC.md's acceptance commands grade
// this task on named, running fixtures, and a reviewer reading the reporter output should see the
// correspondence claimed and checked, not have to take the compiler's word for it silently.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BudgetCategorySchema, CONTRACT_SCHEMAS } from './index';

const TYPES_FILE = fileURLToPath(new URL('../types.ts', import.meta.url));
const typesSource = ts.createSourceFile(
  TYPES_FILE,
  readFileSync(TYPES_FILE, 'utf8'),
  ts.ScriptTarget.Latest,
  /* setParentNodes */ true
);

/** Every name `shared/types.ts` exports — its `export type`s and its `export interface`s. */
function exportedTypeNames(): string[] {
  return typesSource.statements.flatMap((statement) =>
    (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
    (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0
      ? [statement.name.text]
      : []
  );
}

/** The field names one of those interfaces declares, in declaration order. */
function declaredFieldsOf(interfaceName: string): string[] {
  const declaration = typesSource.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  );
  if (!declaration) throw new Error(`shared/types.ts declares no interface ${interfaceName}`);
  return declaration.members.flatMap((member) =>
    ts.isPropertySignature(member) && ts.isIdentifier(member.name) ? [member.name.text] : []
  );
}

describe('the contract surface against shared/types.ts', () => {
  it('every exported shape in shared/types.ts other than the response envelope has exactly one corresponding schema in shared/contracts', () => {
    const exported = exportedTypeNames();

    // Guard the parse itself first. Were `exportedTypeNames()` to return nothing — a refactor of
    // shared/types.ts into re-exports, say — the set comparison below would compare two empty-ish
    // sets and this fixture would pass while checking nothing at all.
    expect(exported).toContain('ApiResponse');
    expect(exported).toContain('Landscape');
    expect(exported.length).toBeGreaterThan(10);

    // The envelope is the stated exception: its success branch is generic over twelve payloads, so
    // it has no single schema to put in a map. envelope.test.ts covers it as two branches.
    const shapes = exported.filter((name) => name !== 'ApiResponse');

    expect(Object.keys(CONTRACT_SCHEMAS).sort()).toEqual([...shapes].sort());

    // "Exactly one" has a second half a key-set comparison does not cover: twelve keys could all
    // point at the same schema, or at `undefined`. Each must hold its own validator.
    for (const name of shapes) {
      expect(CONTRACT_SCHEMAS[name as keyof typeof CONTRACT_SCHEMAS]).toBeInstanceOf(z.ZodType);
    }
    expect(new Set(Object.values(CONTRACT_SCHEMAS)).size).toBe(shapes.length);
  });

  it("the BudgetCategory schema's field set matches shared/types.ts exactly and admits none of budget_categories' extra columns is_debt_service or sort_order", () => {
    const declared = declaredFieldsOf('BudgetCategory');
    expect(declared).toHaveLength(10);

    // The type is the model, not the table: `budget_categories` has thirteen columns, and the two
    // the type omits are omitted here too. Built from `CREATE TABLE` instead, this schema would
    // admit `is_debt_service` — which, pointed at an inbound payload, would let a client set it
    // without the debt-service/control_mode coupling check that lives only in the route handler.
    expect(Object.keys(BudgetCategorySchema.shape).sort()).toEqual([...declared].sort());
    expect(Object.keys(BudgetCategorySchema.shape)).not.toContain('is_debt_service');
    expect(Object.keys(BudgetCategorySchema.shape)).not.toContain('sort_order');

    // Asserted on the declared field set rather than on a rejection, deliberately. Row schemas
    // STRIP unknown keys (CONTRACT.md): `POST /api/categories` returns `INSERT ... RETURNING *`, so
    // its live response really does carry both extra columns, and a strict schema would reject a
    // payload this application produces today. What "admits none of" means here is that they are
    // dropped rather than validated and passed on — which is what this parse shows.
    //
    // The ten-field row is written out again rather than imported from shapes.test.ts: importing a
    // test file from another test file re-registers its suites and runs every fixture twice.
    const parsedFromReturningStar = BudgetCategorySchema.parse({
      id: 31,
      name: 'Mortgage',
      annual_budget: '28800.00',
      landscape: 'operational',
      exclude_from_budget: false,
      is_income: false,
      control_mode: 'fixed',
      dedicated_account_id: null,
      monthly_amounts: null,
      created_at: '2026-01-15T00:00:00.000Z',
      is_debt_service: true,
      sort_order: 3,
    });
    expect(Object.keys(parsedFromReturningStar).sort()).toEqual([...declared].sort());
  });
});
