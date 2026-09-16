'use strict'

// Diff two bundle measurements and render one fragment.
//
// Takes the JSON summaries written by measure-bundle.cjs, not the built
// directories — the report job never has either tree checked out.

const fs = require('fs')
const path = require('path')
const { formatBytes, deltaLabel, sizeTable } = require('./delta.cjs')

const load = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null)

// Two builds of the same commit differ by a few bytes per chunk. Below this,
// call it unchanged rather than teaching people that the number is noise.
const NOISE_FLOOR = 512

const formatMB = (n) => (n / 1048576).toFixed(2) + ' MB'

/**
 * The Worker is the one axis with a hard external limit. Cloudflare rejects a
 * deploy over 10 MB gzipped on Workers Paid, so this is a budget, not a trend.
 */
function workerSection(base, head) {
	const limit = head.worker.limit
	const pct = (head.worker.gz / limit) * 100
	const icon = pct >= 90 ? '🔴' : pct >= 75 ? '🟠' : '🟢'
	return [
		`${icon} **${formatMB(head.worker.gz)} gzipped — ${pct.toFixed(1)}% of Cloudflare's ${formatMB(limit)} deploy limit.**`,
		'',
		sizeTable(head.worker.raw, head.worker.gz, base.worker.raw, base.worker.gz),
	].join('\n')
}

/**
 * Compare eager chunks by identity, not size.
 *
 * This is the axis people miss. A chunk whose content hash is unchanged is
 * still in returning visitors' caches. A PR that adds 2 kB to one has really
 * cost every returning visitor the WHOLE chunk again, which may be 200 kB. So
 * report which chunks changed first, and their sizes second.
 */
function chunkSection(base, head) {
	const names = [
		...new Set([...Object.keys(base.eagerChunks), ...Object.keys(head.eagerChunks)]),
	].sort()
	if (!names.length) return '_No files in the eager set._'

	const changed = []
	let cachedRaw = 0
	let cachedGz = 0
	let cachedCount = 0

	for (const n of names) {
		const b = base.eagerChunks[n]
		const h = head.eagerChunks[n]
		if (b && h && b.file === h.file) {
			cachedCount++
			cachedRaw += h.raw
			cachedGz += h.gz
		} else {
			changed.push({ n, b, h })
		}
	}

	if (!changed.length) {
		return (
			`✅ **Every eager chunk keeps its hash** — ${cachedCount} file(s) totalling ` +
			`${formatBytes(cachedRaw)} raw (${formatBytes(cachedGz)} gzipped), still cached for repeat visitors.`
		)
	}

	const rows = changed.map(({ n, b, h }) => {
		if (!b) return `- 🆕 \`${n}\` added — ${formatBytes(h.raw)} raw (${formatBytes(h.gz)} gz)`
		if (!h) return `- ❌ \`${n}\` removed — was ${formatBytes(b.raw)} raw`
		// deltaLabel supplies the direction emoji: a chunk that shrank must not
		// render as growth.
		return `- \`${n}\` — ${formatBytes(b.raw)} → ${formatBytes(h.raw)} raw, ${deltaLabel(h.raw, b.raw)}`
	})
	const stable = cachedCount
		? `\n\n${cachedCount} other file(s) keep their hash — ${formatBytes(cachedRaw)} raw (${formatBytes(cachedGz)} gz), still cached.`
		: ''
	return `**Chunks that changed — repeat visitors re-download these in full:**\n${rows.join('\n')}${stable}`
}

module.exports = function render({ head, base, out }) {
	fs.mkdirSync(out, { recursive: true })
	const h = load(head)
	const b = load(base)

	// A missing measurement means a build failed. Say so rather than rendering
	// a delta against zeros, which would read as "the whole bundle is new".
	//
	// An EMPTY measurement is the same failure wearing a disguise: a build that
	// exits zero and writes nothing would otherwise report a triumphant −100%.
	const empty = (m) => !m || !m.fileCount
	if (empty(h) || empty(b)) {
		const which =
			empty(h) && empty(b)
				? 'Neither build produced a measurable bundle'
				: empty(h)
					? 'The PR build produced no measurable bundle'
					: 'The base build produced no measurable bundle'
		fs.writeFileSync(
			path.join(out, '40-bundle.md'),
			`#### Bundle size\n\n⚠️ ${which}, so there is nothing to compare. Check the job log.`
		)
		fs.writeFileSync(
			path.join(out, '40-bundle.json'),
			JSON.stringify({ check: 'bundle', missing: true }, null, 2)
		)
		return
	}

	// The eager set comes from the TanStack Start route manifest. When that
	// cannot be read the measurement counts every client chunk as eager, which
	// inflates the number — say so rather than let it read as a regression.
	const fallback =
		h.eagerSource === 'start-manifest'
			? null
			: '⚠️ The root route manifest could not be read, so every client chunk is counted as eager. ' +
				'The eager and lazy numbers below are not comparable with earlier runs.'

	const markdown = [
		'#### Bundle size',
		'',
		'Report only — there is no budget on these numbers yet.',
		'',
		fallback,
		fallback ? '' : null,
		'**Worker** — `dist/server`, the code Cloudflare runs',
		'',
		workerSection(b, h),
		'',
		"**Eager client JS** — the root route's scripts and preloads, which every document loads",
		'',
		sizeTable(h.js.raw, h.js.gz, b.js.raw, b.js.gz),
		'',
		'**CSS** — render-blocking on first paint',
		'',
		sizeTable(h.css.raw, h.css.gz, b.css.raw, b.css.gz),
		'',
		`**Lazy route chunks** — ${h.lazy.count} file(s), ${formatBytes(h.lazy.gz)} gzipped · ` +
			`${deltaLabel(h.lazy.gz, b.lazy.gz)}. Fetched per route, so this is context rather than first-paint cost.`,
		'',
		// deltaLabel already carries the direction emoji — do not prefix another.
		`**Static files** (fonts, icons, robots.txt): ${formatBytes(h.static.raw)} raw · ` +
			`${deltaLabel(h.static.raw, b.static.raw)}`,
		'',
		chunkSection(b, h),
	]
		.filter((l) => l !== null)
		.join('\n')

	// Below the noise floor, report the eager delta as zero. Two builds of the
	// same commit differ by a few bytes, and a budget that trips on those
	// teaches people the number means nothing.
	const gzDelta = h.js.gz - b.js.gz
	fs.writeFileSync(path.join(out, '40-bundle.md'), markdown)
	fs.writeFileSync(
		path.join(out, '40-bundle.json'),
		JSON.stringify(
			{
				check: 'bundle',
				eagerRawDelta: h.js.raw - b.js.raw,
				eagerGzDelta: Math.abs(gzDelta) < NOISE_FLOOR ? 0 : gzDelta,
				eagerGzBase: b.js.gz,
				entryGzDelta: h.entry.gz - b.entry.gz,
				lazyGzDelta: h.lazy.gz - b.lazy.gz,
				workerGz: h.worker.gz,
				workerGzLimit: h.worker.limit,
				workerGzDelta: h.worker.gz - b.worker.gz,
				cssGzDelta: h.css.gz - b.css.gz,
			},
			null,
			2
		)
	)
}

module.exports.chunkSection = chunkSection
module.exports.workerSection = workerSection
module.exports.NOISE_FLOOR = NOISE_FLOOR
