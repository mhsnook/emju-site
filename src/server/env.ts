import { env } from 'cloudflare:workers'

export { TURNSTILE_TEST_SITE_KEY, TURNSTILE_TEST_SECRET_KEY } from '../lib/turnstile'

/**
 * Typed view of the Cloudflare Worker environment.
 *
 * `cloudflare:workers` exposes a live binding that is safe to read even at
 * module scope (unlike `process.env`, which is empty on Workers). Secrets are
 * set with `wrangler secret put`; non-secret vars and bindings live in
 * `wrangler.jsonc`. In local dev, secret values come from `.dev.vars`.
 */
export interface AppEnv {
	/** D1 (SQLite) binding — the contact submissions store. */
	DB?: D1Database
	/** Cloudflare Email Routing send binding. */
	SEND_EMAIL?: SendEmail

	/** Inbox that receives contact notifications (a verified Email Routing destination). */
	CONTACT_NOTIFY_EMAIL?: string
	/** "From" address for outbound mail (must be on an Email-Routing domain). */
	CONTACT_FROM_EMAIL?: string

	/** Cloudflare Turnstile keys. */
	TURNSTILE_SECRET_KEY?: string
	TURNSTILE_SITE_KEY?: string
}

export function getEnv(): AppEnv {
	return env as unknown as AppEnv
}
