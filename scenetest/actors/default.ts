import type { TeamConfig } from '@scenetest/scenes'

/**
 * The site has no authentication, so an anonymous visitor is all the marketing
 * pages need. `keeper` is the same person with a pomodance ledger already in
 * localStorage: a finished pomo on a fixed day, filed under the day the page
 * will open on, so scenes can work with a ledger they did not have to sit
 * through in real time.
 */
const KEEPER_DAY = '2026-01-15'
const KEEPER_LEDGER = [
	{
		id: 'keeper-pomo-1',
		day: KEEPER_DAY,
		start: `${KEEPER_DAY}T10:00:00.000Z`,
		end: `${KEEPER_DAY}T10:25:00.000Z`,
		intention: 'a pomo from an earlier sitting',
		note: '',
		confirmed: false,
	},
]

export default [
	{
		visitor: { key: 'visitor-1', name: 'Ada Lovelace', email: 'ada@example.com' },
		keeper: {
			key: 'keeper-1',
			name: 'Grace Hopper',
			email: 'grace@example.com',
			localStorage: {
				'pomodance:pomos': JSON.stringify(KEEPER_LEDGER),
				'pomodance:day': JSON.stringify(KEEPER_DAY),
			},
		},
	},
] satisfies TeamConfig[]
