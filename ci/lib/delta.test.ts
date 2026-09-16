import { describe, expect, it } from 'vitest'

import { diffIssues, diffPaths, type Issue, normalise, normalisePaths } from './delta.ts'

/** `a.ts:10 X` in the table below. */
function issue(spec: string): Issue {
	const [file, line, message] = spec.split(':')
	return { file, line: Number(line), column: 1, message, raw: spec }
}

const parse = (specs: string[]) => specs.map(issue)

describe('diffIssues', () => {
	/**
	 * The table from the skill's architecture reference. The first two cases
	 * catch the two ways of conflating the membership key with the pairing key,
	 * and both of those failures are silent.
	 */
	const cases: [
		string,
		string[],
		string[],
		{ added: number; resolved: number; shifted: number },
	][] = [
		[
			'an issue that moved a few lines',
			['a.ts:10:X'],
			['a.ts:14:X'],
			{ added: 0, resolved: 0, shifted: 1 },
		],
		[
			'an issue that moved far',
			['a.ts:10:X'],
			['a.ts:450:X'],
			{ added: 1, resolved: 1, shifted: 0 },
		],
		[
			'an issue that did not move',
			['a.ts:10:X'],
			['a.ts:10:X'],
			{ added: 0, resolved: 0, shifted: 0 },
		],
		[
			'one that moved plus one that is new',
			['a.ts:10:X'],
			['a.ts:12:X', 'a.ts:13:X'],
			{ added: 1, resolved: 0, shifted: 1 },
		],
		[
			'two that became one',
			['a.ts:10:X', 'a.ts:11:X'],
			['a.ts:14:X'],
			{ added: 0, resolved: 1, shifted: 1 },
		],
		[
			'the same message in another file',
			['a.ts:10:X'],
			['b.ts:10:X'],
			{ added: 1, resolved: 1, shifted: 0 },
		],
		['a first issue', [], ['a.ts:10:X'], { added: 1, resolved: 0, shifted: 0 }],
	]

	for (const [name, base, head, expected] of cases)
		it(name, () => {
			const delta = diffIssues(parse(base), parse(head))
			expect({
				added: delta.added.length,
				resolved: delta.resolved.length,
				shifted: delta.shifted,
			}).toEqual(expected)
		})

	it('pairs one to one, so a block of ten that moved stays ten', () => {
		const base = parse(['a.ts:10:X', 'a.ts:11:X', 'a.ts:12:X'])
		const head = parse(['a.ts:14:X', 'a.ts:15:X', 'a.ts:16:X'])
		const delta = diffIssues(base, head)
		expect(delta.shifted).toBe(3)
		expect(delta.added).toHaveLength(0)
		expect(delta.resolved).toHaveLength(0)
	})

	it('counts a column change as a change', () => {
		const base = [{ file: 'a.ts', line: 10, column: 1, message: 'X', raw: '' }]
		const head = [{ file: 'a.ts', line: 10, column: 4, message: 'X', raw: '' }]
		const delta = diffIssues(base, head)
		expect(delta.shifted).toBe(1)
		expect(delta.added).toHaveLength(0)
	})

	it('respects the proximity argument', () => {
		expect(diffIssues(parse(['a.ts:10:X']), parse(['a.ts:14:X']), 2).shifted).toBe(0)
	})
})

describe('normalise', () => {
	it('drops duplicates, which project-wide typecheckers emit for shared files', () => {
		expect(normalise(parse(['a.ts:10:X', 'a.ts:10:X']))).toHaveLength(1)
	})

	it('sorts by bytes rather than by locale, so leading punctuation stays put', () => {
		const sorted = normalisePaths(['AGENTS.md', '.oxfmtrc.json'])
		expect(sorted).toEqual(['.oxfmtrc.json', 'AGENTS.md'])
	})
})

describe('diffPaths', () => {
	it('compares sets of files', () => {
		const delta = diffPaths(['a.ts', 'b.ts'], ['b.ts', 'c.ts'])
		expect(delta.added).toEqual(['c.ts'])
		expect(delta.resolved).toEqual(['a.ts'])
	})
})
