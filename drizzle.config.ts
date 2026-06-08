import { defineConfig } from 'drizzle-kit'

/**
 * Generates SQLite migrations for Cloudflare D1 into ./drizzle. Apply them with
 * `pnpm db:migrate` (local) / `pnpm db:migrate:prod` (remote), which call
 * `wrangler d1 migrations apply`.
 */
export default defineConfig({
	schema: './src/server/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
})
