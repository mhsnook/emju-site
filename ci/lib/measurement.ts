/**
 * What one job measures about one tree, and the parsers that read it out of the
 * tools.
 *
 * Every check carries `ran`. A tool that exits without output the parser can
 * read has not found zero issues, and the report job blocks on `ran: false`
 * rather than rendering a reassuring zero.
 *
 * Pure: the parsers take strings and return data. `measure.ts` owns the
 * subprocesses.
 */

import type { Issue } from './delta.ts'

export type Tree = 'head' | 'base'

export type BuildResult = {
	ran: boolean
	ok: boolean
	/** Excerpt of the build log, anchored on the first error. */
	log: string
}

export type Measurement = {
	tree: Tree
	sha: string
	build: BuildResult
	checks: {
		typecheck: { ran: boolean; issues: Issue[] }
		lint: { ran: boolean; issues: Issue[]; warnings: Issue[] }
		format: { ran: boolean; drifted: string[]; touched: string[] }
		bundle: {
			ran: boolean
			/** Where the eager set came from, so a fallback stays visible. */
			source: string
			fileCount: number
			eagerJs: Bytes
			css: Bytes
			lazyJs: Bytes & { count: number }
			/** Output filename keyed by its stable part, valued by its content hash. */
			chunks: Record<string, string>
		}
		worker: { ran: boolean; ok: boolean; raw: number; gzip: number; log: string }
		tests: {
			ran: boolean
			ok: boolean
			total: number
			failed: number
			failures: string[]
		}
	}
}

export type Bytes = { raw: number; gzip: number }

// ---------------------------------------------------------------------------
// Typecheck
// ---------------------------------------------------------------------------

/**
 * `tsc --noEmit` prints `path(line,col): error TS2322: message`.
 *
 * Keep only lines that carry `: error TS`, which drops the `Found 12 errors`
 * summary. A summary line changes whenever the count changes, so it would diff
 * as one phantom issue on every pull request.
 */
export function parseTsc(stdout: string): Issue[] {
	const issues: Issue[] = []
	for (const line of stripAnsi(stdout).split('\n')) {
		const match = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(line.trim())
		if (!match) continue
		issues.push({
			file: toRepoPath(match[1]),
			line: Number(match[2]),
			column: Number(match[3]),
			message: match[4],
			raw: `${toRepoPath(match[1])}(${match[2]},${match[3]}): ${match[4]}`,
		})
	}
	return issues
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

type OxlintDiagnostic = {
	message: string
	code?: string
	severity?: string
	filename?: string
	labels?: { span?: { line?: number; column?: number } }[]
}

/**
 * oxlint's `-f json` payload.
 *
 * Asserting that `diagnostics` is an array is the point of this function. A
 * renamed key read as `?? []` would turn every future oxlint release into a
 * clean report, so an unreadable payload throws and the caller records
 * `ran: false`.
 */
export function parseOxlint(stdout: string): { errors: Issue[]; warnings: Issue[] } {
	const parsed: unknown = JSON.parse(stdout)
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		!Array.isArray((parsed as { diagnostics?: unknown }).diagnostics)
	)
		throw new Error('oxlint JSON has no `diagnostics` array')

	const errors: Issue[] = []
	const warnings: Issue[] = []
	for (const diagnostic of (parsed as { diagnostics: OxlintDiagnostic[] }).diagnostics) {
		const span = diagnostic.labels?.[0]?.span
		const file = toRepoPath(diagnostic.filename ?? '<unknown>')
		const code = diagnostic.code ? `${diagnostic.code} ` : ''
		const message = `${code}${diagnostic.message.split('\n')[0]}`
		const issue: Issue = {
			file,
			line: span?.line ?? 0,
			column: span?.column ?? 0,
			message,
			raw: `${file}:${span?.line ?? 0}:${span?.column ?? 0}: ${message}`,
		}
		if (diagnostic.severity === 'warning') warnings.push(issue)
		else errors.push(issue)
	}
	return { errors, warnings }
}

// ---------------------------------------------------------------------------
// Formatter drift
// ---------------------------------------------------------------------------

/**
 * `oxfmt --list-different` prints one path per line and exits 1 when it finds
 * any. It is read-only, unlike formatting the tree and diffing it afterwards,
 * which destroys uncommitted work whenever someone runs the script outside CI.
 *
 * The paths come back repo-root-relative, which is the shape the touched-file
 * list uses. The two lists have to agree on that shape or the gate's
 * intersection is empty on every pull request and the gate stops firing.
 */
export function parseOxfmt(stdout: string): string[] {
	return stdout
		.split('\n')
		.map((line) => toRepoPath(line.trim()))
		.filter((line) => line.length > 0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Vitest's JSON reporter. `ok` comes from the runner's exit code, not from here. */
export function parseVitest(json: string): {
	total: number
	failed: number
	failures: string[]
} {
	const parsed: unknown = JSON.parse(json)
	const report = parsed as {
		numTotalTests?: unknown
		numFailedTests?: unknown
		testResults?: {
			assertionResults?: { status?: string; fullName?: string; failureMessages?: string[] }[]
		}[]
	}
	if (typeof report.numTotalTests !== 'number' || typeof report.numFailedTests !== 'number')
		throw new Error('vitest JSON has no numTotalTests/numFailedTests')

	const failures: string[] = []
	for (const file of report.testResults ?? [])
		for (const assertion of file.assertionResults ?? [])
			if (assertion.status === 'failed')
				failures.push(
					`${assertion.fullName ?? '(unnamed test)'} — ${(assertion.failureMessages?.[0] ?? '').split('\n')[0]}`
				)

	return { total: report.numTotalTests, failed: report.numFailedTests, failures }
}

// ---------------------------------------------------------------------------
// Worker bundle
// ---------------------------------------------------------------------------

/**
 * `wrangler deploy --dry-run` ends with `Total Upload: 1960.80 KiB / gzip:
 * 408.30 KiB`. That is the figure Cloudflare applies its size limit to, and it
 * is not the sum of the output directory, so read it from the deploy tool.
 */
export function parseWranglerUpload(output: string): { raw: number; gzip: number } | null {
	const match = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/.exec(
		stripAnsi(output)
	)
	if (!match) return null
	return { raw: Math.round(Number(match[1]) * 1024), gzip: Math.round(Number(match[2]) * 1024) }
}

// ---------------------------------------------------------------------------
// Build log
// ---------------------------------------------------------------------------

/**
 * Quote a failing build from its first error rather than from its tail: most
 * build tools print a summary, a stack and an exit code after the useful part.
 *
 * The anchors are words a successful Vite build does not print. `[vite]` and
 * the plugin names appear in every build, so they cannot anchor anything.
 */
export function buildExcerpt(log: string, lines = 25): string {
	const all = stripAnsi(log).split('\n')
	const anchor = all.findIndex((line) =>
		/\berror\b|\bERROR\b|Error:|error during build|Build failed|Transform failed/.test(line)
	)
	const start = anchor === -1 ? Math.max(0, all.length - lines) : Math.max(0, anchor - 2)
	return all
		.slice(start, start + lines)
		.join('\n')
		.trim()
}

// ---------------------------------------------------------------------------
// Bundle chunks
// ---------------------------------------------------------------------------

/**
 * Split `index-Bm1XxA3w.js` into the key `index.js` and the hash `Bm1XxA3w`.
 *
 * Vite's default hash is exactly 8 characters, and this pins that length. A
 * pattern accepting a range would match early inside a name that contains a
 * dash — in `client-entry-a1b2c3d4.js` the substring `entry-a1b2c3d4` sits
 * inside `{8,20}` — and two different files would then compare as one unchanged
 * chunk.
 */
export function splitHash(filename: string): { key: string; hash: string | null } {
	const match = /^(.*)-([A-Za-z0-9_-]{8})(\.[^.]+)$/.exec(filename)
	if (!match) return { key: filename, hash: null }
	return { key: `${match[1]}${match[3]}`, hash: match[2] }
}

/**
 * Pull the root route's eager asset list out of the TanStack Start manifest.
 *
 * The app server-renders and emits no HTML entry point, so the eager set is the
 * root route's `preloads` and `scripts` — exactly what the SSR head puts in
 * front of a first paint. Start compiles that manifest into a module inside the
 * *server* build, so this reads JavaScript rather than a data file.
 *
 * It matches brackets rather than reading indentation. The emitted module is
 * minified output whose whitespace is the bundler's business, so a regex over
 * layout would break on the next bundler release and fall back without saying
 * so.
 */
export function parseStartManifest(source: string): string[] {
	const root = source.indexOf('__root__')
	if (root === -1) return []
	const body = balanced(source, source.indexOf('{', root))
	if (body === null) return []

	const assets: string[] = []
	for (const field of ['preloads', 'scripts']) {
		const at = body.indexOf(`${field}:`)
		if (at === -1) continue
		const list = balanced(body, body.indexOf('[', at), '[', ']')
		if (list === null) continue
		for (const match of list.matchAll(/["'](\/[^"']+)["']/g)) assets.push(match[1])
	}
	return [...new Set(assets)]
}

/** The substring from `open` to its matching close, delimiters included. */
function balanced(source: string, open: number, start = '{', end = '}'): string | null {
	if (open === -1) return null
	let depth = 0
	for (let index = open; index < source.length; index++) {
		if (source[index] === start) depth += 1
		else if (source[index] === end) {
			depth -= 1
			if (depth === 0) return source.slice(open, index + 1)
		}
	}
	return null
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** A parser fed escape codes matches nothing while appearing to run. */
export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\[[0-9;]*[A-Za-z]/g, '')
}

/** Repo-root-relative, forward slashes, no `./` prefix. One shape everywhere. */
export function toRepoPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '')
}
