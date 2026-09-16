'use strict'

// Measure a TanStack Start + Cloudflare Workers build into a small JSON summary.
//
//   node measure-bundle.cjs dist /tmp/out/bundle.json
//
// This runs in the build job, next to the dist/ it reads. The report job then
// diffs two summaries, so it never needs either tree — which is what lets the
// head and base builds happen once each, in parallel, on separate runners.
//
// This project is server-rendered, so there is no dist/index.html to read the
// eager set from. `vite build` writes two directories that move for different
// reasons, so they are measured on separate axes:
//
//   worker  — dist/server, the code uploaded to Cloudflare. Its GZIPPED size is
//             a hard deploy limit, not a preference: 10 MB on Workers Paid.
//             Exceed it and `wrangler deploy` fails.
//   client  — dist/client/assets, what a browser downloads. Split into the
//             eager set (every document loads it), the lazy route chunks, the
//             CSS, and the static files.

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// Cloudflare's limit on a deployed Worker, gzipped, on the Workers Paid plan.
const WORKER_GZ_LIMIT = 10 * 1024 * 1024

// How to strip the content hash, so the same logical chunk is comparable across
// two builds. Rolldown emits `name-HASH.ext` with exactly 8 characters after
// the last dash. The exact length matters: a looser `{8,20}` swallows the name
// as well on a file like `-styles-BGqiJpHp.css`, whose own name contains a
// dash, and every such file then keys on a bare `.css`.
const STRIP_HASH = /-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/

const sizeOf = (file) => {
	const buf = fs.readFileSync(file)
	return { raw: buf.length, gz: zlib.gzipSync(buf).length }
}

const add = (total, one) => ({ raw: total.raw + one.raw, gz: total.gz + one.gz })

/** Every file under a directory, recursively. Empty when the directory is absent. */
function walk(dir) {
	if (!fs.existsSync(dir)) return []
	const out = []
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (entry.isFile()) out.push(path.join(entry.parentPath ?? entry.path, entry.name))
	}
	return out
}

/** Total raw and gzipped bytes for a list of files. */
function total(files) {
	let acc = { raw: 0, gz: 0 }
	for (const f of files) acc = add(acc, sizeOf(f))
	return acc
}

/**
 * Walk a JS object literal from the first `{` after `key` to its matching `}`.
 *
 * The TanStack Start manifest is emitted as readable source, not JSON, so it
 * cannot be parsed. Brace matching with string skipping is enough: the only
 * quoted text inside is file paths and URLs.
 */
function objectAfter(text, key) {
	const at = text.indexOf(key)
	if (at < 0) return null
	const start = text.indexOf('{', at)
	if (start < 0) return null
	let depth = 0
	for (let i = start; i < text.length; i++) {
		const c = text[i]
		if (c === '"' || c === "'" || c === '`') {
			const quote = c
			for (i++; i < text.length; i++) {
				if (text[i] === '\\') i++
				else if (text[i] === quote) break
			}
			continue
		}
		if (c === '{') depth++
		else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
	}
	return null
}

/**
 * The eager set: every client asset the root route loads, which means every
 * document loads it. TanStack Start writes it into the server-side route
 * manifest — `__root__.preloads` plus `__root__.scripts` — because the HTML is
 * generated per request and never lands in dist/.
 *
 * Returns null when the manifest cannot be read, so the caller can fall back
 * rather than report an eager set of zero bytes.
 */
function eagerHrefs(dist) {
	const manifests = walk(path.join(dist, 'server')).filter(
		(f) => f.endsWith('.js') && path.basename(f).includes('tanstack-start-manifest')
	)
	for (const file of manifests) {
		const root = objectAfter(fs.readFileSync(file, 'utf8'), '__root__')
		if (!root) continue
		const hrefs = [...root.matchAll(/["'](\/assets\/[^"']+)["']/g)].map((m) => m[1])
		if (hrefs.length) return new Set(hrefs)
	}
	return null
}

function measure(dist) {
	const serverDir = path.join(dist, 'server')
	const clientDir = path.join(dist, 'client')
	if (!fs.existsSync(serverDir) || !fs.existsSync(clientDir)) {
		throw new Error(`${dist} has no server/ and client/ — is this a TanStack Start build?`)
	}

	const workerFiles = walk(serverDir)
	const clientFiles = walk(clientDir)
	const assetsDir = path.join(clientDir, 'assets')
	const inAssets = (f) => f.startsWith(assetsDir + path.sep)

	const js = clientFiles.filter((f) => inAssets(f) && f.endsWith('.js'))
	const css = clientFiles.filter((f) => inAssets(f) && f.endsWith('.css'))
	// Fonts, icons, robots.txt, the web app manifest. Cached hard and rarely
	// moved by a PR, so they stay on their own axis and cannot drown out a real
	// JS regression.
	const staticFiles = clientFiles.filter((f) => !js.includes(f) && !css.includes(f))

	const hrefs = eagerHrefs(dist)
	const isEager = (f) =>
		!hrefs || hrefs.has('/' + path.relative(clientDir, f).split(path.sep).join('/'))
	const eagerJs = js.filter(isEager)
	const lazyJs = js.filter((f) => !eagerJs.includes(f))

	// Every eager file, keyed by its hash-stripped name. Identity matters as much
	// as size: a chunk whose hash is unchanged is still in returning visitors'
	// caches, so a PR that adds 2 kB to one has really cost them the whole chunk.
	const eagerChunks = {}
	for (const f of [...eagerJs, ...css]) {
		eagerChunks[path.basename(f).replace(STRIP_HASH, '$1')] = {
			file: path.basename(f),
			...sizeOf(f),
		}
	}

	return {
		worker: { ...total(workerFiles), limit: WORKER_GZ_LIMIT, count: workerFiles.length },
		// `js` and `entry` keep the template's names, because render-bundle.cjs
		// and gate.cjs read them. Here both mean the eager client JS: this app
		// ships one root script, so the entry chunk and the eager set coincide.
		js: total(eagerJs),
		entry: total(eagerJs),
		css: total(css),
		lazy: { ...total(lazyJs), count: lazyJs.length },
		static: { ...total(staticFiles), count: staticFiles.length },
		eagerChunks,
		// How the eager set was determined, so a comment that silently fell back
		// to "all client JS is eager" says so instead of reporting a wrong axis.
		eagerSource: hrefs ? 'start-manifest' : 'fallback-all-client-js',
		// The guard against a build that exits zero having written nothing. A
		// measurement of zero files must read as missing, not as a −100% win.
		fileCount: workerFiles.length + js.length + css.length,
	}
}

module.exports = {
	measure,
	walk,
	sizeOf,
	total,
	objectAfter,
	eagerHrefs,
	STRIP_HASH,
	WORKER_GZ_LIMIT,
}

if (require.main === module) {
	const [dist, out] = process.argv.slice(2)
	if (!dist || !out) {
		console.error('usage: measure-bundle.cjs <dist-dir> <output.json>')
		process.exit(2)
	}
	const r = measure(dist)
	fs.mkdirSync(path.dirname(out), { recursive: true })
	fs.writeFileSync(out, JSON.stringify(r, null, 2))
	const pct = ((r.worker.gz / WORKER_GZ_LIMIT) * 100).toFixed(1)
	console.log(
		`worker ${(r.worker.gz / 1048576).toFixed(2)} MB gzipped (${pct}% of the 10 MB limit) · ` +
			`client eager ${(r.js.gz / 1024).toFixed(2)} kB JS + ${(r.css.gz / 1024).toFixed(2)} kB CSS gzipped ` +
			`(${Object.keys(r.eagerChunks).length} eager file(s), ${r.lazy.count} lazy, via ${r.eagerSource})`
	)
}
