/**
 * Measure one tree and write one measurement file.
 *
 * Run from *beside* the tree it measures, never from inside it:
 *
 *     node ci-head/ci/measure.ts --tree tree --instrument ci-head --label base …
 *
 * Both jobs run this same copy, checked out from the pull request's head SHA,
 * so a pull request that edits a check script cannot change what the script
 * measures on one side only. Each tree keeps its own committed copy of these
 * files under `ci/`, so an issue in a check script diffs like an issue in any
 * other file instead of appearing on both sides and cancelling to "no change".
 *
 * Nothing here pipes a command whose exit status matters: a pipeline reports its
 * last command's status, so `build | tee log` records a failed build as a
 * success.
 */

import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { normalise, normalisePaths } from './lib/delta.ts'
import {
	type Bytes,
	buildExcerpt,
	type Measurement,
	parseOxfmt,
	parseOxlint,
	parseStartManifest,
	parseTsc,
	parseVitest,
	parseWranglerUpload,
	splitHash,
	type Tree,
} from './lib/measurement.ts'

/**
 * Configs that decide what counts as an issue. Both trees use head's copy, or a
 * pull request that turns on a rule would have its base tree judged by the old
 * rule and every file the rule touches would read as newly broken.
 *
 * `.gitignore` is in this list because oxfmt reads it to choose what to scan.
 *
 * `vite.config.ts` and `wrangler.jsonc` are deliberately absent. They decide
 * what gets *built*, each tree uses its own, and a change to one is exactly the
 * effect the bundle delta exists to show.
 *
 * They are copied into the tree rather than pointed at from here: `tsc -p` and
 * oxlint both resolve their include and ignore patterns against the config's own
 * directory, so a config read from beside the tree would judge the wrong files.
 */
const JUDGMENT_CONFIGS = ['tsconfig.json', '.oxlintrc.json', '.oxfmtrc.json', '.gitignore']

const args = parseArgs(process.argv.slice(2))
const tree = resolve(args.tree)
const instrument = resolve(args.instrument)
const label = args.label as Tree

for (const config of JUDGMENT_CONFIGS) {
	const from = join(instrument, config)
	if (existsSync(from)) copyFileSync(from, join(tree, config))
}

const build = runBuild()
const measurement: Measurement = {
	tree: label,
	sha: args.sha ?? '',
	build,
	checks: {
		typecheck: typecheck(),
		lint: lint(),
		format: format(),
		bundle: bundle(),
		worker: worker(),
		tests:
			label === 'head' ? tests() : { ran: true, ok: true, total: 0, failed: 0, failures: [] },
	},
}

writeFileSync(args.out, `${JSON.stringify(measurement, null, '\t')}\n`)
console.log(`wrote ${args.out} for ${label}`)

// ---------------------------------------------------------------------------

function runBuild() {
	const result = run('pnpm', ['run', 'build'])
	return {
		ran: result.spawned,
		ok: result.spawned && result.status === 0,
		log: result.status === 0 ? '' : buildExcerpt(result.output),
	}
}

/**
 * `tsc --noEmit` exits 2 when it finds errors, which is a successful run. A
 * non-zero exit with nothing the parser recognises is the other case, and it
 * means the tool could not run.
 */
function typecheck() {
	const result = run('pnpm', ['exec', 'tsc', '--noEmit'])
	const issues = normalise(parseTsc(result.output))
	return { ran: result.spawned && (result.status === 0 || issues.length > 0), issues }
}

/**
 * Ask oxlint for JSON. Its human-readable formatters are free to change or
 * disappear between versions, and a parser built on one goes quiet rather than
 * loud when that happens.
 */
function lint() {
	const result = run('pnpm', ['exec', 'oxlint', '--format', 'json', '.'])
	try {
		const parsed = parseOxlint(result.output.slice(result.output.indexOf('{')))
		return {
			ran: true,
			issues: normalise(parsed.errors),
			warnings: normalise(parsed.warnings),
		}
	} catch (error) {
		console.error(`oxlint output unreadable: ${String(error)}`)
		return { ran: false, issues: [], warnings: [] }
	}
}

/**
 * `--list-different` is read-only. Formatting the tree and diffing it afterwards
 * answers the same question and destroys uncommitted work whenever somebody
 * runs the script outside CI.
 *
 * oxfmt exits 1 when it finds drift, so exit 1 with a list is a successful run
 * and exit 1 with nothing is a crash.
 */
function format() {
	const result = run('pnpm', ['exec', 'oxfmt', '--list-different', '.'])
	const drifted = normalisePaths(parseOxfmt(result.output))
	return {
		ran: result.spawned && (result.status === 0 || drifted.length > 0),
		drifted,
		touched: readTouched(),
	}
}

/** The head job passes the pull request's own file list; the base job has none. */
function readTouched(): string[] {
	if (!args.touched || !existsSync(args.touched)) return []
	return normalisePaths(
		readFileSync(args.touched, 'utf8')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	)
}

/**
 * The app server-renders and emits no HTML entry point, so there is no document
 * to read the eager set out of. TanStack Start compiles its route manifest into
 * a module inside the server build, and the root route's preloads and scripts
 * are what the SSR head puts in front of every first paint.
 *
 * `source` records where the number came from, so a fall back to walking the
 * directory shows up in the comment instead of passing as a measurement.
 */
function bundle() {
	const clientAssets = join(tree, 'dist/client/assets')
	const empty = {
		ran: false,
		source: 'nothing',
		fileCount: 0,
		eagerJs: { raw: 0, gzip: 0 },
		css: { raw: 0, gzip: 0 },
		lazyJs: { raw: 0, gzip: 0, count: 0 },
		chunks: {},
	}
	if (!existsSync(clientAssets)) return empty

	const files = readdirSync(clientAssets).filter((name) =>
		statSync(join(clientAssets, name)).isFile()
	)
	// A build that exits zero having written nothing measures as a triumphant
	// −100%, so an empty measurement counts as a missing one.
	if (files.length === 0) return empty

	let source = 'the TanStack Start route manifest'
	let eagerNames = eagerFromStartManifest()
	if (eagerNames === null) {
		source = 'a walk over `dist/client/assets` (the route manifest was unreadable)'
		eagerNames = files.filter((name) => name.endsWith('.js'))
	}

	const eager = new Set(eagerNames)
	const size = (names: string[]): Bytes => {
		let raw = 0
		let gzip = 0
		for (const name of names) {
			const bytes = readFileSync(join(clientAssets, name))
			raw += bytes.byteLength
			gzip += gzipSync(bytes).byteLength
		}
		return { raw, gzip }
	}

	const js = files.filter((name) => name.endsWith('.js'))
	const lazy = js.filter((name) => !eager.has(name))
	const chunks: Record<string, string> = {}
	for (const name of files) {
		const { key, hash } = splitHash(name)
		chunks[key] = hash ?? 'unhashed'
	}

	return {
		ran: true,
		source,
		fileCount: files.length,
		eagerJs: size(js.filter((name) => eager.has(name))),
		css: size(files.filter((name) => name.endsWith('.css'))),
		lazyJs: { ...size(lazy), count: lazy.length },
		chunks,
	}
}

/** Returns the eager asset filenames, or null when the manifest is unreadable. */
function eagerFromStartManifest(): string[] | null {
	const serverAssets = join(tree, 'dist/server/assets')
	if (!existsSync(serverAssets)) return null
	const file = readdirSync(serverAssets).find((name) =>
		name.startsWith('_tanstack-start-manifest_v-')
	)
	if (!file) return null
	// The manifest also carries each route's absolute source path, which differs
	// between the two checkouts. Only the asset URLs are read, so it cannot leak
	// the runner's directory layout into the delta.
	const assets = parseStartManifest(readFileSync(join(serverAssets, file), 'utf8'))
	if (assets.length === 0) return null
	return assets.map((url) => url.split('/').pop() ?? url)
}

/**
 * The deploy dry-run bundles exactly as a deploy would. It is the only check
 * here that reads `wrangler.jsonc` and its bindings, so a binding typo passes
 * everything else in this report. It runs after the build because the assets
 * binding needs the built output to exist.
 *
 * Its size is the figure Cloudflare applies its limit to. Summing the output
 * directory would measure a different quantity from the one the limit governs.
 */
function worker() {
	const outdir = mkdtempSync(join(tmpdir(), 'wrangler-dry-run-'))
	const result = run('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', `--outdir=${outdir}`])
	const upload = parseWranglerUpload(result.output)
	if (!upload)
		return {
			ran: false,
			ok: false,
			raw: 0,
			gzip: 0,
			log: buildExcerpt(result.output),
		}
	return { ran: true, ok: result.status === 0, raw: upload.raw, gzip: upload.gzip, log: '' }
}

/**
 * Head alone. Ask for machine-readable output, and carry the runner's own exit
 * code into the result: a crashed runner can leave a report that parses
 * perfectly and counts zero failures.
 */
function tests() {
	// Outside the tree: a report file dropped into it would show up as an
	// untracked file in the very tree the next check is about to measure.
	const outputFile = join(mkdtempSync(join(tmpdir(), 'vitest-report-')), 'report.json')
	const result = run('pnpm', [
		'exec',
		'vitest',
		'run',
		'--reporter=json',
		`--outputFile=${outputFile}`,
	])
	if (!existsSync(outputFile)) return { ran: false, ok: false, total: 0, failed: 0, failures: [] }
	try {
		const parsed = parseVitest(readFileSync(outputFile, 'utf8'))
		return { ran: true, ok: result.status === 0, ...parsed }
	} catch (error) {
		console.error(`vitest report unreadable: ${String(error)}`)
		return { ran: false, ok: false, total: 0, failed: 0, failures: [] }
	}
}

// ---------------------------------------------------------------------------

function run(command: string, commandArgs: string[]) {
	const result = spawnSync(command, commandArgs, {
		cwd: tree,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
	})
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
	console.log(`[${label}] ${command} ${commandArgs.join(' ')} → ${result.status ?? 'no exit'}`)
	return { spawned: result.error === undefined, status: result.status, output }
}

function parseArgs(argv: string[]): Record<string, string> {
	const parsed: Record<string, string> = {}
	for (let index = 0; index < argv.length; index += 2)
		parsed[argv[index].replace(/^--/, '')] = argv[index + 1]
	for (const required of ['tree', 'instrument', 'label', 'out'])
		if (!parsed[required]) throw new Error(`measure.ts needs --${required}`)
	return parsed
}
