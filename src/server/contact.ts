import { createServerFn } from '@tanstack/react-start'
import { EmailMessage } from 'cloudflare:email'
import { createMimeMessage, Mailbox } from 'mimetext'

import { validateContact, type ContactInput } from '../lib/validation'
import { getDb } from './db'
import { getEnv, TURNSTILE_TEST_SECRET_KEY, TURNSTILE_TEST_SITE_KEY } from './env'
import { contactSubmissions } from './schema'

export interface ContactResult {
	ok: boolean
	/** Field-level errors (validation) or a general error message. */
	error?: string
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

async function verifyTurnstile(token: string): Promise<boolean> {
	const secret = getEnv().TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_SECRET_KEY

	// The test secret always passes by design; short-circuit so local dev and CI
	// work without reaching Cloudflare. Real secrets are verified for real.
	if (secret === TURNSTILE_TEST_SECRET_KEY) return true

	const body = new FormData()
	body.append('secret', secret)
	body.append('response', token)

	try {
		const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body })
		const data = (await res.json()) as { success: boolean }
		return data.success === true
	} catch {
		return false
	}
}

/**
 * Handle a contact submission: verify the Turnstile token, persist the message
 * to D1 (if bound), and send a notification email via the Email Routing
 * `send_email` binding (if bound). Both steps degrade gracefully so the form
 * still works in local dev — see README for the bindings to set up in prod.
 */
export const submitContact = createServerFn({ method: 'POST' })
	.validator((data: ContactInput) => data)
	.handler(async ({ data }): Promise<ContactResult> => {
		const { ok, value } = validateContact(data)
		if (!ok) {
			return { ok: false, error: 'Please check the form and try again.' }
		}

		const human = await verifyTurnstile(data.turnstileToken ?? '')
		if (!human) {
			return { ok: false, error: 'Could not verify you are human. Please retry.' }
		}

		const env = getEnv()

		// Persist to D1. A missing/empty DB is non-fatal; logged for visibility.
		try {
			const db = getDb()
			if (db) {
				await db.insert(contactSubmissions).values({
					name: value.name,
					email: value.email,
					company: value.company || null,
					message: value.message,
				})
			} else {
				console.warn('[contact] D1 not bound; submission not stored.')
			}
		} catch (err) {
			console.error('[contact] Failed to store submission:', err)
		}

		// Notify via the Cloudflare Email Routing send_email binding.
		if (env.SEND_EMAIL && env.CONTACT_NOTIFY_EMAIL && env.CONTACT_FROM_EMAIL) {
			try {
				const msg = createMimeMessage()
				msg.setSender({ name: 'EMJU site', addr: env.CONTACT_FROM_EMAIL })
				msg.setRecipient(env.CONTACT_NOTIFY_EMAIL)
				msg.setHeader('Reply-To', new Mailbox(value.email))
				msg.setSubject(`New enquiry from ${value.name}`)
				msg.addMessage({
					contentType: 'text/plain',
					data: [
						`Name: ${value.name}`,
						`Email: ${value.email}`,
						`Company: ${value.company || '—'}`,
						'',
						value.message,
					].join('\n'),
				})

				const message = new EmailMessage(
					env.CONTACT_FROM_EMAIL,
					env.CONTACT_NOTIFY_EMAIL,
					msg.asRaw()
				)
				await env.SEND_EMAIL.send(message)
			} catch (err) {
				console.error('[contact] Failed to send notification email:', err)
			}
		} else {
			console.warn('[contact] Email binding not configured; no email sent.')
		}

		return { ok: true }
	})

/** Expose the public Turnstile site key to the client. */
export const getPublicConfig = createServerFn({ method: 'GET' }).handler(async () => {
	return {
		turnstileSiteKey: getEnv().TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY,
	}
})
