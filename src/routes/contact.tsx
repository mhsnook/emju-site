import { createFileRoute } from '@tanstack/react-router'

import { ContactForm } from '../components/contact-form'
import { company, contact } from '../content/site'
import { getPublicConfig } from '../server/contact'

export const Route = createFileRoute('/contact')({
	loader: () => getPublicConfig(),
	head: () => ({
		meta: [{ title: 'Contact — EMJU' }],
	}),
	component: Contact,
})

function Contact() {
	const { turnstileSiteKey } = Route.useLoaderData()

	return (
		<section data-testid="contact-page" className="mx-auto max-w-2xl px-5 pt-20 pb-8">
			<p className="font-ui text-neutral text-sm font-medium tracking-widest uppercase">
				Get in touch
			</p>
			<h1 className="font-display text-base-content mt-3 text-5xl leading-tight">
				{contact.title}
			</h1>
			<p className="text-base-content/75 mt-5 max-w-xl text-lg leading-relaxed">
				{contact.body}
			</p>
			<p className="font-ui text-base-content/60 mt-2 text-sm">
				Prefer email? Reach us at{' '}
				<a href={`mailto:${company.email}`} className="text-neutral hover:underline">
					{company.email}
				</a>
				.
			</p>

			<div className="mt-10">
				<ContactForm turnstileSiteKey={turnstileSiteKey} />
			</div>
		</section>
	)
}
