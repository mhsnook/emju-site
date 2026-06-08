import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import { Footer } from '../components/footer'
import { Header } from '../components/header'
import { company } from '../content/site'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{
				title: 'EMJU — Education & Technology Services',
			},
			{
				name: 'description',
				content:
					'EMJU is a senior consulting firm for hire: software design & development, team process & structure, information presentation, and audience insights. Lean solutions and the glue your team is missing.',
			},
			{ property: 'og:title', content: 'EMJU — Education & Technology Services' },
			{ property: 'og:description', content: company.tagline },
			{ property: 'og:type', content: 'website' },
		],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-theme="emju">
			<head>
				<HeadContent />
			</head>
			<body>
				<div className="bg-base-100 text-base-content flex min-h-screen flex-col">
					<Header />
					<main id="main-content" data-testid="main-content" className="flex-1">
						{children}
					</main>
					<Footer />
				</div>
				<Scripts />
			</body>
		</html>
	)
}
