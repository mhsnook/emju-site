import { Turnstile } from '@marsidev/react-turnstile'
import { should } from '@scenetest/checks-react'
import { useServerFn } from '@tanstack/react-start'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { isRealTurnstileKey } from '../lib/turnstile'
import { validateContact, type ContactErrors } from '../lib/validation'
import { submitContact } from '../server/contact'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function ContactForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
	const submit = useServerFn(submitContact)
	// Only show the challenge when a real key is configured. In dev/CI the test
	// key is used, so we skip the widget (and its external script) entirely.
	const showTurnstile = isRealTurnstileKey(turnstileSiteKey)

	const [status, setStatus] = useState<Status>('idle')
	const [errors, setErrors] = useState<ContactErrors>({})
	const [formError, setFormError] = useState<string | null>(null)
	const [token, setToken] = useState<string | null>(showTurnstile ? null : 'test-key-bypass')

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		const form = new FormData(event.currentTarget)
		const fields = {
			name: String(form.get('name') ?? ''),
			email: String(form.get('email') ?? ''),
			company: String(form.get('company') ?? ''),
			message: String(form.get('message') ?? ''),
		}

		const { ok, errors: fieldErrors, value } = validateContact(fields)
		setErrors(fieldErrors)
		if (!ok) {
			setStatus('error')
			return
		}

		if (showTurnstile && !token) {
			setFormError('Please complete the verification challenge.')
			setStatus('error')
			return
		}

		setStatus('submitting')
		try {
			const result = await submit({
				data: { ...value, turnstileToken: token ?? 'test-key-bypass' },
			})
			should('submission should resolve with a result', result !== undefined)
			if (result.ok) {
				setStatus('success')
			} else {
				setFormError(result.error ?? 'Something went wrong. Please try again.')
				setStatus('error')
			}
		} catch {
			setFormError('Something went wrong. Please try again.')
			setStatus('error')
		}
	}

	if (status === 'success') {
		return (
			<div
				data-testid="contact-success"
				className="rounded-box border-success/30 bg-success/10 border p-8"
			>
				<CheckCircle2 className="text-success size-8" aria-hidden />
				<h2 className="font-display text-base-content mt-4 text-2xl">
					Thank you — message sent.
				</h2>
				<p className="text-base-content/70 mt-2 leading-relaxed">
					We’ve received your note and will get back to you personally. Talk soon.
				</p>
			</div>
		)
	}

	return (
		<form
			data-testid="contact-form"
			onSubmit={handleSubmit}
			noValidate
			className="font-ui grid gap-5"
		>
			<Field label="Name" htmlFor="name" error={errors.name}>
				<input
					id="name"
					name="name"
					type="text"
					autoComplete="name"
					data-testid="name-input"
					className="input input-bordered w-full"
					placeholder="Your name"
				/>
			</Field>

			<Field label="Email" htmlFor="email" error={errors.email}>
				<input
					id="email"
					name="email"
					type="email"
					autoComplete="email"
					data-testid="email-input"
					className="input input-bordered w-full"
					placeholder="you@company.com"
				/>
			</Field>

			<Field label="Company" htmlFor="company" error={errors.company} optional>
				<input
					id="company"
					name="company"
					type="text"
					autoComplete="organization"
					data-testid="company-input"
					className="input input-bordered w-full"
					placeholder="Where you work (optional)"
				/>
			</Field>

			<Field label="Message" htmlFor="message" error={errors.message}>
				<textarea
					id="message"
					name="message"
					rows={5}
					data-testid="message-input"
					className="textarea textarea-bordered w-full"
					placeholder="What are you working on, and how can we help?"
				/>
			</Field>

			{showTurnstile ? (
				<Turnstile
					siteKey={turnstileSiteKey}
					onSuccess={setToken}
					onExpire={() => setToken(null)}
					onError={() => setToken(null)}
					options={{ theme: 'light' }}
				/>
			) : null}

			{formError ? (
				<p data-testid="form-error" className="text-error text-sm" role="alert">
					{formError}
				</p>
			) : null}

			<div>
				<button
					type="submit"
					data-testid="submit-button"
					disabled={status === 'submitting'}
					className="btn btn-primary"
				>
					{status === 'submitting' ? 'Sending…' : 'Send message'}
					{status === 'submitting' ? null : <ArrowRight className="size-4" />}
				</button>
			</div>
		</form>
	)
}

function Field({
	label,
	htmlFor,
	error,
	optional,
	children,
}: {
	label: string
	htmlFor: string
	error?: string
	optional?: boolean
	children: React.ReactNode
}) {
	return (
		<div className="form-control">
			<label htmlFor={htmlFor} className="mb-1.5 flex items-baseline gap-2">
				<span className="text-base-content text-sm font-medium">{label}</span>
				{optional ? <span className="text-base-content/50 text-xs">optional</span> : null}
			</label>
			{children}
			{error ? (
				<span className="text-error mt-1 text-sm" role="alert">
					{error}
				</span>
			) : null}
		</div>
	)
}
