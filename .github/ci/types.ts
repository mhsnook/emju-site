/**
 * The shape the measuring jobs write and the report job reads.
 *
 * Every check carries its own `ran` flag. A check that could not run writes
 * `ran: false` rather than an empty result, because an empty result is
 * indistinguishable from a clean tree. A job that dies writes no file at all.
 * The report blocks on both.
 */

export type TreeName = 'head' | 'base'

export type Issue = {
	file: string
	line: number
	column: number
	message: string
}

export type BuildOutcome = {
	ok: boolean
	/** The first lines of the build log from the first error onward. */
	firstError: string[]
}

export type BundleMeasurement = {
	/**
	 * Which instrument found the eager set. `route-manifest` reads the
	 * TanStack Start route manifest out of the server build; `directory-walk`
	 * is the fallback, and it counts every client chunk as eager.
	 */
	source: 'route-manifest' | 'directory-walk'
	/** Guards against a build that exits zero having written nothing. */
	fileCount: number
	eager: SizeGroup
	css: SizeGroup
	lazy: SizeGroup
	/** Stable chunk name to content hash, for the cache-identity axis. */
	chunks: Record<string, string>
	/** From `wrangler deploy --dry-run`: the bytes a deploy would upload. */
	worker: { raw: number; gzip: number } | null
}

export type SizeGroup = {
	raw: number
	gzip: number
	files: string[]
}

export type TestMeasurement = {
	ran: boolean
	total: number
	passed: number
	failed: number
	/** One line per failing test, capped by the measuring script. */
	failures: string[]
}

export type TreeMeasurement = {
	tree: TreeName
	sha: string
	build: BuildOutcome
	typecheck: { ran: boolean; issues: Issue[] }
	lint: { ran: boolean; issues: Issue[] }
	format: { ran: boolean; unformatted: string[] }
	bundle: BundleMeasurement | null
	/** Head only. The files this pull request adds or changes. */
	touched: string[] | null
	/** Head only. */
	tests: TestMeasurement | null
}
