import { describe, expect, it } from 'vitest'

import {
	parseOxfmt,
	parseOxlint,
	parseStartManifest,
	parseTsc,
	parseVitest,
	parseWranglerUpload,
	splitHash,
} from './measurement.ts'

describe('parseTsc', () => {
	it('reads the parenthesised position tsc prints', () => {
		const issues = parseTsc(
			['src/a.ts(3,14): error TS2322: Type X is not assignable to type Y.', ''].join('\n')
		)
		expect(issues).toEqual([
			{
				file: 'src/a.ts',
				line: 3,
				column: 14,
				message: 'error TS2322: Type X is not assignable to type Y.',
				raw: 'src/a.ts(3,14): error TS2322: Type X is not assignable to type Y.',
			},
		])
	})

	it('drops the count summary, which would diff as a phantom issue every time', () => {
		expect(parseTsc('Found 12 errors in 3 files.')).toEqual([])
	})

	it('reads output that still carries colour codes', () => {
		expect(parseTsc('[96msrc/a.ts[0m(1,1): error TS1005: oops')).toHaveLength(1)
	})
})

describe('parseOxlint', () => {
	const payload = JSON.stringify({
		diagnostics: [
			{
				message: "Variable 'x' is declared but never used.",
				code: 'eslint(no-unused-vars)',
				severity: 'error',
				filename: 'ci/a.ts',
				labels: [{ span: { line: 1, column: 7 } }],
			},
			{
				message: 'suspicious',
				severity: 'warning',
				filename: 'src/b.ts',
				labels: [{ span: { line: 2, column: 1 } }],
			},
		],
	})

	it('separates errors from warnings', () => {
		const parsed = parseOxlint(payload)
		expect(parsed.errors).toHaveLength(1)
		expect(parsed.warnings).toHaveLength(1)
		expect(parsed.errors[0].raw).toBe(
			"ci/a.ts:1:7: eslint(no-unused-vars) Variable 'x' is declared but never used."
		)
	})

	it('throws when the payload has no diagnostics array', () => {
		// A renamed key read as `?? []` would turn a future oxlint release into a
		// permanently clean report.
		expect(() => parseOxlint(JSON.stringify({ problems: [] }))).toThrow()
	})
})

describe('parseOxfmt', () => {
	it('reads one path per line, in the repo-root shape the touched list uses', () => {
		expect(parseOxfmt('./src/a.ts\nsrc/b.tsx\n')).toEqual(['src/a.ts', 'src/b.tsx'])
	})
})

describe('parseVitest', () => {
	it('counts and lists failures', () => {
		const parsed = parseVitest(
			JSON.stringify({
				numTotalTests: 52,
				numFailedTests: 1,
				testResults: [
					{
						assertionResults: [
							{
								status: 'failed',
								fullName: 'a > b',
								failureMessages: ['expected 1\n at x'],
							},
							{ status: 'passed', fullName: 'a > c' },
						],
					},
				],
			})
		)
		expect(parsed).toEqual({ total: 52, failed: 1, failures: ['a > b — expected 1'] })
	})

	it('throws on a report missing its counts', () => {
		expect(() => parseVitest(JSON.stringify({ testResults: [] }))).toThrow()
	})
})

describe('parseWranglerUpload', () => {
	it('reads the figure the deploy tool reports', () => {
		expect(parseWranglerUpload('Total Upload: 1960.80 KiB / gzip: 408.30 KiB')).toEqual({
			raw: 2007859,
			gzip: 418099,
		})
	})

	it('returns null when the dry-run printed no size', () => {
		expect(parseWranglerUpload('✘ [ERROR] binding typo')).toBeNull()
	})
})

describe('splitHash', () => {
	it('pins the hash to exactly eight characters', () => {
		expect(splitHash('index-Bm1XxA3w.js')).toEqual({ key: 'index.js', hash: 'Bm1XxA3w' })
	})

	it('takes the last hash-shaped segment, so a dashed name keeps its own key', () => {
		// A pattern accepting a range of lengths would key this as `client.js`,
		// and every dashed name would then collapse onto a neighbour's key.
		expect(splitHash('client-entry-a1b2c3d4.js')).toEqual({
			key: 'client-entry.js',
			hash: 'a1b2c3d4',
		})
	})

	it('leaves an unhashed name alone', () => {
		expect(splitHash('robots.txt')).toEqual({ key: 'robots.txt', hash: null })
	})
})

describe('parseStartManifest', () => {
	const manifest = `var tsrStartManifest = () => ({ routes: {
		__root__: {
			filePath: "/runner/work/tree/src/routes/__root.tsx",
			children: ["/", "/contact"],
			preloads: ["/assets/index-Bm1XxA3w.js"],
			scripts: [{ attrs: { type: "module", async: !0, src: "/assets/index-Bm1XxA3w.js" } }]
		},
		"/contact": { preloads: ["/assets/contact-DdVRBgPm.js"] }
	} });`

	it('takes the root route alone, preloads and scripts together', () => {
		expect(parseStartManifest(manifest)).toEqual(['/assets/index-Bm1XxA3w.js'])
	})

	it('returns nothing when the manifest has no root route', () => {
		expect(parseStartManifest('export const nothing = 1')).toEqual([])
	})

	it('survives a change of whitespace, because it matches delimiters', () => {
		expect(parseStartManifest(manifest.replace(/\s+/g, ' '))).toEqual([
			'/assets/index-Bm1XxA3w.js',
		])
	})
})
