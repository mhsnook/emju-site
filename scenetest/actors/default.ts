import type { TeamConfig } from '@scenetest/scenes'

import { workDayOf } from '../../src/routes/(projects)/pomodance/-lib'

/**
 * The site has no authentication, so an anonymous visitor is all the marketing
 * pages need. `keeper` is the same person with a pomodance ledger already in
 * localStorage: a finished pomo on the day the page will open on, and two more
 * on a day gone by, so scenes can work with a ledger and a history they did not
 * have to sit through in real time.
 *
 * Pomodance files each visit under the day it happens on, so the days are
 * counted back from now rather than pinned to fixed dates.
 */
const KEEPER_DAY = workDayOf(new Date())
const PAST_DAY = workDayOf(new Date(Date.now() - 3 * 86_400_000))

const pomo = (day: string, hour: number, intention: string) => ({
	id: `keeper-pomo-${day}-${hour}`,
	day,
	start: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`,
	end: `${day}T${String(hour).padStart(2, '0')}:25:00.000Z`,
	intention,
	note: '',
	confirmed: false,
})

// the ledger reads the list in order, so the day being worked on comes last
const KEEPER_LEDGER = [
	pomo(PAST_DAY, 9, 'something from a day gone by'),
	pomo(PAST_DAY, 11, 'and one more from that morning'),
	pomo(KEEPER_DAY, 10, 'a pomo from an earlier sitting'),
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
