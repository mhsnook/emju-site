import { drizzle } from 'drizzle-orm/d1'

import { getEnv } from './env'
import * as schema from './schema'

/**
 * Drizzle client backed by the Cloudflare D1 binding, or `null` if D1 isn't
 * bound. Returning `null` lets the contact flow degrade gracefully (e.g. in a
 * stripped-down preview) instead of hard-failing.
 */
export function getDb() {
	const db = getEnv().DB
	if (!db) return null
	return drizzle(db, { schema })
}
