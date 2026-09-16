// Measures one tree and writes a single measurement file. Head runs this on itself; the
// base job runs *this* copy of it, from a sibling checkout of the head SHA, against the
// base tree — so both trees are judged by the same instrument.
//
// Usage: node ci/measure.ts --tree head|base --out .ci-out/head.json

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

import { byteOrder, type Bundle, type Measurement, type Tree } from './delta.ts'

type Run = { status: number; out: string }

// spawnSync, not a shell pipeline: a pipeline exits with its last command's status, so
// `tool | tee log` reports a failed tool as a success.
function run(command: string, args: string[]): Run {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
	const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
	if (result.error) return { status: 127, out: `${out}\n${result.error.message}` }
	return { status: result.status ?? 1, out }
}

function lines(text: string) {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
}

function sorted(values: string[]) {
	return [...new Set(values)].sort(byteOrder)
}

function measureTypecheck(): Measurement['checks']['typecheck'] {
	const { status, out } = run('pnpm', ['exec', 'tsc', '--noEmit'])
	const issues = sorted(
		lines(out)
			.filter((line) => line.includes(': error TS'))
			// tsc prints `file(line,col): error TSxxxx: message`; the diff wants
			// `file:line:col: message`.
			.map((line) => line.replace(/^(.+?)\((\d+),(\d+)\): /, '$1:$2:$3: '))
	)
	// tsc exits 2 for "found errors", which is a successful run. Non-zero with nothing the
	// parser recognises is the case that means it could not run.
	const ran = status === 0 || issues.length > 0
	return { ran, issues }
}

function measureLint(): Measurement['checks']['lint'] {
	const { out } = run('pnpm', ['exec', 'oxlint', '--format', 'json'])
	let parsed: unknown
	try {
		parsed = JSON.parse(out.slice(out.indexOf('{')))
	} catch {
		return { ran: false, issues: [], warnings: [] }
	}
	const diagnostics = (parsed as { diagnostics?: unknown }).diagnostics
	// A renamed key must read as "did not run", never as zero issues.
	if (!Array.isArray(diagnostics)) return { ran: false, issues: [], warnings: [] }

	const issues: string[] = []
	const warnings: string[] = []
	for (const entry of diagnostics as Array<Record<string, any>>) {
		const span = entry.labels?.[0]?.span ?? {}
		const text = `${entry.filename}:${span.line ?? 0}:${span.column ?? 0}: ${entry.message} (${entry.code})`
		if (entry.severity === 'error') issues.push(text)
		else warnings.push(text)
	}
	return { ran: true, issues: sorted(issues), warnings: sorted(warnings) }
}

function measureFormat(tree: Tree): Measurement['checks']['format'] {
	// Read-only list mode. Formatting in place and diffing the tree answers the same
	// question and destroys uncommitted work when anyone runs this outside CI.
	const { status, out } = run('pnpm', ['exec', 'oxfmt', '--list-different'])
	const drifted = sorted(lines(out).filter((line) => !line.startsWith('Fixed')))
	if (status !== 0 && drifted.length === 0) return { ran: false, drifted: [], touched: null }
	return { ran: true, drifted, touched: tree === 'head' ? touchedFiles() : [] }
}

function touchedFiles(): string[] | null {
	const baseSha = process.env.BASE_SHA
	if (!baseSha) return null
	// Two-dot against the base SHA, because the checkout is the pull request's merge ref:
	// HEAD already contains base, so this is the PR's own footprint. Checking out the head
	// SHA instead would silently widen it to everything that landed on base since.
	const { status, out } = run('git', [
		'diff',
		'--name-only',
		'--diff-filter=ACMR',
		`${baseSha}..HEAD`,
	])
	if (status !== 0) return null
	return sorted(lines(out))
}

function measureTests(): Measurement['checks']['tests'] {
	const file = '.ci-out/vitest.json'
	const { status, out } = run('pnpm', [
		'exec',
		'vitest',
		'run',
		'--reporter=json',
		`--outputFile=${file}`,
	])
	if (!existsSync(file)) return { ran: false, total: 0, failed: 0, failures: [out.slice(-2000)] }
	let report: any
	try {
		report = JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return { ran: false, total: 0, failed: 0, failures: [] }
	}
	if (typeof report.numTotalTests !== 'number')
		return { ran: false, total: 0, failed: 0, failures: [] }

	const failures: string[] = []
	for (const suite of report.testResults ?? []) {
		for (const assertion of suite.assertionResults ?? []) {
			if (assertion.status !== 'failed') continue
			const message = String(assertion.failureMessages?.[0] ?? '').split('\n')[0]
			failures.push(`\`${assertion.fullName}\` — ${message}`)
		}
	}
	// The runner's own outcome matters: a crashed run can leave a report that parses and
	// counts zero failures.
	const ran = status === 0 || report.numFailedTests > 0 || failures.length > 0
	return {
		ran,
		total: report.numTotalTests,
		failed: report.numFailedTests ?? failures.length,
		failures: sorted(failures),
	}
}

const CLIENT_ASSETS = 'dist/client/assets'

function sizeOf(paths: string[]) {
	let raw = 0
	let gzip = 0
	for (const path of paths) {
		const buffer = readFileSync(path)
		raw += buffer.byteLength
		gzip += gzipSync(buffer).byteLength
	}
	return { raw, gzip }
}

// `name-HASH.ext`, with the hash pinned to exactly 8 characters. A pattern that accepts a
// range of lengths matches inside a chunk's own name and collapses two files onto one key.
const HASHED = /^(.*)-([A-Za-z0-9_-]{8})(\.[^.]+)$/

function chunkKey(name: string) {
	const match = HASHED.exec(name)
	return match ? { key: `${match[1]}${match[3]}`, hash: match[2]! } : { key: name, hash: '' }
}

function assetPath(url: string) {
	return join('dist/client', url.replace(/^\//, ''))
}

async function readStartManifest() {
	// TanStack Start compiles the route manifest into a module inside the server build, so
	// import it rather than matching a regex over emitted whitespace.
	const dir = 'dist/server/assets'
	if (!existsSync(dir)) return null
	const file = readdirSync(dir).find((name) => name.startsWith('_tanstack-start-manifest_v-'))
	if (!file) return null
	const module = (await import(pathToFileURL(join(process.cwd(), dir, file)).href)) as {
		tsrStartManifest?: () => {
			routes: Record<
				string,
				{ preloads?: string[]; scripts?: Array<{ attrs?: { src?: string } }> }
			>
		}
	}
	if (typeof module.tsrStartManifest !== 'function') return null
	return module.tsrStartManifest().routes
}

async function measureBundle(): Promise<Bundle> {
	const empty: Bundle = {
		ran: false,
		source: 'nothing',
		fileCount: 0,
		eager: { files: [], raw: 0, gzip: 0 },
		entry: null,
		css: { files: [], raw: 0, gzip: 0 },
		routes: {},
		chunks: {},
		worker: null,
	}
	if (!existsSync(CLIENT_ASSETS)) return empty
	const files = readdirSync(CLIENT_ASSETS).sort(byteOrder)
	// A build that exits zero having written nothing measures as a triumphant −100%.
	if (files.length === 0) return empty

	const routes = await readStartManifest()
	if (!routes) return { ...empty, fileCount: files.length }

	const rootKey = '__root__'
	const root = routes[rootKey]
	const eagerUrls = sorted([
		...(root?.preloads ?? []),
		...(root?.scripts ?? []).map((script) => script.attrs?.src ?? '').filter(Boolean),
	])
	const eagerFiles = eagerUrls.map(assetPath).filter((path) => existsSync(path))
	if (eagerFiles.length !== eagerUrls.length) return { ...empty, fileCount: files.length }

	const cssFiles = files
		.filter((name) => name.endsWith('.css'))
		.map((name) => join(CLIENT_ASSETS, name))
	const perRoute: Bundle['routes'] = {}
	for (const [route, entry] of Object.entries(routes)) {
		if (route === rootKey) continue
		const paths = sorted([...eagerUrls, ...(entry.preloads ?? [])])
			.map(assetPath)
			.filter((path) => existsSync(path))
		perRoute[route] = sizeOf(paths)
	}

	const chunks: Bundle['chunks'] = {}
	for (const name of files) {
		const { key, hash } = chunkKey(name)
		chunks[key] = { hash, ...sizeOf([join(CLIENT_ASSETS, name)]) }
	}

	const entryName = eagerFiles.find((path) => path.endsWith('.js'))
	return {
		ran: true,
		source: 'the TanStack Start route manifest in the server build',
		fileCount: files.length,
		eager: { files: eagerFiles, ...sizeOf(eagerFiles) },
		entry: entryName ? { file: entryName, ...sizeOf([entryName]) } : null,
		css: { files: cssFiles, ...sizeOf(cssFiles) },
		routes: perRoute,
		chunks,
		worker: null,
	}
}

function measureDeploy() {
	// The dry-run bundles the Worker exactly as a deploy would and resolves every binding,
	// which nothing else in this report checks. It runs after the build because the assets
	// binding needs dist/client to exist.
	const { status, out } = run('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run'])
	const match = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/.exec(out)
	const worker = match
		? { raw: Math.round(Number(match[1]) * 1024), gzip: Math.round(Number(match[2]) * 1024) }
		: null
	return { deploy: { ran: true, ok: status === 0, log: out.slice(-8000) }, worker }
}

async function main() {
	const args = process.argv.slice(2)
	const tree = (args[args.indexOf('--tree') + 1] ?? 'head') as Tree
	const out = args[args.indexOf('--out') + 1] ?? `.ci-out/${tree}.json`

	const build = run('pnpm', ['run', 'build'])
	const bundle = await measureBundle()
	const { deploy, worker } =
		build.status === 0
			? measureDeploy()
			: {
					deploy: {
						ran: true,
						ok: false,
						log: 'build failed, so the deploy dry-run was skipped',
					},
					worker: null,
				}

	const measurement: Measurement = {
		tree,
		sha: process.env.MEASURED_SHA ?? '',
		build: { ran: true, ok: build.status === 0, log: build.out.slice(-8000) },
		checks: {
			typecheck: measureTypecheck(),
			lint: measureLint(),
			format: measureFormat(tree),
			bundle: { ...bundle, worker },
			deploy,
			// Single-branch: a test passes on head or it does not, and there is nothing on
			// base to compare it against.
			tests: tree === 'head' ? measureTests() : null,
		},
	}

	mkdirSync(dirname(out), { recursive: true })
	writeFileSync(out, `${JSON.stringify(measurement, null, '\t')}\n`)
	console.log(`wrote ${out} for ${tree}`)
}

await main()
