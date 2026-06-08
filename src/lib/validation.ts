/**
 * Pure, isomorphic validation for the contact form. No server or framework
 * imports here so it can run in the browser, on the server, and in unit tests.
 */

export interface ContactInput {
	name: string
	email: string
	company?: string
	message: string
	turnstileToken: string
}

export interface ContactFields {
	name: string
	email: string
	company: string
	message: string
}

export type ContactErrors = Partial<Record<keyof ContactFields, string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string): boolean {
	return EMAIL_RE.test(email.trim())
}

/** Validate the user-facing fields. Turnstile is checked server-side only. */
export function validateContact(input: Partial<ContactFields>): {
	ok: boolean
	errors: ContactErrors
	value: ContactFields
} {
	const value: ContactFields = {
		name: (input.name ?? '').trim(),
		email: (input.email ?? '').trim(),
		company: (input.company ?? '').trim(),
		message: (input.message ?? '').trim(),
	}

	const errors: ContactErrors = {}

	if (value.name.length < 2) {
		errors.name = 'Please tell us your name.'
	} else if (value.name.length > 120) {
		errors.name = 'That name is a little too long.'
	}

	if (!isValidEmail(value.email)) {
		errors.email = 'Please enter a valid email address.'
	}

	if (value.company.length > 160) {
		errors.company = 'That company name is a little too long.'
	}

	if (value.message.length < 10) {
		errors.message = 'A little more detail, please (at least 10 characters).'
	} else if (value.message.length > 5000) {
		errors.message = 'That message is too long (5000 characters max).'
	}

	return { ok: Object.keys(errors).length === 0, errors, value }
}
