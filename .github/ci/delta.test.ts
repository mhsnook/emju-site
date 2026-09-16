import { describe, expect, it } from 'vitest'

import { buildReport, diffIssues } from './delta.ts'
import type { Issue, TreeMeasurement } from './types.ts'

const issue = (file: string, line: number, message: string): Issue => ({
	file,
	line,
	column: 1,
	message,
})

const tree = (name: 'head' | 'base', over: Partial<TreeMeasurement> = {}): TreeMeasurement => ({
	tree: name,
	sha: 'abc123',
	build: { ok: true, firstError: [] },
	typecheck: { ran: true, issues: [] },
	lint: { ran: true, issues: [] },
	format: { ran: true, unformatted: [] },
	bundle: {
		source: 'route-manifest',
		fileCount: 3,
		eager: { raw: 1000, gzip: 400, files: ['index-aaaaaaaa.js'] },
		css: { raw: 500, gzip: 200, files: ['styles-bbbbbbbb.css'] },
		lazy: { raw: 0, gzip: 0, files: [] },
		chunks: { 'index.js': 'aaaaaaaa', 'styles.css': 'bbbbbbbb' },
		worker: { raw: 2_000_000, gzip: 400_000 },
	},
	touched: name === 'head' ? [] : null,
	tests: name === 'head' ? { ran: true, total: 10, passed: 10, failed: 0, failures: [] } : null,
	...over,
})

describe('diffIssues', () => {
	it('counts an issue in a new place as added', () => {
		const delta = diffIssues([], [issue('a.ts', 4, 'bad')])
		expect(delta.added).toHaveLength(1)
		expect(delta.resolved).toHaveLength(0)
	})

	it('pairs an issue that only moved a few lines', () => {
		const delta = diffIssues([issue('a.ts', 4, 'bad')], [issue('a.ts', 7, 'bad')])
		expect(delta.added).toHaveLength(0)
		expect(delta.resolved).toHaveLength(0)
		expect(delta.shifted).toBe(1)
	})

	it('does not pair across a move larger than the tolerance', () => {
		const delta = diffIssues([issue('a.ts', 4, 'bad')], [issue('a.ts', 400, 'bad')])
		expect(delta.added).toHaveLength(1)
		expect(delta.resolved).toHaveLength(1)
	})

	it('pairs one to one, so a moved block does not collapse into one shift', () => {
		const before = [1, 2, 3].map((n) => issue('a.ts', n, `bad ${n}`))
		const after = [1, 2, 3].map((n) => issue('a.ts', n + 5, `bad ${n}`))
		const delta = diffIssues(before, after)
		expect(delta.shifted).toBe(3)
		expect(delta.added).toHaveLength(0)
		expect(delta.resolved).toHaveLength(0)
	})

	it('does not cancel two findings that share a message but not a place', () => {
		const delta = diffIssues(
			[issue('a.ts', 4, 'bad')],
			[issue('a.ts', 9, 'bad'), issue('a.ts', 900, 'bad')]
		)
		expect(delta.shifted).toBe(1)
		expect(delta.added.map((i) => i.line)).toEqual([900])
	})

	it('ignores the line number when deciding what an issue is', () => {
		const delta = diffIssues([issue('a.ts', 4, 'bad')], [issue('a.ts', 4, 'worse')])
		expect(delta.added.map((i) => i.message)).toEqual(['worse'])
		expect(delta.resolved.map((i) => i.message)).toEqual(['bad'])
	})
})

describe('the report', () => {
	it('passes when nothing moved', () => {
		const report = buildReport(tree('head'), tree('base'), 'main')
		expect(report.blocking).toEqual([])
		expect(report.body).toContain('All checks passing')
	})

	it('blocks on a new type error and names it', () => {
		const head = tree('head', {
			typecheck: { ran: true, issues: [issue('src/a.ts', 3, 'error TS2322: nope')] },
		})
		const report = buildReport(head, tree('base'), 'main')
		expect(report.blocking).toHaveLength(1)
		expect(report.body).toContain('src/a.ts(3,1): error TS2322: nope')
	})

	it('reports a resolved issue without blocking', () => {
		const base = tree('base', {
			lint: { ran: true, issues: [issue('src/a.ts', 3, 'error: unused')] },
		})
		const report = buildReport(tree('head'), base, 'main')
		expect(report.blocking).toEqual([])
		expect(report.body).toContain('1 resolved')
	})

	it('blocks when a tree was not measured, and never says "no change"', () => {
		const report = buildReport(tree('head'), null, 'main')
		expect(report.blocking).toHaveLength(1)
		expect(report.body).toContain('not measured')
		expect(report.body).not.toContain('All checks passing')
	})

	it('blocks when one check could not run, even though the job finished', () => {
		const head = tree('head', { lint: { ran: false, issues: [] } })
		const report = buildReport(head, tree('base'), 'main')
		expect(report.blocking.join()).toContain('Lint')
		expect(report.body).toContain('produced no measurement')
	})

	it('blocks on drift in a file the PR touched', () => {
		const head = tree('head', {
			touched: ['src/a.ts'],
			format: { ran: true, unformatted: ['src/a.ts'] },
		})
		const report = buildReport(head, tree('base'), 'main')
		expect(report.blocking.join()).toContain('Formatting')
	})

	it('stays quiet about drift in a file the PR did not touch', () => {
		const head = tree('head', {
			touched: ['src/a.ts'],
			format: { ran: true, unformatted: ['src/untouched.ts'] },
		})
		const base = tree('base', { format: { ran: true, unformatted: ['src/untouched.ts'] } })
		const report = buildReport(head, base, 'main')
		expect(report.blocking).toEqual([])
		expect(report.body).toContain('blocks nothing')
	})

	it('treats a missing touched-file list as a crashed step, not an empty PR', () => {
		const head = tree('head', { touched: null, format: { ran: true, unformatted: [] } })
		const report = buildReport(head, tree('base'), 'main')
		expect(report.blocking.join()).toContain('Formatting')
	})

	it('says nothing about the build while both trees build', () => {
		const report = buildReport(tree('head'), tree('base'), 'main')
		expect(report.body).not.toContain('| Build ')
	})

	it('tells a PR that inherited a broken base branch', () => {
		const broken = { ok: false, firstError: ['error during build: boom'] }
		const report = buildReport(
			tree('head', { build: broken }),
			tree('base', { build: broken }),
			'main'
		)
		expect(report.body).toContain('already broken')
	})

	it('warns without blocking when the bundle moves', () => {
		const head = tree('head')
		head.bundle!.eager.gzip = 40_000
		const report = buildReport(head, tree('base'), 'main')
		expect(report.blocking).toEqual([])
		expect(report.body).toContain('⚠️')
	})

	it('blocks on a failing test and quotes it', () => {
		const head = tree('head', {
			tests: {
				ran: true,
				total: 10,
				passed: 9,
				failed: 1,
				failures: ['adds numbers: expected 1'],
			},
		})
		const report = buildReport(head, tree('base'), 'main')
		expect(report.blocking.join()).toContain('Tests')
		expect(report.body).toContain('adds numbers')
	})

	it('blocks when the test report is missing', () => {
		const head = tree('head', { tests: null })
		const report = buildReport(head, tree('base'), 'main')
		expect(report.blocking.join()).toContain('Test failures')
	})
})
