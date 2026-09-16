/**
 * Turning two measurements into one comment and one verdict.
 *
 * Pure: no API calls, no filesystem. `report.ts` handles the GitHub side.
 *
 * Each check yields three separate things — a table row, a detail entry and a
 * verdict against its policy. Keeping them apart is what lets the comment stay
 * short while the gate stays strict.
 */

import { diffIssues, diffPaths, type Issue } from './delta.ts'
import type { Measurement } from './measurement.ts'
import { type CheckId, ORDER, POLICY, TITLES } from './policy.ts'

/** Matched on to update the comment in place. Never the visible heading: */
/** rewording a heading would orphan every comment already on an open PR. */
export const MARKER = '<!-- ci-delta:pr-checks -->'

/** Platforms reject a body over roughly 65,000 characters. */
const BODY_LIMIT = 60000
const LIST_CAP = 20

type Status = 'pass' | 'fail' | 'moved' | 'unmeasured'

type Row = {
	id: CheckId
	delta: string
	status: Status
	/** Present only when this check blocks. */
	blocks?: string
	detail: string[]
	/** Rows that say nothing are dropped from the table. */
	omit?: boolean
}

const ICON: Record<Status, string> = {
	pass: '✅',
	fail: '❌',
	moved: '⚠️',
	unmeasured: '🚫',
}

export type Rendered = { body: string; blocking: string[] }

export function render(input: {
	base: Measurement | null
	head: Measurement | null
	baseBranch: string
}): Rendered {
	const { base, head, baseBranch } = input

	// A tree whose job died leaves no measurement at all, so a rule that
	// inspects measurements would not see it. Name the absence instead.
	if (!head || !base) {
		const missing = [!head ? 'head' : null, !base ? 'base' : null].filter(Boolean).join(' and ')
		const body = [
			MARKER,
			'### PR checks',
			`_Compared against \`${baseBranch}\`._`,
			'',
			`🚫 **The ${missing} tree went unmeasured.** That is a broken run, not a clean one.`,
			'Open the job logs and re-run. Nothing below this line was checked.',
		].join('\n')
		return { body, blocking: [`${missing} tree produced no measurement`] }
	}

	// One place decides what blocks, so switching a check to report-only during a
	// migration is a one-line edit in policy.ts rather than a hunt through here.
	const rows = ORDER.map((id) => {
		const row = rowFor(id, base, head)
		if (POLICY[row.id] === 'report-only' && row.status !== 'unmeasured') {
			row.blocks = undefined
			if (row.status === 'fail') row.status = 'moved'
		}
		return row
	})
	const blocking = rows.flatMap((row) => (row.blocks ? [row.blocks] : []))

	const shown = rows.filter((row) => !row.omit)
	const failing = shown.filter(
		(row) => row.status === 'fail' || row.status === 'unmeasured'
	).length

	const header =
		failing === 0
			? '✅ **Nothing to fix here.**'
			: `❌ **${failing} ${failing === 1 ? 'check' : 'checks'} failing**`

	const table = [
		'| Check | Delta | Status |',
		'| --- | --- | --- |',
		...shown.map((row) => `| ${TITLES[row.id]} | ${row.delta} | ${ICON[row.status]} |`),
	]

	const details = shown.flatMap((row) => row.detail)

	let body = [
		MARKER,
		'### PR checks',
		`_Compared against \`${baseBranch}\`. Renaming a file makes every issue in it read as new, and every issue at its old path as resolved._`,
		'',
		header,
		'',
		...table,
		'',
		'**Details**',
		'',
		...details,
	].join('\n')

	if (body.length > BODY_LIMIT)
		body = `${body.slice(0, BODY_LIMIT)}\n\n_Comment truncated. The job log has the rest._`

	return { body, blocking }
}

// ---------------------------------------------------------------------------

function rowFor(id: CheckId, base: Measurement, head: Measurement): Row {
	switch (id) {
		case 'build':
			return buildRow(base, head)
		case 'typecheck':
			return issueRow(id, base.checks.typecheck, head.checks.typecheck, 'type error')
		case 'lint':
			return lintRow(base, head)
		case 'format':
			return formatRow(base, head)
		case 'bundle':
			return bundleRow(base, head)
		case 'worker':
			return workerRow(base, head)
		case 'tests':
			return testsRow(head)
	}
}

/**
 * The build row appears only when it has something to say.
 *
 * A bot that reports success on every green pull request teaches the team to
 * skim past it, which costs the one time it reports a failure.
 */
function buildRow(base: Measurement, head: Measurement): Row {
	const both = base.build.ran && head.build.ran
	if (both && base.build.ok && head.build.ok)
		return { id: 'build', delta: '0', status: 'pass', detail: [], omit: true }

	if (!both)
		return {
			id: 'build',
			delta: '—',
			status: 'unmeasured',
			blocks: 'the build did not run on one of the trees',
			detail: [
				'- **Build** — one tree never ran its build, so nothing below it is trustworthy.',
			],
		}

	if (!head.build.ok && !base.build.ok)
		return {
			id: 'build',
			delta: '—',
			status: 'fail',
			blocks: 'the build fails on both trees',
			detail: [
				`- **Build** — \`${head.tree === 'head' ? 'this branch' : ''}\` and the base branch both fail to build. Repair the base branch first; this pull request did not cause it.`,
				fence(head.build.log),
			],
		}

	if (!head.build.ok)
		return {
			id: 'build',
			delta: '—',
			status: 'fail',
			blocks: 'the build fails on this branch',
			detail: ['- **Build** — this pull request breaks the build.', fence(head.build.log)],
		}

	return {
		id: 'build',
		delta: '—',
		status: 'pass',
		detail: [
			'- **Build** — this pull request repairs a build that was broken on the base branch.',
		],
	}
}

function issueRow(
	id: CheckId,
	base: { ran: boolean; issues: Issue[] },
	head: { ran: boolean; issues: Issue[] },
	noun: string
): Row {
	if (!base.ran || !head.ran) return unmeasured(id)

	const delta = diffIssues(base.issues, head.issues)
	const net = delta.headTotal - delta.baseTotal
	const blocks = delta.added.length > 0

	const counts = [
		`${delta.baseTotal} on the base branch → ${delta.headTotal} here`,
		delta.resolved.length > 0 ? `${delta.resolved.length} resolved` : null,
		delta.shifted > 0 ? `${delta.shifted} shifted, not counted` : null,
	]
		.filter(Boolean)
		.join(' · ')

	const detail = [
		delta.added.length === 0
			? `- **${TITLES[id]}** — no new ${noun}s. ${counts}`
			: `- **${TITLES[id]}** — ${delta.added.length} new ${noun}${delta.added.length === 1 ? '' : 's'}. ${counts}`,
		...capped(delta.added.map((issue) => `  - \`${issue.raw}\``)),
	]

	return {
		id,
		delta: signed(net),
		status: blocks ? 'fail' : 'pass',
		blocks: blocks
			? `${delta.added.length} new ${noun}${delta.added.length === 1 ? '' : 's'}`
			: undefined,
		detail,
	}
}

function lintRow(base: Measurement, head: Measurement): Row {
	const row = issueRow(
		'lint',
		{ ran: base.checks.lint.ran, issues: base.checks.lint.issues },
		{ ran: head.checks.lint.ran, issues: head.checks.lint.issues },
		'lint error'
	)
	if (row.status === 'unmeasured') return row

	const warnings = diffIssues(base.checks.lint.warnings, head.checks.lint.warnings)
	const net = warnings.headTotal - warnings.baseTotal
	row.detail.push(
		`  - Warnings (report-only): ${warnings.baseTotal} → ${warnings.headTotal}${net === 0 ? '' : `, ${signed(net)}`}`,
		...capped(
			warnings.added.map((issue) => `    - \`${issue.raw}\``),
			5
		)
	)
	if (row.status === 'pass' && net > 0) row.status = 'moved'
	return row
}

/**
 * The formatter gate takes the intersection of the pull request's own file list
 * with the drift list, and blocks on anything in both — new drift or not. A
 * file the author touched ships formatted; a file they left alone is somebody
 * else's problem and blocks nothing.
 *
 * Both lists are repo-root-relative with no `./` prefix. If they disagreed on
 * that shape the intersection would be empty on every pull request and the gate
 * would silently stop firing.
 */
function formatRow(base: Measurement, head: Measurement): Row {
	const format = head.checks.format
	if (!base.checks.format.ran || !format.ran) return unmeasured('format')

	// An absent touched-file list is a crashed step, not an empty pull request.
	if (format.touched.length === 0) {
		const row = unmeasured('format')
		row.detail = [
			'- **Formatting** — no list of touched files reached the report job. That is a crashed step; the gate cannot run.',
		]
		return row
	}

	const touched = new Set(format.touched)
	const offenders = format.drifted.filter((path) => touched.has(path))
	const rest = format.drifted.filter((path) => !touched.has(path))
	// The trend line is about the files nobody here touched, so compare like
	// with like: count the base branch's drift outside this pull request too.
	const baseRest = base.checks.format.drifted.filter((path) => !touched.has(path))
	const delta = diffPaths(baseRest, rest)
	const trend = delta.headTotal - delta.baseTotal

	const byExtension = new Map<string, number>()
	for (const path of rest) {
		const extension = path.includes('.') ? `.${path.split('.').pop()}` : '(no extension)'
		byExtension.set(extension, (byExtension.get(extension) ?? 0) + 1)
	}
	const breakdown = [...byExtension.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([extension, count]) => `\`${extension}\` ${count}`)
		.join(' · ')

	const detail = [
		offenders.length === 0
			? '- **Formatting** — every file this pull request touches is formatted.'
			: `- **Formatting** — ${offenders.length} file${offenders.length === 1 ? '' : 's'} this pull request touches ${offenders.length === 1 ? 'is' : 'are'} unformatted. Run \`pnpm format\` and commit.`,
		...capped(offenders.map((path) => `  - \`${path}\``)),
	]
	if (rest.length > 0)
		detail.push(
			`  - ${rest.length} other unformatted file${rest.length === 1 ? '' : 's'} ${rest.length === 1 ? 'is' : 'are'} not this pull request's problem, and block${rest.length === 1 ? 's' : ''} nothing: ${breakdown}${trend === 0 ? '' : ` — ${trend < 0 ? 'down' : 'up'} from ${delta.baseTotal}`}`
		)

	return {
		id: 'format',
		delta: signed(offenders.length, { zero: '0' }),
		status: offenders.length === 0 ? 'pass' : 'fail',
		blocks: offenders.length > 0 ? `${offenders.length} touched file(s) unformatted` : undefined,
		detail,
	}
}

function bundleRow(base: Measurement, head: Measurement): Row {
	if (!base.checks.bundle.ran || !head.checks.bundle.ran) return unmeasured('bundle')
	const b = base.checks.bundle
	const h = head.checks.bundle

	// Two builds of the same commit differ by a few hundred bytes, so a move
	// smaller than that is noise rather than news.
	const NOISE = 512
	const moved = Math.abs(h.eagerJs.gzip + h.css.gzip - b.eagerJs.gzip - b.css.gzip) >= NOISE

	// Compare the union of both trees' chunk keys: the intersection cannot show
	// a chunk that appeared or disappeared, which is the largest thing that
	// happens on this axis.
	const keys = [...new Set([...Object.keys(b.chunks), ...Object.keys(h.chunks)])].sort()
	const rehashed = keys.filter((key) => b.chunks[key] !== h.chunks[key])

	const detail = [
		`- **Client bundle** — eager JS ${kb(b.eagerJs.gzip)} → ${kb(h.eagerJs.gzip)} gzipped · CSS ${kb(b.css.gzip)} → ${kb(h.css.gzip)} gzipped · ${h.lazyJs.count} lazy chunk${h.lazyJs.count === 1 ? '' : 's'}, ${kb(h.lazyJs.gzip)} gzipped`,
		`  - Eager set read from ${h.source}.`,
		rehashed.length === 0
			? `  - No output file changed its content hash, so every returning visitor keeps its cache.`
			: `  - ${rehashed.length} of ${keys.length} output files changed, so returning visitors fetch ${rehashed.length === 1 ? 'it' : 'them'} again:`,
		...capped(
			rehashed.map((key) => {
				if (!b.chunks[key]) return `    - \`${key}\` is new`
				if (!h.chunks[key]) return `    - \`${key}\` is gone`
				return `    - \`${key}\` re-hashed`
			})
		),
	]

	return {
		id: 'bundle',
		delta: percent(b.eagerJs.gzip + b.css.gzip, h.eagerJs.gzip + h.css.gzip),
		// Report-only, so it never blocks. ⚠️ says "this moved, go and look".
		status: moved ? 'moved' : 'pass',
		detail,
	}
}

function workerRow(base: Measurement, head: Measurement): Row {
	const h = head.checks.worker
	if (!h.ran) {
		const row = unmeasured('worker')
		row.detail = [
			'- **Worker bundle** — `wrangler deploy --dry-run` produced no size. Treat that as a failed dry-run.',
		]
		return row
	}
	if (!h.ok)
		return {
			id: 'worker',
			delta: '—',
			status: 'fail',
			blocks: 'the deploy dry-run failed',
			detail: [
				'- **Worker bundle** — `wrangler deploy --dry-run` failed. It is the only check that reads `wrangler.jsonc` and its bindings, so a binding typo passes everything else in this report.',
				fence(h.log),
			],
		}

	const b = base.checks.worker
	const delta = b.ran ? h.gzip - b.gzip : 0
	const moved = Math.abs(delta) >= 512
	return {
		id: 'worker',
		delta: b.ran ? percent(b.gzip, h.gzip) : 'n/a',
		status: moved ? 'moved' : 'pass',
		detail: [
			b.ran
				? `- **Worker bundle** — dry-run upload ${kb(b.gzip)} → ${kb(h.gzip)} gzipped (${kb(h.raw)} raw). Cloudflare's limit is 3 MiB gzipped on the free plan and 10 MiB on paid; check the current figure before you rely on it.`
				: `- **Worker bundle** — dry-run upload ${kb(h.gzip)} gzipped. The base branch produced no figure to compare against.`,
		],
	}
}

/**
 * Tests read head alone. A test passes here or it does not, and the base branch
 * offers nothing to compare against, so a delta framing would only confuse.
 */
function testsRow(head: Measurement): Row {
	const tests = head.checks.tests
	if (!tests.ran) {
		const row = unmeasured('tests')
		row.detail = ['- **Tests** — the runner wrote no report the parser could read.']
		return row
	}
	// The runner's own exit code, not the report's contents: a crashed runner
	// can leave a report that parses perfectly and counts zero failures.
	if (!tests.ok || tests.failed > 0)
		return {
			id: 'tests',
			delta: String(tests.failed),
			status: 'fail',
			blocks:
				tests.failed > 0
					? `${tests.failed} failing test(s)`
					: 'the test runner exited non-zero',
			detail: [
				`- **Tests** — ${tests.total - tests.failed}/${tests.total} passed.`,
				...capped(tests.failures.map((failure) => `  - ${failure}`)),
			],
		}

	return {
		id: 'tests',
		delta: '0',
		status: 'pass',
		detail: [`- **Tests** — ${tests.total}/${tests.total} passed.`],
	}
}

// ---------------------------------------------------------------------------

/**
 * A check that measured nothing gets a row of its own. An absent row and a
 * passing row look alike at a glance, and that resemblance is the failure this
 * whole report exists to prevent.
 */
function unmeasured(id: CheckId): Row {
	return {
		id,
		delta: '—',
		status: 'unmeasured',
		blocks: `${TITLES[id]} produced no measurement`,
		detail: [
			`- **${TITLES[id]}** — the check did not run. That is not "no change"; the tool failed or wrote nothing the parser could read.`,
		],
	}
}

function capped(lines: string[], cap = LIST_CAP): string[] {
	if (lines.length <= cap) return lines
	return [...lines.slice(0, cap), `  - …and ${lines.length - cap} more; the job log has the rest.`]
}

function signed(value: number, options: { zero?: string } = {}): string {
	if (value === 0) return options.zero ?? '0'
	return value > 0 ? `+${value}` : `−${Math.abs(value)}`
}

function percent(before: number, after: number): string {
	if (before === 0) return after === 0 ? '0' : 'new'
	const change = ((after - before) / before) * 100
	if (Math.abs(after - before) < 1) return '0'
	return `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}%`
}

function kb(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)} kB`
}

function fence(text: string): string {
	return ['', '  ```', ...text.split('\n').map((line) => `  ${line}`), '  ```'].join('\n')
}
