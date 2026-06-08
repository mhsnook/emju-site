import { describe, it, expect } from 'vitest'

import { isValidEmail, validateContact } from './validation'

describe('isValidEmail', () => {
	it('accepts ordinary addresses', () => {
		expect(isValidEmail('a@b.co')).toBe(true)
		expect(isValidEmail('  trimmed@example.com  ')).toBe(true)
	})

	it('rejects malformed addresses', () => {
		expect(isValidEmail('nope')).toBe(false)
		expect(isValidEmail('a@b')).toBe(false)
		expect(isValidEmail('a @b.co')).toBe(false)
		expect(isValidEmail('')).toBe(false)
	})
})

describe('validateContact', () => {
	const good = {
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		company: 'Analytical Engines',
		message: 'We would love some help wiring up a dashboard.',
	}

	it('passes a complete, valid submission', () => {
		const result = validateContact(good)
		expect(result.ok).toBe(true)
		expect(result.errors).toEqual({})
	})

	it('treats company as optional', () => {
		const result = validateContact({ ...good, company: '' })
		expect(result.ok).toBe(true)
	})

	it('trims whitespace into the returned value', () => {
		const result = validateContact({ ...good, name: '  Ada  ' })
		expect(result.value.name).toBe('Ada')
	})

	it('flags a missing name', () => {
		const result = validateContact({ ...good, name: 'A' })
		expect(result.ok).toBe(false)
		expect(result.errors.name).toBeDefined()
	})

	it('flags a bad email', () => {
		const result = validateContact({ ...good, email: 'not-an-email' })
		expect(result.ok).toBe(false)
		expect(result.errors.email).toBeDefined()
	})

	it('flags a too-short message', () => {
		const result = validateContact({ ...good, message: 'hi' })
		expect(result.ok).toBe(false)
		expect(result.errors.message).toBeDefined()
	})
})
