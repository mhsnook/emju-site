/**
 * Measure one tree. Run from the tree's own root, with this script living in a
 * sibling checkout of the head SHA, so head's tooling measures both trees and
 * is never itself part of what gets measured.
 *
 *   node ../ci-head/.github/ci/measure.ts head measurements/head.json
 *
 * The tool *binaries* still come from the tree being measured, because they
 * come from its lockfile and the tree has to build with its own dependencies.
 * A PR that bumps oxlint or TypeScript will therefore show a wall of movement,
 * the same way one that edits a lint rule does.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

import type {
	BuildOutcome,
	BundleMeasurement,
	Issue,
	SizeGroup,
	TreeMeasurement,
	TreeName,
} from './types.ts'

const MAX_FAILURES = 20
const MAX_LOG_LINES = 12

type Run = { status: number; out: string }

function run(command: string, args: string[], env: Record<string, string> = {}): Run {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
	})
	return {
		status: result.status ?? 1,
		out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
	}
}

const bin = (name: string) => path.join('node_modules', '.bin', name)

const lines = (text: string) =>
	text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)

// --- build ----------------------------------------------------------------

function measureBuild(): BuildOutcome {
	const result = run(bin('vite'), ['build'])
	if (result.status === 0) return { ok: true, firstError: [] }

	const all = result.out.split('\n')
	// Anchor on wording a successful build never prints; a successful Vite run
	// prints plugin names and `[vite]` too.
	let start = all.findIndex((line) => /error during build|Build failed|^\s*✘/i.test(line))
	if (start === -1) start = all.findIndex((line) => /\berror\b/i.test(line))
	if (start === -1) start = Math.max(0, all.length - MAX_LOG_LINES)
	return { ok: false, firstError: all.slice(start, start + MAX_LOG_LINES).filter((l) => l.trim()) }
}

// --- type errors ----------------------------------------------------------

/** `src/lib/a.ts(12,3): error TS2322: Type 'string' is not assignable…` */
const TSC_LINE = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/

function measureTypecheck(): { ran: boolean; issues: Issue[] } {
	// `tsc --noEmit` exits 2 when it finds errors, so a non-zero status alone
	// does not mean it failed to run. Absence of parseable output does.
	const result = run(bin('tsc'), ['--noEmit'])
	const issues: Issue[] = []
	for (const line of lines(result.out)) {
		const match = TSC_LINE.exec(line)
		if (match)
			issues.push({ file: match[1], line: +match[2], column: +match[3], message: match[4] })
	}
	if (result.status !== 0 && issues.length === 0) {
		process.stderr.write(`typecheck could not run (exit ${result.status}):\n${result.out}\n`)
		return { ran: false, issues: [] }
	}
	return { ran: true, issues: sortIssues(issues) }
}

// --- lint -----------------------------------------------------------------

type OxlintDiagnostic = {
	message: string
	code?: string
	severity?: string
	filename: string
	labels?: { span?: { line?: number; column?: number } }[]
}

function measureLint(): { ran: boolean; issues: Issue[] } {
	// JSON rather than a text format: a text formatter that a future version
	// drops exits non-zero and prints a line of advice, which a grep discards
	// as zero issues.
	const result = run(bin('oxlint'), ['--format=json'])
	let parsed: { diagnostics?: OxlintDiagnostic[] } | null = null
	try {
		parsed = JSON.parse(result.out)
	} catch {
		parsed = null
	}
	if (parsed === null) {
		process.stderr.write(`lint could not run (exit ${result.status}):\n${result.out}\n`)
		return { ran: false, issues: [] }
	}
	const issues = (parsed.diagnostics ?? []).map((d) => ({
		file: d.filename,
		line: d.labels?.[0]?.span?.line ?? 0,
		column: d.labels?.[0]?.span?.column ?? 0,
		// Keep the rule name, so the fix stays obvious without opening the tool.
		message: `${d.severity ?? 'error'}: ${d.message}${d.code ? ` (${d.code})` : ''}`,
	}))
	return { ran: true, issues: sortIssues(issues) }
}

const sortIssues = (issues: Issue[]) => {
	const key = (i: Issue) => `${i.file}\u0000${i.line}\u0000${i.column}\u0000${i.message}`
	const unique = new Map(issues.map((i) => [key(i), i]))
	return [...unique.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

// --- formatter drift ------------------------------------------------------

function measureFormat(): { ran: boolean; unformatted: string[] } {
	// Read-only list mode. Formatting in place and diffing the tree answers the
	// same question and destroys uncommitted work anywhere but CI.
	const result = run(bin('oxfmt'), ['--list-different'])
	const files = lines(result.out).filter((line) => !line.includes(' '))
	if (result.status !== 0 && files.length === 0) {
		process.stderr.write(`formatter could not run (exit ${result.status}):\n${result.out}\n`)
		return { ran: false, unformatted: [] }
	}
	// Repo-root-relative, no `./`: the same shape `git diff --name-only` gives,
	// or the touched-file intersection is empty on every PR and never fires.
	return { ran: true, unformatted: files.map((file) => file.replace(/^\.\//, '')).sort() }
}

// --- bundle ---------------------------------------------------------------

const CLIENT_ASSETS = path.join('dist', 'client', 'assets')

/** Vite's content hash is exactly 8 characters here. A pattern that accepts a
 * range matches an earlier dash and collapses two chunks onto one key. */
const HASHED = /^(.*)-([A-Za-z0-9_-]{8})\.(js|css)$/

function sizes(files: string[]): SizeGroup {
	let raw = 0
	let gzip = 0
	for (const file of files) {
		const buffer = fs.readFileSync(path.join(CLIENT_ASSETS, file))
		raw += buffer.byteLength
		gzip += gzipSync(buffer).byteLength
	}
	return { raw, gzip, files: [...files].sort() }
}

/** The eager set is what a first paint downloads. This app renders on the
 * server and ships no HTML entry point, so the set lives in the TanStack Start
 * route manifest, which the server build embeds. */
function eagerFromRouteManifest(): string[] | null {
	const serverAssets = path.join('dist', 'server', 'assets')
	if (!fs.existsSync(serverAssets)) return null
	const manifest = fs
		.readdirSync(serverAssets)
		.find((file) => file.startsWith('_tanstack-start-manifest_v-'))
	if (!manifest) return null
	const source = fs.readFileSync(path.join(serverAssets, manifest), 'utf8')
	// Only the root route loads eagerly; every other route's preloads arrive
	// when someone navigates to it.
	const root = /__root__:\s*\{([\s\S]*?)\n\t\},/.exec(source)
	if (!root) return null
	const assets = [...root[1].matchAll(/"\/assets\/([^"]+)"/g)].map((match) => match[1])
	return assets.length ? [...new Set(assets)] : null
}

function measureWorker(): { raw: number; gzip: number } | null {
	// The dry-run bundles exactly as a deploy would, so it is the only step
	// that validates wrangler.jsonc and its bindings. A binding typo passes
	// every other check in this report.
	const outdir = path.join('dist', '.dry-run')
	const result = run(bin('wrangler'), ['deploy', '--dry-run', '--outdir', outdir], {
		CLOUDFLARE_API_TOKEN: '',
		WRANGLER_SEND_METRICS: 'false',
	})
	const match = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/.exec(result.out)
	if (result.status !== 0 || !match) {
		process.stderr.write(`deploy dry-run failed (exit ${result.status}):\n${result.out}\n`)
		return null
	}
	return { raw: Math.round(+match[1] * 1024), gzip: Math.round(+match[2] * 1024) }
}

function measureBundle(): BundleMeasurement | null {
	if (!fs.existsSync(CLIENT_ASSETS)) return null
	const all = fs.readdirSync(CLIENT_ASSETS)
	// A build that exits zero having written nothing measures as a triumphant
	// −100%, so an empty output is a missing measurement, not a small one.
	if (all.length === 0) return null

	const js = all.filter((file) => file.endsWith('.js'))
	const css = all.filter((file) => file.endsWith('.css'))
	const fromManifest = eagerFromRouteManifest()
	const eager = fromManifest ? fromManifest.filter((file) => js.includes(file)) : js

	const chunks: Record<string, string> = {}
	for (const file of [...js, ...css]) {
		const match = HASHED.exec(file)
		if (match) chunks[`${match[1]}.${match[3]}`] = match[2]
		else chunks[file] = 'unhashed'
	}

	return {
		source: fromManifest ? 'route-manifest' : 'directory-walk',
		fileCount: all.length,
		eager: sizes(eager),
		css: sizes(css),
		lazy: sizes(js.filter((file) => !eager.includes(file))),
		chunks,
		worker: measureWorker(),
	}
}

// --- head-only checks -----------------------------------------------------

function measureTests(): TreeMeasurement['tests'] {
	const output = path.resolve('dist', '.vitest-report.json')
	const result = run(bin('vitest'), ['run', '--reporter=json', `--outputFile=${output}`])
	if (!fs.existsSync(output)) {
		process.stderr.write(`tests produced no report (exit ${result.status}):\n${result.out}\n`)
		return { ran: false, total: 0, passed: 0, failed: 0, failures: [] }
	}
	const report = JSON.parse(fs.readFileSync(output, 'utf8'))
	const failures: string[] = []
	for (const file of report.testResults ?? [])
		for (const test of file.assertionResults ?? [])
			if (test.status === 'failed')
				failures.push(
					`${test.fullName ?? test.title}: ${(test.failureMessages?.[0] ?? '').split('\n')[0]}`
				)
	return {
		// A crashed runner can leave a report that parses and counts zero
		// failures, so the step's own exit status is part of the measurement.
		ran: result.status === 0 || failures.length > 0,
		total: report.numTotalTests ?? 0,
		passed: report.numPassedTests ?? 0,
		failed: report.numFailedTests ?? failures.length,
		failures: failures.slice(0, MAX_FAILURES),
	}
}

function measureTouched(baseSha: string): string[] | null {
	// Three-dot: the files this branch changed since it diverged, not the files
	// that landed on the base branch in the meantime. Two-dot is correct only
	// against the default `pull_request` merge ref, and this job checks out the
	// head SHA.
	const result = run('git', ['diff', '--name-only', '--diff-filter=d', `${baseSha}...HEAD`])
	if (result.status !== 0) {
		process.stderr.write(`could not list the PR's files:\n${result.out}\n`)
		return null
	}
	return lines(result.out).sort()
}

// --- entry point ----------------------------------------------------------

const tree = process.argv[2] as TreeName
const outFile = process.argv[3]
if (tree !== 'head' && tree !== 'base') throw new Error(`unknown tree: ${tree}`)
if (!outFile) throw new Error('no output path given')

const measurement: TreeMeasurement = {
	tree,
	sha: run('git', ['rev-parse', 'HEAD']).out.trim(),
	build: measureBuild(),
	typecheck: measureTypecheck(),
	lint: measureLint(),
	format: measureFormat(),
	bundle: measureBundle(),
	touched: tree === 'head' ? measureTouched(process.env.BASE_SHA ?? '') : null,
	tests: tree === 'head' ? measureTests() : null,
}

fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(measurement, null, '\t'))
process.stdout.write(`wrote ${outFile}\n`)
