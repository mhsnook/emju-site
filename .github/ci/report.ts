/**
 * The platform half: read both measurements, render the report, keep one
 * comment on the pull request up to date, then gate.
 *
 * The comment goes up before the gate decides, so a red run still explains
 * itself. Everything worth testing lives in delta.ts, which this file only
 * calls.
 */

import fs from 'node:fs'
import process from 'node:process'

import { buildReport, MARKER } from './delta.ts'
import type { TreeMeasurement } from './types.ts'

const readMeasurement = (file: string): TreeMeasurement | null => {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8')) as TreeMeasurement
	} catch {
		// A job that died writes no file. That blocks; it is not "no change".
		process.stderr.write(`no measurement at ${file}\n`)
		return null
	}
}

const api = async (url: string, init: RequestInit = {}) => {
	const response = await fetch(url, {
		...init,
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
			'content-type': 'application/json',
			...init.headers,
		},
	})
	if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${response.status}`)
	return response.json()
}

/** Match on the hidden marker, never on the visible heading: rewording the
 * heading orphans every comment already on an open PR. */
async function upsertComment(repo: string, pr: string, body: string) {
	const base = `https://api.github.com/repos/${repo}`
	for (let page = 1; page <= 10; page++) {
		const comments = (await api(`${base}/issues/${pr}/comments?per_page=100&page=${page}`)) as {
			id: number
			body: string
		}[]
		const mine = comments.find((comment) => comment.body?.includes(MARKER))
		if (mine) {
			await api(`${base}/issues/comments/${mine.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ body }),
			})
			return
		}
		if (comments.length < 100) break
	}
	await api(`${base}/issues/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
}

const head = readMeasurement('measurements/head.json')
const base = readMeasurement('measurements/base.json')
const report = buildReport(head, base, process.env.BASE_REF || 'main')

process.stdout.write(`${report.body}\n`)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.body)

const repo = process.env.GITHUB_REPOSITORY
const pr = process.env.PR_NUMBER
if (repo && pr && process.env.GITHUB_TOKEN) {
	try {
		await upsertComment(repo, pr, report.body)
	} catch (error) {
		// A pull request from a fork gets a read-only token, so the comment
		// cannot be written. The gate below still runs.
		process.stderr.write(`could not write the comment: ${String(error)}\n`)
	}
}

if (report.blocking.length) {
	process.stderr.write(`\nBlocking:\n${report.blocking.map((r) => `- ${r}`).join('\n')}\n`)
	process.exit(1)
}
