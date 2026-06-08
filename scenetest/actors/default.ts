import type { TeamConfig } from '@scenetest/scenes'

/**
 * The site has no authentication, so a single anonymous visitor is all we need.
 * Each entry could be its own team for parallel runs; one is plenty here.
 */
export default [
	{
		visitor: { key: 'visitor-1', name: 'Ada Lovelace', email: 'ada@example.com' },
	},
] satisfies TeamConfig[]
