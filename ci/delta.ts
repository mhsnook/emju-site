// Pure comparison and rendering. No file system, no network, no GitHub: this is the
// half that the unit tests can drive. ci/report.ts does the I/O around it.

export type Tree = 'head' | 'base'

export type IssueList = { ran: boolean; issues: string[] }

export type Bundle = {
	ran: boolean
	source: string
	fileCount: number
	eager: { files: string[]; raw: number; gzip: number }
	entry: { file: string; raw: number; gzip: number } | null
	css: { files: string[]; raw: number; gzip: number }
	routes: Record<string, { raw: number; gzip: number }>
	chunks: Record<string, { hash: string; raw: number; gzip: number }>
	worker: { raw: number; gzip: number } | null
}

export type Measurement = {
	tree: Tree
	sha: string
	build: { ran: boolean; ok: boolean; log: string }
	checks: {
		typecheck: IssueList
		lint: { ran: boolean; issues: string[]; warnings: string[] }
		format: { ran: boolean; drifted: string[]; touched: string[] | null }
		bundle: Bundle
		deploy: { ran: boolean; ok: boolean; log: string }
		tests: { ran: boolean; total: number; failed: number; failures: string[] } | null
	}
}

export type Policy = 'must-pass' | 'no-new' | 'touched-clean' | 'report-only'

// One rule per check, kept as data so loosening one during a migration is a one-line edit.
export const POLICY = {
	build: 'must-pass',
	typecheck: 'no-new',
	lint: 'no-new',
	format: 'touched-clean',
	bundle: 'report-only',
	deploy: 'must-pass',
	tests: 'must-pass',
} satisfies Record<string, Policy>

// An unrelated edit above an existing error bumps its line number. Pair those instead of
// counting one new plus one resolved.
export const PROXIMITY = 10

// Deltas below this are two builds of the same commit disagreeing with themselves.
export const BUNDLE_NOISE_BYTES = 500

export const MARKER = '<!-- ci-delta:pr-checks -->'

const LIST_CAP = 20

export type Issue = { file: string; line: number; column: number; message: string }

export function parseIssue(text: string): Issue | null {
	const match = /^(.+?):(\d+):(\d+): (.*)$/.exec(text)
	if (!match) return null
	return {
		file: match[1]!,
		line: Number(match[2]),
		column: Number(match[3]),
		message: match[4]!,
	}
}

export type IssueDelta = { added: string[]; resolved: string[]; shifted: number }

/**
 * Membership uses the issue's full position; pairing uses its kind. Using one key for both
 * makes the pairing step unreachable and the shifted count permanently zero.
 */
export function diffIssues(base: string[], head: string[], proximity = PROXIMITY): IssueDelta {
	const place = (text: string) => text
	const basePlaces = new Set(base.map(place))
	const headPlaces = new Set(head.map(place))

	const resolved = base.filter((text) => !headPlaces.has(place(text)))
	const added = head.filter((text) => !basePlaces.has(place(text)))

	const kind = (issue: Issue) => `${issue.file} || ${issue.message}`
	const consumed = new Set<number>()
	const stillAdded: string[] = []
	let shifted = 0

	for (const text of added) {
		const candidate = parseIssue(text)
		let pairedAt = -1
		if (candidate) {
			pairedAt = resolved.findIndex((other, index) => {
				if (consumed.has(index)) return false
				const parsed = parseIssue(other)
				if (!parsed) return false
				return (
					kind(parsed) === kind(candidate) &&
					Math.abs(parsed.line - candidate.line) <= proximity
				)
			})
		}
		if (pairedAt === -1) stillAdded.push(text)
		else {
			// One-to-one, so consume as we go: ten errors in a moved block must not all pair
			// with the same resolved issue.
			consumed.add(pairedAt)
			shifted += 1
		}
	}

	return {
		added: stillAdded,
		resolved: resolved.filter((_, index) => !consumed.has(index)),
		shifted,
	}
}

export function diffPaths(base: string[], head: string[]) {
	const baseSet = new Set(base)
	const headSet = new Set(head)
	return {
		added: head.filter((path) => !baseSet.has(path)),
		resolved: base.filter((path) => !headSet.has(path)),
	}
}

export function byteOrder(a: string, b: string) {
	return a < b ? -1 : a > b ? 1 : 0
}

export function kilobytes(bytes: number) {
	return `${(bytes / 1000).toFixed(1)} kB`
}

function signed(value: number) {
	if (value === 0) return '0'
	return value > 0 ? `+${value}` : `−${Math.abs(value)}`
}

function signedBytes(value: number) {
	if (value === 0) return 'unchanged'
	const sign = value > 0 ? '+' : '−'
	return `${sign}${kilobytes(Math.abs(value))}`
}

function extensionTally(paths: string[]) {
	const counts = new Map<string, number>()
	for (const path of paths) {
		const extension = path.includes('.') ? `.${path.split('.').pop()}` : '(none)'
		counts.set(extension, (counts.get(extension) ?? 0) + 1)
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || byteOrder(a[0], b[0]))
		.map(([extension, count]) => `\`${extension}\` ${count}`)
		.join(' · ')
}

function capped(items: string[]) {
	if (items.length <= LIST_CAP) return items
	return [...items.slice(0, LIST_CAP), `… and ${items.length - LIST_CAP} more`]
}

function bullet(lines: string[]) {
	return lines.map((line) => `  - ${line}`).join('\n')
}

function firstErrorExcerpt(log: string) {
	const lines = log.split('\n')
	// Anchor on words a passing build does not print. A successful vite build prints
	// plugin names and "[vite]" too, so those are not evidence of a failure.
	const start = lines.findIndex((line) => /error|Error:|ERR_|failed|Failed/.test(line))
	const from = start === -1 ? Math.max(0, lines.length - 12) : start
	return lines
		.slice(from, from + 12)
		.join('\n')
		.trim()
}

type Row = { check: string; delta: string; status: '✅' | '❌' | '⚠️' }

type Section = { row: Row; detail: string[]; blocking: string[] }

const PASS = '✅'
const FAIL = '❌'
const WARN = '⚠️'

function notMeasured(check: string, which: string): Section {
	return {
		row: { check, delta: '?', status: FAIL },
		detail: [`- **${check}** — ${which} was not measured, so this check did not run.`],
		blocking: [`${check}: ${which} was not measured`],
	}
}

function buildSection(head: Measurement, base: Measurement): Section | null {
	const headOk = head.build.ran && head.build.ok
	const baseOk = base.build.ran && base.build.ok
	// Say nothing while both trees build.
	if (headOk && baseOk) return null

	if (!headOk && !baseOk) {
		return {
			row: { check: 'Build', delta: 'inherited', status: FAIL },
			detail: [
				'- **Build** — `main` does not build either. Repair the base branch first; ' +
					'nothing else in this report can be trusted until it builds.',
				'',
				'```',
				firstErrorExcerpt(head.build.log),
				'```',
			],
			blocking: ['Build: the base branch is already broken'],
		}
	}
	if (!headOk) {
		return {
			row: { check: 'Build', delta: 'broken', status: FAIL },
			detail: [
				'- **Build** — this PR breaks the build.',
				'',
				'```',
				firstErrorExcerpt(head.build.log),
				'```',
			],
			blocking: ['Build: this PR breaks the build'],
		}
	}
	return {
		row: { check: 'Build', delta: 'fixed', status: PASS },
		detail: ['- **Build** — this PR repairs a build that was broken on `main`.'],
		blocking: [],
	}
}

function issueSection(
	check: string,
	baseSide: IssueList,
	headSide: IssueList,
	policy: Policy
): Section {
	if (!baseSide.ran) return notMeasured(check, '`main`')
	if (!headSide.ran) return notMeasured(check, 'this PR')

	const delta = diffIssues(baseSide.issues, headSide.issues)
	const blocks = policy === 'no-new' && delta.added.length > 0
	const summary =
		`${baseSide.issues.length} on \`main\` → ${headSide.issues.length} here` +
		(delta.resolved.length ? ` · ${delta.resolved.length} resolved` : '') +
		(delta.shifted ? ` · ${delta.shifted} shifted, not counted` : '')

	const detail = [
		delta.added.length
			? `- **${check}** — ${delta.added.length} new · ${summary}`
			: `- **${check}** — no new issues. ${summary}`,
	]
	if (delta.added.length) detail.push(bullet(capped(delta.added).map((line) => `\`${line}\``)))

	return {
		row: {
			check,
			delta: signed(headSide.issues.length - baseSide.issues.length),
			status: blocks ? FAIL : delta.added.length ? WARN : PASS,
		},
		detail,
		blocking: blocks ? [`${check}: ${delta.added.length} new`] : [],
	}
}

function formatSection(head: Measurement, base: Measurement): Section {
	const headSide = head.checks.format
	const baseSide = base.checks.format
	if (!baseSide.ran) return notMeasured('Formatting', '`main`')
	if (!headSide.ran) return notMeasured('Formatting', 'this PR')
	// An absent touched-file list is a crashed step, not an empty PR.
	if (!headSide.touched) return notMeasured('Formatting', "this PR's file list")

	const touched = new Set(headSide.touched)
	const guilty = headSide.drifted.filter((path) => touched.has(path)).sort(byteOrder)
	const rest = headSide.drifted.filter((path) => !touched.has(path))
	const trend = headSide.drifted.length - baseSide.drifted.length

	const detail: string[] = []
	if (guilty.length) {
		detail.push(
			`- **Formatting** — ${guilty.length} file${guilty.length === 1 ? '' : 's'} this PR ` +
				'touches ' +
				(guilty.length === 1 ? 'is' : 'are') +
				' unformatted. Run `pnpm format` and commit; a file you edited ships formatted.'
		)
		detail.push(bullet(capped(guilty).map((path) => `\`${path}\``)))
	} else {
		detail.push('- **Formatting** — every file this PR touches is formatted.')
	}
	if (rest.length) {
		detail.push(
			bullet([
				`${rest.length} other unformatted file${rest.length === 1 ? '' : 's'} ` +
					`${rest.length === 1 ? 'is' : 'are'} not this PR's problem and block${rest.length === 1 ? 's' : ''} nothing: ` +
					`${extensionTally(rest)}`,
				`Unformatted files in the whole tree: ${baseSide.drifted.length} on \`main\` → ` +
					`${headSide.drifted.length} here${trend === 0 ? '' : ` (${signed(trend)})`}`,
			])
		)
	}

	return {
		row: {
			check: 'Formatting (files you touched)',
			delta: signed(guilty.length),
			status: guilty.length ? FAIL : PASS,
		},
		detail,
		blocking: guilty.length ? [`Formatting: ${guilty.length} touched file(s) unformatted`] : [],
	}
}

function bundleSection(head: Measurement, base: Measurement): Section {
	const headSide = head.checks.bundle
	const baseSide = base.checks.bundle
	if (!baseSide.ran || baseSide.fileCount === 0) return notMeasured('Bundle size', '`main`')
	if (!headSide.ran || headSide.fileCount === 0) return notMeasured('Bundle size', 'this PR')

	const eagerDelta = headSide.eager.gzip - baseSide.eager.gzip
	const cssDelta = headSide.css.gzip - baseSide.css.gzip
	const percent = baseSide.eager.gzip === 0 ? 0 : (eagerDelta / baseSide.eager.gzip) * 100

	const detail = [
		`- **Bundle size** — eager JS ${kilobytes(baseSide.eager.gzip)} → ` +
			`${kilobytes(headSide.eager.gzip)} gzipped · CSS ${signedBytes(cssDelta)} ` +
			`(${kilobytes(headSide.css.gzip)}) · eager set read from ${headSide.source}`,
	]

	const routes = [...new Set([...Object.keys(baseSide.routes), ...Object.keys(headSide.routes)])]
		.sort(byteOrder)
		.map((route) => {
			const before = baseSide.routes[route]
			const after = headSide.routes[route]
			if (!before) return `\`${route}\` is new · ${kilobytes(after!.gzip)} gzipped`
			if (!after) return `\`${route}\` is gone`
			return `\`${route}\` first paint ${kilobytes(after.gzip)} gzipped · ${signedBytes(after.gzip - before.gzip)}`
		})
	detail.push(bullet(capped(routes)))

	// Compare the union, so a chunk that appeared or vanished is visible.
	const names = [...new Set([...Object.keys(baseSide.chunks), ...Object.keys(headSide.chunks)])]
	const rehashed = names
		.filter((name) => baseSide.chunks[name]?.hash !== headSide.chunks[name]?.hash)
		.sort(byteOrder)
	const stable = names.length - rehashed.length
	if (rehashed.length) {
		detail.push(
			bullet([
				`${rehashed.length} chunk${rehashed.length === 1 ? '' : 's'} re-hashed, so returning ` +
					`visitors fetch ${rehashed.length === 1 ? 'it' : 'them'} again: ` +
					capped(rehashed.map((name) => `\`${name}\``)).join(', '),
				`${stable} chunk${stable === 1 ? '' : 's'} keep their hash and stay cached`,
			])
		)
	} else
		detail.push(bullet(['every chunk keeps its hash, so returning visitors re-fetch nothing']))

	if (headSide.worker && baseSide.worker) {
		detail.push(
			bullet([
				`Worker upload ${kilobytes(baseSide.worker.gzip)} → ` +
					`${kilobytes(headSide.worker.gzip)} gzipped, as \`wrangler deploy --dry-run\` counts it`,
			])
		)
	}

	return {
		row: {
			check: 'Bundle size',
			delta: `${percent >= 0 ? '+' : '−'}${Math.abs(percent).toFixed(1)}%`,
			status: Math.abs(eagerDelta) > BUNDLE_NOISE_BYTES ? WARN : PASS,
		},
		detail,
		blocking: [],
	}
}

function testSection(head: Measurement): Section {
	const tests = head.checks.tests
	if (!tests || !tests.ran) return notMeasured('Test failures', 'the test run')
	const detail = [
		tests.failed === 0
			? `- **Tests** — ${tests.total}/${tests.total} passed`
			: `- **Tests** — ${tests.failed} of ${tests.total} failed`,
	]
	if (tests.failed > 0) detail.push(bullet(capped(tests.failures)))
	return {
		row: {
			check: 'Test failures',
			delta: signed(tests.failed),
			status: tests.failed ? FAIL : PASS,
		},
		detail,
		blocking: tests.failed ? [`Tests: ${tests.failed} failing`] : [],
	}
}

function deploySection(head: Measurement): Section {
	const deploy = head.checks.deploy
	if (!deploy.ran) return notMeasured('Deploy dry-run', 'this PR')
	if (deploy.ok) {
		return {
			row: { check: 'Deploy dry-run', delta: 'ok', status: PASS },
			detail: [
				'- **Deploy dry-run** — `wrangler deploy --dry-run` bundles the Worker and resolves ' +
					'every binding. A binding typo passes every other check here.',
			],
			blocking: [],
		}
	}
	return {
		row: { check: 'Deploy dry-run', delta: 'failed', status: FAIL },
		detail: [
			'- **Deploy dry-run** — `wrangler deploy --dry-run` failed.',
			'',
			'```',
			firstErrorExcerpt(deploy.log),
			'```',
		],
		blocking: ['Deploy dry-run: failed'],
	}
}

export type Report = { body: string; blocking: string[] }

export function renderReport(input: {
	head: Measurement | null
	base: Measurement | null
	baseRef: string
}): Report {
	const { head, base, baseRef } = input

	if (!head || !base) {
		const missing = !head && !base ? 'neither tree' : !head ? 'this PR' : `\`${baseRef}\``
		return {
			body:
				`${MARKER}\n### PR checks\n_Compared against \`${baseRef}\`._\n\n` +
				`${FAIL} **No measurement from ${missing}.** A job died before it wrote one, so ` +
				'nothing here is "no change" — it is unknown. Check the job logs.\n',
			blocking: ['A tree was not measured'],
		}
	}

	const sections: Section[] = []
	const build = buildSection(head, base)
	if (build) sections.push(build)
	sections.push(
		issueSection('Type errors', base.checks.typecheck, head.checks.typecheck, POLICY.typecheck)
	)
	sections.push(
		issueSection(
			'Lint',
			{ ran: base.checks.lint.ran, issues: base.checks.lint.issues },
			{ ran: head.checks.lint.ran, issues: head.checks.lint.issues },
			POLICY.lint
		)
	)
	sections.push(formatSection(head, base))
	sections.push(bundleSection(head, base))
	sections.push(testSection(head))
	sections.push(deploySection(head))

	const blocking = sections.flatMap((section) => section.blocking)
	const failing = sections.filter((section) => section.row.status === FAIL).length

	const headline =
		failing === 0
			? `${PASS} **Nothing this PR adds is blocking.**`
			: `${FAIL} **${failing} check${failing === 1 ? '' : 's'} failing**`

	const table = [
		'| Check | Delta | Status |',
		'|---|---|---|',
		...sections.map(
			(section) => `| ${section.row.check} | ${section.row.delta} | ${section.row.status} |`
		),
	]

	const warnings = head.checks.lint.warnings.length
	const notes = [
		warnings
			? `_${warnings} lint warning${warnings === 1 ? '' : 's'} on this PR are reported, not gated._`
			: '',
		'_A renamed file reads as every issue in it resolved and the same issues added again._',
	].filter(Boolean)

	const body = [
		MARKER,
		'### PR checks',
		`_Compared against \`${baseRef}\`._`,
		'',
		headline,
		'',
		...table,
		'',
		'**Details**',
		'',
		...sections.map((section) => section.detail.join('\n')),
		'',
		...notes,
		'',
	].join('\n')

	return { body, blocking }
}
