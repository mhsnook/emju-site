// Reads both measurement files, renders the comment, posts it, then decides the verdict.
// The GitHub coupling lives here; the comparison and the rendering live in ci/delta.ts.
//
// Usage: node ci/report.ts --head .ci-out/head.json --base .ci-out/base.json

import { appendFileSync, existsSync, readFileSync } from 'node:fs'

import { MARKER, type Measurement, renderReport } from './delta.ts'

function readMeasurement(path: string | undefined): Measurement | null {
	// Absent, unreadable and empty are the same verdict, and none of them is "no change".
	if (!path || !existsSync(path)) return null
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as Measurement
		return parsed.checks ? parsed : null
	} catch {
		return null
	}
}

const api = 'https://api.github.com'

async function github(path: string, init: RequestInit = {}) {
	const response = await fetch(`${api}${path}`, {
		...init,
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
			'content-type': 'application/json',
			...init.headers,
		},
	})
	if (!response.ok)
		throw new Error(
			`${init.method ?? 'GET'} ${path} — ${response.status} ${await response.text()}`
		)
	return response.json()
}

async function findExistingComment(repo: string, issue: number) {
	// Page through: a busy PR passes 100 comments, and a single-page lookup then stops
	// finding the comment it wrote and starts posting a new one on every push.
	for (let page = 1; page <= 20; page += 1) {
		const comments = (await github(
			`/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`
		)) as Array<{ id: number; body: string }>
		const found = comments.find((comment) => comment.body?.includes(MARKER))
		if (found) return found
		if (comments.length < 100) return null
	}
	return null
}

async function postComment(body: string) {
	const repo = process.env.GITHUB_REPOSITORY
	const issue = Number(process.env.PR_NUMBER)
	if (!repo || !issue || !process.env.GITHUB_TOKEN) {
		console.log('no GitHub context, so the comment was not posted')
		return
	}
	const existing = await findExistingComment(repo, issue)
	if (existing) {
		await github(`/repos/${repo}/issues/comments/${existing.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ body }),
		})
	} else {
		await github(`/repos/${repo}/issues/${issue}/comments`, {
			method: 'POST',
			body: JSON.stringify({ body }),
		})
	}
}

const args = process.argv.slice(2)
const flag = (name: string) => args[args.indexOf(name) + 1]

const report = renderReport({
	head: readMeasurement(flag('--head')),
	base: readMeasurement(flag('--base')),
	baseRef: process.env.BASE_REF ?? 'main',
})

console.log(report.body)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.body)

// Report first, gate second: a contributor who cannot see why it failed will guess. A
// fork PR gets a read-only token, so posting can fail while the gate still stands.
try {
	await postComment(report.body)
} catch (error) {
	console.log(`the comment could not be posted: ${String(error)}`)
}

if (report.blocking.length > 0) {
	for (const reason of report.blocking) console.log(`blocking: ${reason}`)
	process.exit(1)
}
