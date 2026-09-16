/**
 * Pure comparison and rendering. No network, no filesystem, no environment:
 * everything here is a function of the two measurements, so it is testable in
 * the repo's own vitest suite.
 */

import type { Issue, TreeMeasurement } from './types.ts'

/** An unrelated edit above an existing error moves its line number. Pair the
 * two within this many lines so the move does not read as one new issue plus
 * one resolved one. */
export const PROXIMITY = 10

/** Two builds of the same commit differ by a few hundred bytes. Below this,
 * on gzipped totals, a size change is noise. */
export const SIZE_NOISE_BYTES = 500

export const MARKER = '<!-- ci-delta:pr-checks -->'

/** Cloudflare rejects a Worker upload over 3 MB gzipped on the free plan. */
export const WORKER_LIMIT_BYTES = 3 * 1024 * 1024

const MAX_ITEMS = 10

export type Status = 'pass' | 'fail' | 'warn'

export type Section = {
	/** Fixes the order of both the table row and its detail entry, so jobs
	 * finishing out of order still render the same report. */
	order: number
	label: string
	delta: string
	status: Status
	detail: string[]
	/** Non-null when this check blocks the merge; the text is the reason. */
	blocking: string | null
}

export type Report = {
	body: string
	blocking: string[]
}

// --- issue deltas ---------------------------------------------------------

export type IssueDelta = {
	added: Issue[]
	resolved: Issue[]
	shifted: number
}

/** Where an issue is: the location that makes two findings the same finding. */
const place = (issue: Issue) =>
	`${issue.file}\u0000${issue.line}\u0000${issue.column}\u0000${issue.message}`

/** What an issue is, with its position dropped, so a finding that only slid up
 * or down the file can still be recognised. */
const kind = (issue: Issue) => `${issue.file}\u0000${issue.message}`

/**
 * Set difference by place, then one-to-one pairing of what is left by kind,
 * within PROXIMITY lines.
 *
 * The two keys have to be different. Compare by kind alone and a finding that
 * moved never appears on either list, so nothing is ever paired and a finding
 * that moved 400 lines — a different finding, in practice — cancels silently.
 * Compare by place alone and inserting one line above ten errors reports ten
 * new issues and ten resolved ones.
 */
export function diffIssues(base: Issue[], head: Issue[]): IssueDelta {
	const headPlaces = new Set(head.map(place))
	const basePlaces = new Set(base.map(place))
	const added = head.filter((issue) => !basePlaces.has(place(issue)))
	const resolved = base.filter((issue) => !headPlaces.has(place(issue)))

	let shifted = 0
	const takenAdded = new Set<number>()
	const survivingResolved: Issue[] = []
	for (const r of resolved) {
		const match = added.findIndex(
			(a, i) =>
				!takenAdded.has(i) && kind(a) === kind(r) && Math.abs(a.line - r.line) <= PROXIMITY
		)
		if (match === -1) survivingResolved.push(r)
		else {
			takenAdded.add(match)
			shifted++
		}
	}

	return {
		added: added.filter((_, i) => !takenAdded.has(i)),
		resolved: survivingResolved,
		shifted,
	}
}

export const formatIssue = (issue: Issue) =>
	`${issue.file}(${issue.line},${issue.column}): ${issue.message}`

// --- rendering helpers ----------------------------------------------------

const ICON: Record<Status, string> = { pass: '✅', fail: '❌', warn: '⚠️' }

const signed = (n: number) => (n > 0 ? `+${n}` : n === 0 ? '0' : `${n}`)

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`

const percent = (from: number, to: number) => {
	if (from === 0) return to === 0 ? '0.0%' : 'new'
	const pct = ((to - from) / from) * 100
	return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

const capped = (items: string[]) => {
	const shown = items.slice(0, MAX_ITEMS).map((item) => `  - \`${item}\``)
	if (items.length > MAX_ITEMS) shown.push(`  - …and ${items.length - MAX_ITEMS} more`)
	return shown
}

/** A tree that was not measured is not a clean tree. */
const notMeasured = (order: number, label: string, which: string): Section => ({
	order,
	label,
	delta: '—',
	status: 'fail',
	detail: [
		`- **${label}** — ${which} produced no measurement, so this check blocks rather than passing.`,
	],
	blocking: `${label}: ${which} produced no measurement`,
})

// --- the checks -----------------------------------------------------------

function buildSection(head: TreeMeasurement, base: TreeMeasurement): Section | null {
	// Say nothing while both trees build.
	if (head.build.ok && base.build.ok) return null

	if (!head.build.ok && !base.build.ok)
		return {
			order: 0,
			label: 'Build',
			delta: '—',
			status: 'fail',
			detail: [
				`- **Build** — \`${base.tree}\` is already broken, so this is not your PR's doing. Repair \`main\` first.`,
				...capped(base.build.firstError),
			],
			blocking: 'Build: the base branch is broken',
		}

	if (!head.build.ok)
		return {
			order: 0,
			label: 'Build',
			delta: '—',
			status: 'fail',
			detail: ['- **Build** — this PR breaks the build.', ...capped(head.build.firstError)],
			blocking: 'Build: this PR does not build',
		}

	return {
		order: 0,
		label: 'Build',
		delta: '—',
		status: 'pass',
		detail: ['- **Build** — this PR fixes a build that was broken on the base branch.'],
		blocking: null,
	}
}

function issueSection(
	order: number,
	label: string,
	head: { ran: boolean; issues: Issue[] },
	base: { ran: boolean; issues: Issue[] },
	baseName: string
): Section {
	const what = label.toLowerCase()
	if (!head.ran) return notMeasured(order, label, `the ${what} run on the PR tree`)
	if (!base.ran) return notMeasured(order, label, `the ${what} run on \`${baseName}\``)

	const delta = diffIssues(base.issues, head.issues)
	const net = head.issues.length - base.issues.length
	const parts = [`${base.issues.length} on \`${baseName}\` → ${head.issues.length} here`]
	if (delta.resolved.length) parts.push(`${delta.resolved.length} resolved`)
	if (delta.shifted) parts.push(`${delta.shifted} shifted, not counted`)

	const detail =
		delta.added.length === 0
			? [`- **${label}** — none new. ${parts.join(' · ')}`]
			: [`- **${label}** — ${parts.join(' · ')}`, ...capped(delta.added.map(formatIssue))]

	return {
		order,
		label,
		delta: signed(net),
		status: delta.added.length ? 'fail' : 'pass',
		detail,
		blocking: delta.added.length ? `${label}: ${delta.added.length} new` : null,
	}
}

function formatSection(head: TreeMeasurement, base: TreeMeasurement, baseName: string): Section {
	const label = 'Formatting (files you touched)'
	if (!head.format.ran) return notMeasured(3, label, 'the formatter run')
	// An absent touched-file list is a crashed step, not an empty PR.
	if (head.touched === null) return notMeasured(3, label, "the PR's own file list")

	const touched = new Set(head.touched)
	// Both lists are repo-root-relative with no `./`, or this intersection is
	// empty on every PR and the gate silently never fires.
	const yours = head.format.unformatted.filter((file) => touched.has(file)).sort()
	const elsewhere = head.format.unformatted.filter((file) => !touched.has(file))

	const before = base.format.unformatted.length
	const trend = !base.format.ran
		? `\`${baseName}\` was not measured, so there is no trend`
		: elsewhere.length === before
			? 'unchanged'
			: elsewhere.length < before
				? `down from ${before}`
				: `up from ${before}`

	const byExtension = new Map<string, number>()
	for (const file of elsewhere) {
		const ext = file.includes('.') ? `.${file.split('.').pop()}` : '(no extension)'
		byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1)
	}
	const breakdown = [...byExtension.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([ext, count]) => `\`${ext}\` ${count}`)
		.join(' · ')

	const context = elsewhere.length
		? [
				`  - ${elsewhere.length} other unformatted ${elsewhere.length === 1 ? 'file is' : 'files are'} not this PR's problem, and ${elsewhere.length === 1 ? 'blocks' : 'block'} nothing: ${breakdown} — ${trend}`,
			]
		: []

	if (yours.length === 0)
		return {
			order: 3,
			label,
			delta: '0',
			status: 'pass',
			detail: [`- **Formatting** — every file this PR touches is formatted.`, ...context],
			blocking: null,
		}

	return {
		order: 3,
		label,
		delta: signed(yours.length),
		status: 'fail',
		detail: [
			`- **Formatting** — ${yours.length} ${yours.length === 1 ? 'file' : 'files'} this PR touches ${yours.length === 1 ? 'is' : 'are'} unformatted. Run \`pnpm format\` and commit; a file you edited ships formatted.`,
			...capped(yours),
			...context,
		],
		blocking: `Formatting: ${yours.length} touched ${yours.length === 1 ? 'file is' : 'files are'} unformatted`,
	}
}

function bundleSection(head: TreeMeasurement, base: TreeMeasurement, baseName: string): Section {
	const label = 'Client bundle'
	if (!head.bundle || head.bundle.fileCount === 0)
		return notMeasured(4, label, "the PR tree's build")
	if (!base.bundle || base.bundle.fileCount === 0)
		return notMeasured(4, label, `\`${baseName}\`'s build`)

	const h = head.bundle
	const b = base.bundle
	const headTotal = h.eager.gzip + h.css.gzip
	const baseTotal = b.eager.gzip + b.css.gzip
	const moved = Math.abs(headTotal - baseTotal) > SIZE_NOISE_BYTES

	const rehashed = Object.keys(h.chunks)
		.filter((key) => key in b.chunks && b.chunks[key] !== h.chunks[key])
		.sort()

	const detail = [
		`- **Client bundle** — eager JS ${kb(b.eager.gzip)} → ${kb(h.eager.gzip)} gzipped · CSS ${kb(b.css.gzip)} → ${kb(h.css.gzip)} · ${h.lazy.files.length} lazy ${h.lazy.files.length === 1 ? 'chunk' : 'chunks'}`,
	]
	if (h.source === 'directory-walk')
		detail.push(
			'  - The route manifest was not found, so every client chunk is counted as eager. The number is an upper bound.'
		)
	if (rehashed.length)
		detail.push(
			`  - ${rehashed.length} ${rehashed.length === 1 ? 'chunk' : 'chunks'} re-hashed, so returning visitors fetch ${rehashed.length === 1 ? 'it' : 'them'} again:`,
			...capped(rehashed)
		)
	else detail.push('  - No chunk changed its hash, so returning visitors re-download nothing.')

	return {
		order: 4,
		label,
		delta: percent(baseTotal, headTotal),
		// Report-only: a size move asks for attention without stopping anyone.
		status: moved ? 'warn' : 'pass',
		detail,
		blocking: null,
	}
}

function workerSection(head: TreeMeasurement, base: TreeMeasurement): Section {
	const label = 'Worker upload'
	if (!head.bundle) return notMeasured(5, label, "the PR tree's build")
	if (!head.bundle.worker) return notMeasured(5, label, 'the deploy dry-run')
	const h = head.bundle.worker
	const b = base.bundle?.worker ?? null

	const share = ((h.gzip / WORKER_LIMIT_BYTES) * 100).toFixed(1)
	const detail = [
		`- **Worker upload** — ${kb(h.gzip)} gzipped, ${share}% of Cloudflare's 3 MB free-plan limit. The dry-run also resolved the deploy config and its bindings.`,
	]
	if (!b) return { order: 5, label, delta: '—', status: 'warn', detail, blocking: null }

	const moved = Math.abs(h.gzip - b.gzip) > SIZE_NOISE_BYTES
	return {
		order: 5,
		label,
		delta: percent(b.gzip, h.gzip),
		status: moved ? 'warn' : 'pass',
		detail,
		blocking: null,
	}
}

function testSection(head: TreeMeasurement): Section {
	const label = 'Test failures'
	if (!head.tests || !head.tests.ran) return notMeasured(6, label, 'the test run')
	const t = head.tests
	if (t.failed === 0)
		return {
			order: 6,
			label,
			delta: '0',
			status: 'pass',
			detail: [`- **Tests** — ${t.passed}/${t.total} passed.`],
			blocking: null,
		}
	return {
		order: 6,
		label,
		delta: signed(t.failed),
		status: 'fail',
		detail: [`- **Tests** — ${t.failed} of ${t.total} failed.`, ...capped(t.failures)],
		blocking: `Tests: ${t.failed} failing`,
	}
}

// --- the report -----------------------------------------------------------

export function buildReport(
	head: TreeMeasurement | null,
	base: TreeMeasurement | null,
	baseName: string
): Report {
	if (!head || !base) {
		const missing =
			!head && !base ? 'Neither tree was' : !head ? 'The PR tree was' : `\`${baseName}\` was`
		const body = [
			MARKER,
			'### PR checks',
			`_Compared against \`${baseName}\`._`,
			'',
			`❌ **${missing} not measured.** Its job did not finish, so nothing below can be trusted. Read the job log.`,
		].join('\n')
		return { body, blocking: [`${missing} not measured`] }
	}

	const sections = [
		buildSection(head, base),
		issueSection(1, 'Type errors', head.typecheck, base.typecheck, baseName),
		issueSection(2, 'Lint', head.lint, base.lint, baseName),
		formatSection(head, base, baseName),
		bundleSection(head, base, baseName),
		workerSection(head, base),
		testSection(head),
	]
		.filter((section) => section !== null)
		.sort((a, b) => a.order - b.order)

	const blocking = sections.map((s) => s.blocking).filter((reason) => reason !== null)
	const warnings = sections.filter((s) => s.status === 'warn').length

	const headline = blocking.length
		? `❌ **${blocking.length} ${blocking.length === 1 ? 'check is' : 'checks are'} failing**`
		: warnings
			? `⚠️ **All checks passing, ${warnings} to look at**`
			: '✅ **All checks passing**'

	const width = Math.max(...sections.map((s) => s.label.length), 5)
	const table = [
		`| ${'Check'.padEnd(width)} | Delta | Status |`,
		`|${'-'.repeat(width + 2)}|-------|--------|`,
		...sections.map((s) => `| ${s.label.padEnd(width)} | ${s.delta} | ${ICON[s.status]} |`),
	]

	const body = [
		MARKER,
		'### PR checks',
		`_Compared against \`${baseName}\`. A renamed file reads as every issue in it resolved and re-added._`,
		'',
		headline,
		'',
		...table,
		'',
		'**Details**',
		'',
		...sections.flatMap((s) => s.detail),
	].join('\n')

	return { body, blocking }
}
