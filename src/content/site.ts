/**
 * Site content. Everything here is plain data so it can later be swapped for a
 * database-backed source without touching the components that render it.
 */

export const company = {
	name: 'EMJU ed/tech',
	legalName: 'EMJU Education & Technology Services, Pvt Ltd',
	tagline:
		'Software consulting, team process, and product incubation for the education and technology sectors.',
	registration: 'Registered company in Bangalore, KA, India.',
	email: 'hello@emju.in',
} as const

export const hero = {
	kicker: '',
	title: 'Software Consulting & Incubation',
	body: 'EMJU is a small consulting firm specializing in Software Design, Development, Information Delivery, and Team Processes. \
  We work with small teams to fill gaps in infrastructure in the dynamic landscape of information and education communications software.',
	primaryCta: { label: 'Get in touch', to: '/contact' },
	secondaryCta: { label: 'Services', href: '#services' },
} as const

export type Service = {
	title: string
	body: string
	/** lucide-react icon name, resolved in the component */
	icon: 'Code2' | 'Network' | 'LayoutDashboard' | 'Users'
}

export const services: Array<Service> = [
	{
		title: 'Software design & development',
		body: 'Custom applications, services, and integrations – built to integrate with and supercharge your existing stack.',
		icon: 'Code2',
	},
	{
		title: 'Team process & structure',
		body: 'Help your engineers build momentum and work in big chunks, while meeting your program teams’ most pressing needs.',
		icon: 'Network',
	},
	{
		title: 'Information presentation',
		body: 'From longform teaching materials to daily reporting: thoughtful interfaces can make all the difference.',
		icon: 'LayoutDashboard',
	},
	{
		title: 'Audience insights',
		body: 'Understand who you are serving and what they need, then turn that understanding into product and strategy.',
		icon: 'Users',
	},
]

export const approach = {
	title: 'Lean by default, but not afraid to build.',
	body: `We’re a small team trying to help other small teams
	go through big changes. You’re moving in-house, or building your own data pipeline, or unifying your design language?
	These can be the best projects you’ll ever do, but you need a little extra headspace to do them well.`,
	points: [
		{
			title: 'Work with your cycle',
			body: `Engineers need well organized work to build with momeuntum,
			but your program teams have urgent needs that can disrupt that flow. We understand the tension, and we can help ⏳️🏖️🚀`,
		},
		{
			title: 'Try new things, safely',
			body: `Once we get to know your infrastructure and your organization,
			we can architect solutions that leverage the reliability of your core stack while building new things 🌳🛟🌱`,
		},
		{
			title: 'Open source and Accessible',
			body: `We are a team of nerds who love the internet, accessibility standards, the open web and the people who build it.
			We love to build on other people’s open source projects, and give back 🖥️🌐🌟`,
		},
	],
} as const

export type Project = {
	name: string
	url?: string
	status: string
	body: string
}

export type Potential = {
	name: string
	tag?: string
	body?: string
}

export const projects: Array<Project> = [
	{
		name: 'Sunlo',
		url: 'https://sunlo.app',
		status: 'In incubation',
		body: 'A language-learning app being incubated under the EMJU banner – our own product bet, full featured, but built with a lean approach.',
	},
	{
		name: 'Co-incubation',
		status: 'Open invitation',
		body: 'Got an idea worth building? We are open to partner to co-incubate new products. If that sounds like you, get in touch.',
	},
]

export const potentials: Array<Potential> = [
	{
		name: 'Add health checks to core tools',
		tag: 'reliability & dev speed',
		body: `The more we build and publish, the more important it is to have robust tools for checking our work, both before we deploy and after. You might want to keep your eng team focused on moving forward; we can handle details like this.`,
	},
	{
		name: 'Prototype your own data pipeline',
		tag: 'data & analytics',
		body: `There are a bunch of options for data pipelines to choose from; if you want, we can wire one up and see how it feels? We’ll get from zero-to-1 quickly, and get something in our analysts’ hands in just a few weeks.`,
	},
	{
		name: 'Build a microsite (and show it off)',
		tag: 'campaign launch',
		body: `Maybe you’ve been working with old templates for a while and you just want to build something beautiful from scratch. We can do this work quickly, and as we go, build re-useable components so a throw-away site can help to modernize processes.`,
	},
	{
		name: 'Turn your brand into a design system',
		tag: 'design systems',
		body: `After your brand designer hands in their work, you might be left missing a crucual component: a showcase site for future designers and developers to refer to, with colour values, css snippets, react components, etc.`,
	},
	{
		name: 'Build a totally new experience',
		tag: 'UX innovation',
		body: `You have an idea, and it could be brilliant, but you’re a long way from firming it up or building institutional support. We need to start small, but it has to
		be big enough to show the value. This is tricky, but exciting work!`,
	},
	{
		name: 'Rebuild some infrastructure',
		tag: 'modernize',
		body: `Sometimes you have to bite down hard and just rebuild something from the ground up. But you need it to be lean, reliable, and maintainable once it’s done. (Fewer headaches please, not more.)
		We get it. We can help.`,
	},
	{
		name: 'Leadership coaching',
		tag: 'skill up & structure',
		body: `We have years of experience coaching tech leaders in the sector, whether you’re an engineer moving into management, or a PM moving into a more technical role, we can help you
		find your own rhythm, and build the levers and utilities that make you feel at home in your role.`,
	},
	{
		name: 'Product/team roadmapping',
		tag: 'team support',
		body: ``,
	},
]

export const contact = {
	title: 'Let’s talk.',
	body: 'Tell us a little about what you are working on and how to reach you. We read everything and reply personally.',
} as const

export const nav = [
	{ label: 'Services', href: '/#services' },
	{ label: 'Approach', href: '/#approach' },
	{ label: 'Projects', href: '/#projects' },
	{ label: 'Contact', href: '/contact' },
] as const
