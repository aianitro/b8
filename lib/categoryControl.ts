// The control-mode WRITE path, extracted from the categories API route so it can be unit tested
// without a DB — the same reason budgetMath.ts exists, and the same route it was extracted from.
//
// lib/domain/adherence.ts owns the READ side: which categories a behavioural figure may range
// over. This module owns the other half, and the two must not be confused. Nothing here decides
// what is scored; it decides what the database will be asked to store, and it exists because
// until now nothing in the application could ask at all (P0.5-31 NITS N51): control_mode was
// readable through GET, writable only by a migration default, and so every category created
// through the UI was born 'fixed' and invisible to the guardrail with no in-app way to fix it.
//
// Both rules below are restatements of CHECK constraints in db/schema.sql, and deliberately so:
// the CHECK is the enforcement and stays the enforcement, because it also polices writes that
// never pass through this route. What an application-level copy buys is a *stated* error instead
// of a raw 23514 surfacing as a 500 — the constraint says no either way.

import type { ControlMode } from '../shared/types';

/**
 * The three values, in the order they are offered to a human: least discretion to most.
 *
 * Source of truth for the *set* is the CHECK constraint in db/schema.sql; this is the copy the
 * API validates against so an unknown value is a 400 with a list rather than a 500 from Postgres.
 */
export const CONTROL_MODES = ['fixed', 'variable-necessary', 'discretionary'] as const;

/** Human-facing labels. Kept beside the values so a new mode cannot acquire one and not the other. */
export const CONTROL_MODE_LABELS: Record<ControlMode, string> = {
  'fixed': 'Fixed',
  'variable-necessary': 'Variable',
  'discretionary': 'Discretionary',
};

/**
 * Coerces arbitrary JSON input into a control mode, or null for anything else.
 *
 * Null rather than a thrown error, and null rather than a silent fallback to 'fixed': the caller
 * must distinguish "absent, so leave it alone" from "present and wrong, so refuse". A fallback
 * here would turn a typo into a successful write of the default, which is precisely the value
 * that keeps a category out of the scored set — the failure would be silent and would look fine.
 */
export function parseControlMode(input: unknown): ControlMode | null {
  return (CONTROL_MODES as readonly string[]).includes(input as string)
    ? (input as ControlMode)
    : null;
}

/**
 * Whether this pairing violates budget_categories_debt_service_control_mode_check.
 *
 * A debt-service category IS the fixed case — a mortgage payment is not a decision anybody makes
 * monthly — so the schema forbids the combination outright rather than letting an adherence
 * figure range over it. Checked here only to produce a stated 409; the CHECK is what enforces it.
 */
export function conflictsWithDebtService(mode: ControlMode, isDebtService: boolean): boolean {
  return isDebtService && mode !== 'fixed';
}
