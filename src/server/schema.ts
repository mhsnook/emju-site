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
