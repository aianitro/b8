// Two type-level utilities, so that "this schema is derived from shared/types.ts" is a fact the
// compiler checks rather than a claim a comment makes.
//
// ITEM.md names the failure this guards against by name: a contract whose accepted value set was
// transcribed from a route handler's if/else chain, or from memory, rather than from the type and
// the CHECK constraint. A unit test can only catch the wrong value somebody thought to write a
// case for — `'variable'` for `'variable-necessary'` is caught by SPEC.md's F5 precisely because
// an author anticipated that one typo. `Assert<Equals<…>>` catches every divergence of the whole
// set at once, and it fails at `npx tsc --noEmit` (SPEC.md acceptance #1), which already runs in
// every gate this repo has.
//
// Deliberately not a runtime helper: nothing here emits JavaScript, so the contract surface stays
// a pure declaration module and these cost nothing at parse time.

/**
 * True only when `A` and `B` are the *same* type, not merely mutually assignable.
 *
 * The identical-signature trick rather than a pair of `extends` checks: `[A] extends [B]` and its
 * converse both pass for types that differ only by optionality or by `any`, which is exactly the
 * sloppiness this module exists to refuse. Union member order does not matter — TypeScript
 * normalizes unions before the comparison — so the value order a schema lists is free to differ
 * from the order the TypeScript union declares it in.
 */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Fails to compile unless `T` is exactly `true`.
 *
 * Used as `export type XIsExact = Assert<Equals<…>>`. The export matters: an unexported unused
 * type alias is a lint warning, and SPEC.md acceptance #3 pins the repo at exactly one
 * pre-existing warning, so the assertion has to be part of the module's surface rather than a
 * local. That is no loss — a consumer importing it gets the same proof.
 */
export type Assert<T extends true> = T;
