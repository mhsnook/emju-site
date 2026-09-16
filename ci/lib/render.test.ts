import { describe, expect, it } from 'vitest'

import type { Measurement, Tree } from './measurement.ts'
import { MARKER, render } from './render.ts'

function measurement(tree: Tree, overrides: Partial<Measurement['checks']> = {}): Measurement {
	return {
		tree,
		sha: 'abc1234',
		build: { ran: true, ok: true, log: '' },
		checks: {
			typecheck: { ran: true, issues: [] },
			lint: { ran: true, issues: [], warnings: [] },
			format: { ran: true, drifted: [], touched: tree === 'head' ? ['src/a.ts'] : [] },
			bundle: {
				ran: true,
				source: 'the TanStack Start route manifest',
				fileCount: 7,
				eagerJs: { raw: 1000, gzip: 400 },
				css: { raw: 900, gzip: 300 },
				lazyJs: { raw: 500, gzip: 200, count: 2 },
				chunks: { 'index.js': 'aaaaaaaa' },
			},
			worker: { ran: true, ok: true, raw: 2000, gzip: 800, log: '' },
			tests: { ran: true, ok: true, total: 52, failed: 0, failures: [] },
			...overrides,
		},
	}
}

const defaults = { baseBranch: 'main' }

describe('render', () => {
	it('carries the marker, so the next run updates this comment rather than adding one', () => {
		const { body } = render({ base: measurement('base'), head: measurement('head'), ...defaults })
		expect(body).toContain(MARKER)
	})

	it('blocks and says so when a tree produced no measurement', () => {
		const { body, blocking } = render({ base: null, head: measurement('head'), ...defaults })
		expect(blocking).toHaveLength(1)
		expect(body).toContain('went unmeasured')
		// The failure this whole report exists to prevent: a broken run reading
		// to the team as a clean one.
		expect(body).not.toContain('Nothing to fix here')
	})

	it('blocks when a single check produced no measurement', () => {
		const head = measurement('head', { typecheck: { ran: false, issues: [] } })
		const { body, blocking } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toEqual(['Type errors produced no measurement'])
		expect(body).toContain('did not run')
	})

	it('omits the build row while both trees build', () => {
		const { body } = render({ base: measurement('base'), head: measurement('head'), ...defaults })
		expect(body).not.toContain('| Build |')
	})

	it('names the base branch when the base branch is the one that is broken', () => {
		const base = measurement('base')
		base.build = { ran: true, ok: false, log: 'error during build' }
		const { body, blocking } = render({ base, head: measurement('head'), ...defaults })
		expect(body).toContain('repairs a build')
		expect(blocking).toHaveLength(0)
	})

	it('blames neither author when both trees fail to build', () => {
		const base = measurement('base')
		const head = measurement('head')
		base.build = { ran: true, ok: false, log: 'error during build' }
		head.build = { ran: true, ok: false, log: 'error during build' }
		const { body } = render({ base, head, ...defaults })
		expect(body).toContain('Repair the base branch first')
	})

	it('blocks on an unformatted file the pull request touched', () => {
		const head = measurement('head', {
			format: { ran: true, drifted: ['src/a.ts'], touched: ['src/a.ts'] },
		})
		const { blocking, body } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toEqual(['1 touched file(s) unformatted'])
		expect(body).toContain('pnpm format')
	})

	it('stops blocking once the drift sits outside the pull request', () => {
		const base = measurement('base', {
			format: { ran: true, drifted: ['pnpm-workspace.yaml'], touched: [] },
		})
		const head = measurement('head', {
			format: { ran: true, drifted: ['pnpm-workspace.yaml'], touched: ['src/a.ts'] },
		})
		const { blocking, body } = render({ base, head, ...defaults })
		expect(blocking).toHaveLength(0)
		expect(body).toContain("not this pull request's problem")
	})

	it('treats an absent touched-file list as a crashed step rather than an empty PR', () => {
		const head = measurement('head', { format: { ran: true, drifted: [], touched: [] } })
		const { blocking } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toEqual(['Formatting (files you touched) produced no measurement'])
	})

	it('blocks on a new type error and quotes it', () => {
		const head = measurement('head', {
			typecheck: {
				ran: true,
				issues: [
					{
						file: 'src/a.ts',
						line: 3,
						column: 1,
						message: 'error TS2322: nope',
						raw: 'src/a.ts(3,1): error TS2322: nope',
					},
				],
			},
		})
		const { blocking, body } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toEqual(['1 new type error'])
		expect(body).toContain('src/a.ts(3,1): error TS2322: nope')
	})

	it('does not block when the pull request only resolves issues', () => {
		const base = measurement('base', {
			typecheck: {
				ran: true,
				issues: [
					{ file: 'src/a.ts', line: 3, column: 1, message: 'error TS2322: nope', raw: 'x' },
				],
			},
		})
		const { blocking, body } = render({ base, head: measurement('head'), ...defaults })
		expect(blocking).toHaveLength(0)
		expect(body).toContain('1 resolved')
	})

	it('blocks on a failed deploy dry-run, which no other check would catch', () => {
		const head = measurement('head', {
			worker: { ran: true, ok: false, raw: 0, gzip: 0, log: 'binding typo' },
		})
		const { blocking } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toEqual(['the deploy dry-run failed'])
	})

	it('blocks on a failing test and lists it', () => {
		const head = measurement('head', {
			tests: { ran: true, ok: false, total: 52, failed: 1, failures: ['a > b — expected 1'] },
		})
		const { blocking, body } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toEqual(['1 failing test(s)'])
		expect(body).toContain('51/52 passed')
	})

	it('blocks when the runner exits non-zero having reported no failures', () => {
		const head = measurement('head', {
			tests: { ran: true, ok: false, total: 52, failed: 0, failures: [] },
		})
		const { blocking } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toEqual(['the test runner exited non-zero'])
	})

	it('reports a re-hashed chunk without blocking', () => {
		const head = measurement('head')
		head.checks.bundle.chunks = { 'index.js': 'bbbbbbbb' }
		head.checks.bundle.eagerJs = { raw: 1100, gzip: 460 }
		const { blocking, body } = render({ base: measurement('base'), head, ...defaults })
		expect(blocking).toHaveLength(0)
		expect(body).toContain('`index.js` re-hashed')
	})

	it('names where the eager set came from, so a fallback stays visible', () => {
		const { body } = render({ base: measurement('base'), head: measurement('head'), ...defaults })
		expect(body).toContain('Eager set read from the TanStack Start route manifest')
	})

	it('says nothing is wrong on a clean pull request, and keeps every row', () => {
		const { body, blocking } = render({
			base: measurement('base'),
			head: measurement('head'),
			...defaults,
		})
		expect(blocking).toHaveLength(0)
		expect(body).toContain('Nothing to fix here')
		for (const row of [
			'Type errors',
			'Lint',
			'Formatting',
			'Client bundle',
			'Worker bundle',
			'Test failures',
		])
			expect(body).toContain(row)
	})
})
