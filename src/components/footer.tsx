import { Link } from '@tanstack/react-router'

import { company } from '../content/site'

export function Footer() {
	const year = new Date().getFullYear()

	return (
		<footer data-testid="site-footer" className="border-base-300 bg-base-200 mt-24 border-t">
			<div className="mx-auto max-w-5xl px-5 py-12">
				<div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
					<div className="max-w-sm">
						<p className="font-display text-base-content text-xl">
							{company.name}
							<span className="text-primary">.</span>
						</p>
						<p className="font-ui text-base-content/60 mt-2 text-sm">{company.tagline}</p>
					</div>

					<nav aria-label="Footer" className="font-ui flex min-w-40 flex-col gap-2">
						<a href="/#services" className="text-base-content/70 hover:text-base-content">
							Services
						</a>
						<a href="/#projects" className="text-base-content/70 hover:text-base-content">
							Projects
						</a>
						<a href="/#potentials" className="text-base-content/70 hover:text-base-content">
							Project ideas
						</a>
						<Link to="/contact" className="text-base-content/70 hover:text-base-content">
							Contact
						</Link>
					</nav>
				</div>

				<div className="font-ui border-base-300 text-base-content/55 mt-10 border-t pt-6 text-xs leading-relaxed">
					<p data-testid="legal-name">{company.legalName}</p>
					<p>{company.registration}</p>
					<p className="mt-2">
						© {year} {company.legalName}. All rights reserved.
					</p>
				</div>
			</div>
		</footer>
	)
}
