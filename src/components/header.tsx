import { Link } from '@tanstack/react-router'

import { company } from '../content/site'

export function Header() {
	return (
		<header
			data-testid="site-header"
			className="border-base-300 bg-base-100/85 sticky top-0 z-30 border-b backdrop-blur"
		>
			<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
				<Link
					to="/"
					aria-label="EMJU home"
					className="font-display text-base-content text-2xl tracking-tight"
				>
					{company.name}
					<span className="text-primary">.</span>
				</Link>

				<nav aria-label="Primary" className="font-ui flex items-center gap-1">
					<ul className="hidden items-center gap-1 sm:flex">
						{/*nav.slice(0, -1).map((item) => (
							<li key={item.href}>
								<a
									href={item.href}
									className="rounded-field text-base-content/70 hover:bg-base-200 hover:text-base-content px-3 py-2 text-sm transition-colors"
								>
									{item.label}
								</a>
							</li>
						))*/}
					</ul>
					<Link to="/contact" data-testid="header-contact-link" className="btn btn-primary">
						Get in touch
					</Link>
				</nav>
			</div>
		</header>
	)
}
