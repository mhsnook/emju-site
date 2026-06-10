import { createServerFn } from '@tanstack/react-start'
import { asc } from 'drizzle-orm'

import { potentials as fallbackIdeas, type Potential } from '../content/site'
import { getDb } from './db'
import { projectIdeas } from './schema'

/**
 * Load the home page's "Project Ideas" from D1, ordered by `sort`. Falls back
 * to the static list in `content/site.ts` when D1 is unbound or empty, so the
 * page always renders something even before the table is seeded.
 */
export const getProjectIdeas = createServerFn({ method: 'GET' }).handler(
	async (): Promise<Array<Potential>> => {
		const db = getDb()
		if (!db) return fallbackIdeas

		try {
			const rows = await db.select().from(projectIdeas).orderBy(asc(projectIdeas.sort))
			if (rows.length === 0) return fallbackIdeas
			return rows.map((r) => ({
				name: r.name,
				tag: r.tag ?? undefined,
				body: r.body ?? undefined,
			}))
		} catch (err) {
			console.error('[content] Failed to load project ideas:', err)
			return fallbackIdeas
		}
	}
)
