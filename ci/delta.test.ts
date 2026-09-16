import { describe, expect, it } from 'vitest'

import { diffIssues, diffPaths, type Measurement, parseIssue, renderReport } from './delta.ts'

const at = (file: string, line: number, message = 'X') => `${file}:${line}:1: ${message}`

describe('diffIssues', () => {
	it('pairs an issue that moved a few lines', () => {
		const delta = diffIssues([at('a.ts', 10)], [at('a.ts', 14)])
		expect(delta).toEqual({ added: [], resolved: [], shifted: 1 })
	})

	it('does not pair an issue that moved far', () => {
		const delta = diffIssues([at('a.ts', 10)], [at('a.ts', 450)])
		expect(delta.added).toHaveLength(1)
		expect(delta.resolved).toHaveLength(1)
		expect(delta.shifted).toBe(0)
	})

	it('reports nothing when an issue stays put', () => {
		const delta = diffIssues([at('a.ts', 10)], [at('a.ts', 10)])
		expect(delta).toEqual({ added: [], resolved: [], shifted: 0 })
	})

	it('consumes each resolved issue once', () => {
		const delta = diffIssues([at('a.ts', 10)], [at('a.ts', 12), at('a.ts', 13)])
		expect(delta.added).toHaveLength(1)
		expect(delta.resolved).toHaveLength(0)
		expect(delta.shifted).toBe(1)
	})

	it('pairs one of two issues that collapsed into one', () => {
		const delta = diffIssues([at('a.ts', 10), at('a.ts', 11)], [at('a.ts', 14)])
		expect(delta.added).toHaveLength(0)
		expect(delta.resolved).toHaveLength(1)
		expect(delta.shifted).toBe(1)
	})

	it('never pairs across files', () => {
		const delta = diffIssues([at('a.ts', 10)], [at('b.ts', 10)])
		expect(delta.added).toHaveLength(1)
		expect(delta.resolved).toHaveLength(1)
		expect(delta.shifted).toBe(0)
	})

	it('counts an issue in an empty baseline as new', () => {
		const delta = diffIssues([], [at('a.ts', 10)])
		expect(delta.added).toEqual([at('a.ts', 10)])
	})

	it('never pairs two different messages in one file', () => {
		const delta = diffIssues([at('a.ts', 10, 'X')], [at('a.ts', 12, 'Y')])
		expect(delta.shifted).toBe(0)
		expect(delta.added).toHaveLength(1)
	})

	it('sees a column-only move, because the column is part of the place', () => {
		const delta = diffIssues(['a.ts:10:1: X'], ['a.ts:10:3: X'])
		expect(delta.shifted).toBe(1)
		expect(delta.added).toHaveLength(0)
	})
})

describe('parseIssue', () => {
	it('reads a normalised issue line', () => {
		expect(parseIssue('src/a.ts:88:12: error TS2322: nope')).toEqual({
			file: 'src/a.ts',
			line: 88,
			column: 12,
			message: 'error TS2322: nope',
		})
	})

	it('returns null on a line it cannot parse', () => {
		expect(parseIssue('Found 12 errors.')).toBeNull()
	})
})

describe('diffPaths', () => {
	it('is a set difference in both directions', () => {
		expect(diffPaths(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], resolved: ['a'] })
	})
})

function measurement(
	tree: 'head' | 'base',
	over: Partial<Measurement['checks']> = {}
): Measurement {
	return {
		tree,
		sha: 'abc',
		build: { ran: true, ok: true, log: '' },
		checks: {
			typecheck: { ran: true, issues: [] },
			lint: { ran: true, issues: [], warnings: [] },
			format: { ran: true, drifted: [], touched: tree === 'head' ? [] : [] },
			bundle: {
				ran: true,
				source: 'test',
				fileCount: 1,
				eager: { files: ['a.js'], raw: 100, gzip: 50 },
				entry: null,
				css: { files: [], raw: 0, gzip: 0 },
				routes: {},
				chunks: { 'a.js': { hash: 'aaaaaaaa', raw: 100, gzip: 50 } },
				worker: null,
			},
			deploy: { ran: true, ok: true, log: '' },
			tests: tree === 'head' ? { ran: true, total: 5, failed: 0, failures: [] } : null,
			...over,
		},
	}
}

describe('renderReport', () => {
	it('blocks when a tree produced no measurement', () => {
		const report = renderReport({ head: measurement('head'), base: null, baseRef: 'main' })
		expect(report.blocking).toHaveLength(1)
		expect(report.body).toContain('is "no change"')
	})

	it('blocks when one check could not run, rather than reporting no change', () => {
		const report = renderReport({
			head: measurement('head', { typecheck: { ran: false, issues: [] } }),
			base: measurement('base'),
			baseRef: 'main',
		})
		expect(report.blocking.join()).toContain('Type errors')
	})

	it('says nothing about the build while both trees build', () => {
		const report = renderReport({
			head: measurement('head'),
			base: measurement('base'),
			baseRef: 'main',
		})
		expect(report.body).not.toContain('| Build |')
		expect(report.blocking).toEqual([])
	})

	it('tells a PR that it inherited a broken base branch', () => {
		const head = measurement('head')
		const base = measurement('base')
		head.build.ok = false
		base.build.ok = false
		const report = renderReport({ head, base, baseRef: 'main' })
		expect(report.body).toContain('does not build either')
	})

	it('blocks on an unformatted file the PR touched', () => {
		const report = renderReport({
			head: measurement('head', {
				format: { ran: true, drifted: ['src/a.ts'], touched: ['src/a.ts'] },
			}),
			base: measurement('base'),
			baseRef: 'main',
		})
		expect(report.blocking.join()).toContain('Formatting')
	})

	it('leaves drift alone in a file the PR did not touch', () => {
		const report = renderReport({
			head: measurement('head', {
				format: { ran: true, drifted: ['src/old.ts'], touched: ['src/a.ts'] },
			}),
			base: measurement('base', { format: { ran: true, drifted: ['src/old.ts'], touched: [] } }),
			baseRef: 'main',
		})
		expect(report.blocking).toEqual([])
		expect(report.body).toContain("not this PR's problem")
	})

	it('blocks when the touched-file list is missing', () => {
		const report = renderReport({
			head: measurement('head', { format: { ran: true, drifted: [], touched: null } }),
			base: measurement('base'),
			baseRef: 'main',
		})
		expect(report.blocking.join()).toContain('Formatting')
	})

	it('reports bundle growth without blocking', () => {
		const base = measurement('base')
		const head = measurement('head')
		head.checks.bundle.eager.gzip = 80_000
		base.checks.bundle.eager.gzip = 50_000
		const report = renderReport({ head, base, baseRef: 'main' })
		expect(report.blocking).toEqual([])
		expect(report.body).toContain('Bundle size')
	})
})
