import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Inbound contact submissions, stored in Cloudflare D1 (SQLite). We persist
 * every message so nothing is lost if the notification email fails to send.
 */
export const contactSubmissions = sqliteTable('contact_submissions', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	email: text('email').notNull(),
	company: text('company'),
	message: text('message').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
})

export type ContactSubmission = typeof contactSubmissions.$inferSelect
export type NewContactSubmission = typeof contactSubmissions.$inferInsert

/**
 * Editable "Project Ideas" shown on the home page. There's no admin UI — edit
 * rows directly with `wrangler d1 execute` (see README). `sort` controls order
 * (ascending); `id` defaults to a random hex so manual INSERTs can omit it.
 */
export const projectIdeas = sqliteTable('project_ideas', {
	id: text('id')
		.primaryKey()
		.default(sql`(lower(hex(randomblob(16))))`),
	sort: integer('sort').notNull().default(0),
	name: text('name').notNull(),
	tag: text('tag'),
	body: text('body'),
})

export type ProjectIdea = typeof projectIdeas.$inferSelect
export type NewProjectIdea = typeof projectIdeas.$inferInsert
