/**
 * Read both measurements, post one comment, then decide the verdict.
 *
 * The comment goes up first and the verdict comes after, so a red run still
 * explains itself. A contributor who cannot see which check failed will guess,
 * and guessing costs more time than the check saved.
 *
 * This file holds every GitHub call. The diffing and the rendering live in
 * `lib/`, which makes no network calls and is exercised by the repository's own
 * vitest suite.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'

import type { Measurement } from './lib/measurement.ts'
import { MARKER, render } from './lib/render.ts'

const api = 'https://api.github.com'

const token = required('GITHUB_TOKEN')
const repository = required('GITHUB_REPOSITORY')
const pullNumber = required('PR_NUMBER')
const baseBranch = required('BASE_BRANCH')
const head = load(process.argv[2])
const base = load(process.argv[3])

const { body, blocking } = render({ base, head, baseBranch })

await upsertComment(body)

if (blocking.length === 0) {
	console.log('PR checks: nothing blocking.')
	process.exit(0)
}
console.error('PR checks blocking this merge:')
for (const reason of blocking) console.error(`  - ${reason}`)
process.exit(1)

// ---------------------------------------------------------------------------

/**
 * A tree counts as measured when its file is present and non-empty. Checking
 * that the artifact directory exists is weaker: a job that died right after
 * creating the directory would read as a clean bill of health.
 */
function load(path: string | undefined): Measurement | null {
	if (!path || !existsSync(path) || statSync(path).size === 0) return null
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Measurement
	} catch {
		return null
	}
}

/**
 * One comment, updated in place, matched on the hidden marker rather than on
 * the visible heading. Rewording the heading would orphan every comment already
 * on an open pull request, and the next run would post a second one beside it.
 *
 * The listing is paged: a busy pull request passes 100 comments, and a
 * single-page lookup then stops finding the comment this workflow wrote — at
 * exactly the moment the thread is already long.
 */
async function upsertComment(commentBody: string) {
	let page = 1
	while (page < 50) {
		const comments = (await gh(
			`/repos/${repository}/issues/${pullNumber}/comments?per_page=100&page=${page}`
		)) as { id: number; body?: string }[]
		if (comments.length === 0) break
		const existing = comments.find((comment) => comment.body?.includes(MARKER))
		if (existing) {
			await gh(`/repos/${repository}/issues/comments/${existing.id}`, 'PATCH', {
				body: commentBody,
			})
			console.log(`updated comment ${existing.id}`)
			return
		}
		page += 1
	}
	await gh(`/repos/${repository}/issues/${pullNumber}/comments`, 'POST', { body: commentBody })
	console.log('posted a new comment')
}

async function gh(path: string, method = 'GET', payload?: unknown): Promise<unknown> {
	const response = await fetch(`${api}${path}`, {
		method,
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${token}`,
			'x-github-api-version': '2022-11-28',
			'content-type': 'application/json',
		},
		body: payload === undefined ? undefined : JSON.stringify(payload),
	})
	if (!response.ok)
		throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`)
	return response.json()
}

function required(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`report.ts needs ${name} in the environment`)
	return value
}
