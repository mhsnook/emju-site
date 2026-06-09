import { should } from '@scenetest/checks-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Code2, Network, LayoutDashboard, Users, ArrowRight, ExternalLink } from 'lucide-react'

import {
	hero,
	services,
	approach,
	projects,
	potentials,
	contact,
	type Service,
} from '../content/site'

export const Route = createFileRoute('/')({ component: Home })

const icons = {
	Code2,
	Network,
	LayoutDashboard,
	Users,
} satisfies Record<Service['icon'], typeof Code2>

function Home() {
	should('home should render all services', services.length === 4)

	return (
		<>
			<Hero />
			<Services />
			<Approach />
			<Projects />
			{/* <Potentials /> */}
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
				<p className="my-6 font-bold">Some things we could build...</p>
				<ul className="text-base-content/70 ms-4 grid list-disc space-y-4 sm:grid-cols-2 md:grid-cols-3">
					{potentials.map((item) => (
						<li key={item.name}>{item.name}</li>
					))}
				</ul>
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

function Potentials() {
	return (
		<section
			id="potentials"
			data-testid="potentials"
			className="mx-auto max-w-5xl scroll-mt-20 px-5 py-10"
		>
			<SectionHeading eyebrow="Project Ideas" title="What if we tried..." />
			<div className="mt-10 grid gap-2 sm:grid-cols-2">
				{potentials.map((project) => (
					<article
						key={project.name}
						data-testid="potentials-card"
						data-key={project.name}
						className="rounded-box bg-base-100 hover:border-primary/60 border border-transparent p-4"
					>
						<span className="badge badge-outline badge-neutral bg-neutral/10 font-ui -mt-1 mb-1 text-xs">
							{project.tag}
						</span>
						<h3 className="font-display text-base-content/80 text-xl">{project.name}</h3>
						<p className="text-base-content/70 mt-3 leading-relaxed">{project.body}</p>
					</article>
				))}
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
