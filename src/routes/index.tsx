import { should } from '@scenetest/checks-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Code2, Network, LayoutDashboard, Users, ArrowRight, ExternalLink } from 'lucide-react'
import { useState } from 'react'

import { hero, services, approach, projects, contact, type Potential, type Service } from '../content/site'
import { getProjectIdeas } from '../server/content'

export const Route = createFileRoute('/')({
	loader: () => getProjectIdeas(),
	component: Home,
})

const icons = {
	Code2,
	Network,
	LayoutDashboard,
	Users,
} satisfies Record<Service['icon'], typeof Code2>

function Home() {
	should('home should render all services', services.length === 4)
	const ideas = Route.useLoaderData()

	return (
		<>
			<Hero />
			<Services />
			<Approach />
			<Projects />
			<Potentials ideas={ideas} />
			<ContactCta />
		</>
	)
}

function Hero() {
	return (
		<section data-testid="hero" className="mx-auto max-w-5xl px-5 pt-20 pb-16">
			<p className="font-ui text-neutral text-sm font-medium tracking-widest uppercase">
				{hero.kicker}
			</p>
			<h1 className="font-display text-base-content mt-4 max-w-3xl text-5xl leading-[1.05] sm:text-6xl">
				{hero.title}
			</h1>
			<p className="text-base-content/75 mt-6 max-w-2xl text-lg leading-relaxed">{hero.body}</p>
			<div className="font-ui mt-9 flex flex-wrap items-center gap-3">
				<Link to="/contact" data-testid="hero-contact-link" className="btn btn-primary">
					{hero.primaryCta.label}
					<ArrowRight className="size-4" />
				</Link>
				{/*<a href={hero.secondaryCta.href} className="btn btn-ghost">
					{hero.secondaryCta.label}
				</a>*/}
			</div>
		</section>
	)
}

function Services() {
	return (
		<section
			id="services"
			data-testid="services"
			className="mx-auto max-w-5xl scroll-mt-20 px-5 py-16"
		>
			<SectionHeading eyebrow="Services" title="What we're best at" />
			<div className="mt-10 grid gap-4 sm:grid-cols-2">
				{services.map((service) => {
					const Icon = icons[service.icon]
					return (
						<article
							key={service.title}
							data-testid="service-card"
							data-key={service.icon}
							className="rounded-box border-base-300 bg-base-100 hover:border-primary/60 border p-6 transition-colors"
						>
							<Icon className="text-neutral size-6" aria-hidden />
							<h3 className="font-ui text-base-content mt-4 text-lg font-semibold">
								{service.title}
							</h3>
							<p className="text-base-content/70 mt-2 leading-relaxed">{service.body}</p>
						</article>
					)
				})}
			</div>
		</section>
	)
}

function Approach() {
	return (
		<section id="approach" data-testid="approach" className="bg-base-200 scroll-mt-20">
			<div className="mx-auto max-w-5xl px-5 py-16">
				<SectionHeading eyebrow="Our approach" title={approach.title} />
				<p className="text-base-content/75 mt-6 max-w-2xl text-lg leading-relaxed">
					{approach.body}
				</p>
				<div className="mt-10 grid gap-8 sm:grid-cols-3">
					{approach.points.map((point) => (
						<div key={point.title}>
							<h3 className="font-ui text-base-content text-base font-semibold">
								{point.title}
							</h3>
							<p className="text-base-content/70 mt-2 leading-relaxed">{point.body}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}

function Projects() {
	return (
		<section
			id="projects"
			data-testid="projects"
			className="mx-auto max-w-5xl scroll-mt-20 px-5 py-16"
		>
			<SectionHeading eyebrow="Projects" title="What we are building under our own banner." />
			<div className="mt-10 grid gap-4 sm:grid-cols-2">
				{projects.map((project) => (
					<article
						key={project.name}
						data-testid="project-card"
						data-key={project.name}
						className="rounded-box border-base-300 bg-base-100 hover:border-primary/60 border p-6"
					>
						<div className="flex items-center justify-between gap-3">
							<h3 className="font-display text-base-content text-2xl">{project.name}</h3>
							<span className="badge badge-outline font-ui text-xs">{project.status}</span>
						</div>
						<p className="text-base-content/70 mt-3 leading-relaxed">{project.body}</p>
						{project.url ? (
							<a
								href={project.url}
								target="_blank"
								rel="noreferrer"
								className="font-ui text-neutral mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
							>
								{project.url.replace(/^https?:\/\//, '')}
								<ExternalLink className="size-3.5" />
							</a>
						) : (
							<Link
								to="/contact"
								className="font-ui text-neutral mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
							>
								Get in touch
								<ArrowRight className="size-3.5" />
							</Link>
						)}
					</article>
				))}
			</div>
		</section>
	)
}

function Potentials({ ideas }: { ideas: Array<Potential> }) {
	const [active, setActive] = useState(0)
	const current = ideas[active]

	function onKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
		e.preventDefault()
		const dir = e.key === 'ArrowDown' ? 1 : -1
		setActive((active + dir + ideas.length) % ideas.length)
	}

	return (
		<section
			id="potentials"
			data-testid="potentials"
			className="mx-auto max-w-5xl scroll-mt-20 px-5 py-16"
		>
			<SectionHeading
				eyebrow="Project ideas · hover or arrow-key the list"
				title="What if we tried..."
			/>
			<div className="mt-10 grid items-start gap-8 md:grid-cols-2">
				<ul
					role="listbox"
					tabIndex={0}
					aria-label="Project ideas"
					aria-activedescendant={`potential-${active}`}
					onKeyDown={onKeyDown}
					data-testid="potentials-list"
					className="focus-visible:ring-primary/40 flex flex-col rounded focus:outline-none focus-visible:ring-2"
				>
					{ideas.map((item, i) => {
						const selected = i === active
						return (
							<li
								key={item.name}
								id={`potential-${i}`}
								role="option"
								aria-selected={selected}
								data-testid="potentials-item"
								data-key={item.name}
								onMouseEnter={() => setActive(i)}
								className={`font-display flex cursor-pointer items-baseline gap-3 border-l-2 py-2.5 pl-4 text-2xl leading-tight transition-colors ${selected ? 'border-primary text-base-content' : 'border-base-300 text-base-content/40 hover:text-base-content/70'}`}
							>
								<span className="font-ui text-base-content/40 pt-1 text-sm tabular-nums">
									{String(i + 1).padStart(2, '0')}
								</span>
								<span>{item.name}</span>
							</li>
						)
					})}
				</ul>

				<div
					data-testid="potentials-detail"
					className="rounded-box border-base-300 bg-base-200 border p-8"
				>
					<span className="badge badge-outline badge-neutral bg-neutral/10 font-ui text-xs">
						{current.tag}
					</span>
					<h3 className="font-display text-base-content mt-4 text-3xl leading-tight">
						{current.name}
					</h3>
					{current.body ? (
						<p className="text-base-content/70 mt-4 leading-relaxed">{current.body}</p>
					) : null}
				</div>
			</div>
		</section>
	)
}

function ContactCta() {
	return (
		<section data-testid="contact-cta" className="mx-auto max-w-5xl px-5 py-16">
			<div className="rounded-box bg-neutral text-neutral-content px-8 py-12 sm:px-12">
				<h2 className="font-display text-3xl sm:text-4xl">{contact.title}</h2>
				<p className="text-neutral-content/80 mt-3 max-w-xl leading-relaxed">{contact.body}</p>
				<Link
					to="/contact"
					data-testid="cta-contact-link"
					className="btn btn-primary font-ui mt-7"
				>
					Get in touch
					<ArrowRight className="size-4" />
				</Link>
			</div>
		</section>
	)
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
	return (
		<div className="max-w-2xl">
			<p className="font-ui text-neutral text-sm font-medium tracking-widest uppercase">
				{eyebrow}
			</p>
			<h2 className="font-display text-base-content mt-3 text-3xl leading-tight sm:text-4xl">
				{title}
			</h2>
		</div>
	)
}
