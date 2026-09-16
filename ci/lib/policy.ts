/**
 * What blocks a merge.
 *
 * Policy is data, one rule per check, so that loosening a rule during a
 * migration is a one-line edit rather than a rewrite of the rendering code.
 *
 * The defaults below were chosen from what `main` measured when this workflow
 * was written, and the pull request that added it lists each one for review.
 */

export type Rule =
	/** The comment carries the value; nothing blocks. */
	| 'report-only'
	/** This pull request adds an issue of this kind. */
	| 'no-new'
	/** An issue sits in a file this pull request touched, new or not. */
	| 'touched-clean'
	/** A head-only step failed. */
	| 'must-pass'

export type CheckId = 'build' | 'typecheck' | 'lint' | 'format' | 'bundle' | 'worker' | 'tests'

export const POLICY: Record<CheckId, Rule> = {
	// A tree that does not build supports no other judgement.
	build: 'must-pass',
	// `main` typechecks clean today, so the check can start at zero.
	typecheck: 'no-new',
	// `main` lints clean today as well. Warnings stay report-only.
	lint: 'no-new',
	// Scoped to the files the author touched, which is what makes it safe while
	// the repository still carries drift elsewhere.
	format: 'touched-clean',
	// Nobody has watched these bytes yet, so any budget would be a guess.
	bundle: 'report-only',
	// The dry-run must pass: it is the only check that reads the deploy config
	// and its bindings. Its size stays report-only.
	worker: 'must-pass',
	tests: 'must-pass',
}

/** Order of the table rows and the detail entries, so both read the same. */
export const ORDER: CheckId[] = [
	'build',
	'typecheck',
	'lint',
	'format',
	'bundle',
	'worker',
	'tests',
]

export const TITLES: Record<CheckId, string> = {
	build: 'Build',
	typecheck: 'Type errors',
	lint: 'Lint',
	format: 'Formatting (files you touched)',
	bundle: 'Client bundle',
	worker: 'Worker bundle',
	tests: 'Test failures',
}
