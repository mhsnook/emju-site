/**
 * Cloudflare Turnstile test keys — public, well-known values that always pass.
 * Kept in a client-safe module (no server imports) so both the form and the
 * server function can recognize "test mode".
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA'

/** A real key is anything other than the always-pass test site key. */
export function isRealTurnstileKey(siteKey: string): boolean {
	return siteKey !== TURNSTILE_TEST_SITE_KEY
}
