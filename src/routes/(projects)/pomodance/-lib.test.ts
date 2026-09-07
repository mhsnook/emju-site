import { describe, expect, it } from 'vitest'

import {
	closeAbandoned,
	DEFAULT_SETTINGS,
	formatClock,
	isFresh,
	msFor,
	normalizeSettings,
	parseVideoId,
	remainingOf,
	restoreTimer,
	resumablePomo,
	straddlesRollover,
	trackAt,
	trackPos,
	workDayOf,
	type Pomo,
	type Timer,
} from './-lib'

describe('parseVideoId', () => {
	it('accepts bare ids and the usual url shapes', () => {
		expect(parseVideoId('jfKfPfyJRdk')).toBe('jfKfPfyJRdk')
		expect(parseVideoId('https://www.youtube.com/watch?v=jfKfPfyJRdk&t=10')).toBe('jfKfPfyJRdk')
		expect(parseVideoId('https://youtu.be/jfKfPfyJRdk')).toBe('jfKfPfyJRdk')
		expect(parseVideoId('https://www.youtube.com/embed/jfKfPfyJRdk')).toBe('jfKfPfyJRdk')
		expect(parseVideoId('https://www.youtube.com/live/jfKfPfyJRdk?si=x')).toBe('jfKfPfyJRdk')
	})
	it('returns empty for junk', () => {
		expect(parseVideoId('')).toBe('')
		expect(parseVideoId('not a url')).toBe('')
	})
})

describe('workDayOf', () => {
	it('rolls the day over at 4am local time', () => {
		expect(workDayOf(new Date(2026, 8, 8, 3, 59))).toBe('2026-09-07')
		expect(workDayOf(new Date(2026, 8, 8, 4, 0))).toBe('2026-09-08')
	})
})

describe('straddlesRollover', () => {
	const pomo = (day: string, end: Date): Pomo => ({
		id: '1',
		day,
		start: new Date(end.getTime() - 25 * 60_000).toISOString(),
		end: end.toISOString(),
		intention: '',
		note: '',
		confirmed: false,
	})
	const fiveAm = new Date(2026, 8, 8, 5, 0)

	it('asks when the last pomo on the old day was recent', () => {
		const pomos = [pomo('2026-09-07', new Date(2026, 8, 8, 3, 30))]
		expect(straddlesRollover('2026-09-07', pomos, fiveAm.getTime())).toBe(true)
	})
	it('does not ask after a long gap or when the day already matches', () => {
		const stale = [pomo('2026-09-07', new Date(2026, 8, 7, 22, 0))]
		expect(straddlesRollover('2026-09-07', stale, fiveAm.getTime())).toBe(false)
		expect(straddlesRollover('2026-09-08', [], fiveAm.getTime())).toBe(false)
		expect(straddlesRollover(null, [], fiveAm.getTime())).toBe(false)
	})
})

describe('formatClock', () => {
	it('pads minutes and seconds', () => {
		expect(formatClock(1500)).toBe('25:00')
		expect(formatClock(61)).toBe('01:01')
		expect(formatClock(-5)).toBe('00:00')
	})
})

describe('trackPos', () => {
	it('wraps back to the start of the playlist', () => {
		expect(trackPos(3, 0)).toBe(0)
		expect(trackPos(3, 4)).toBe(1)
		expect(trackPos(1, 7)).toBe(0)
		expect(trackPos(0, 2)).toBe(-1)
	})
	it('reads a track out of the list, or nothing from an empty one', () => {
		expect(trackAt(['a', 'b', 'c'], 4)).toBe('b')
		expect(trackAt([], 0)).toBe('')
	})
})

describe('normalizeSettings', () => {
	it('falls back to the defaults for anything a save is missing', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
		expect(normalizeSettings({ phases: { work: { minutes: 50 } } }).phases.work).toEqual({
			videos: DEFAULT_SETTINGS.phases.work.videos,
			minutes: 50,
		})
	})
	it('reduces playlist entries to ids and drops the unplayable ones', () => {
		const s = normalizeSettings({
			phases: {
				work: { videos: ['https://www.youtube.com/watch?v=jfKfPfyJRdk', 'nope', 42] },
				break: { videos: [] },
			},
		})
		expect(s.phases.work.videos).toEqual(['jfKfPfyJRdk'])
		expect(s.phases.break.videos).toEqual([])
	})
	it('keeps an emptied playlist empty rather than restoring the defaults', () => {
		expect(normalizeSettings({ phases: { break: { videos: [] } } }).phases.break.videos).toEqual(
			[]
		)
	})
})

const WORK_MS = msFor(DEFAULT_SETTINGS, 'work')

const pomoAt = (start: number, lengthMs: number | null, extra: Partial<Pomo> = {}): Pomo => ({
	id: String(start),
	day: workDayOf(new Date(start)),
	start: new Date(start).toISOString(),
	end: lengthMs === null ? null : new Date(start + lengthMs).toISOString(),
	intention: 'ship the thing',
	note: '',
	confirmed: false,
	...extra,
})

describe('restoreTimer', () => {
	const now = Date.now()
	const idle: Timer = { phase: 'work', endsAt: null, remainingMs: WORK_MS }

	it('picks a running countdown back up from the wall clock', () => {
		const endsAt = now + 8 * 60_000
		expect(
			restoreTimer(
				{ phase: 'work', endsAt, remainingMs: WORK_MS, savedAt: now - 60_000 },
				DEFAULT_SETTINGS,
				now
			)
		).toEqual({ phase: 'work', endsAt, remainingMs: 8 * 60_000 })
	})
	it('picks a paused timer back up where it stopped, in its own phase', () => {
		expect(
			restoreTimer(
				{ phase: 'break', endsAt: null, remainingMs: 90_000, savedAt: now - 60_000 },
				DEFAULT_SETTINGS,
				now
			)
		).toEqual({ phase: 'break', endsAt: null, remainingMs: 90_000 })
	})
	it('starts fresh when the countdown ran out or the pause went cold', () => {
		expect(
			restoreTimer(
				{ phase: 'work', endsAt: now - 1, remainingMs: 0, savedAt: now - 1 },
				DEFAULT_SETTINGS,
				now
			)
		).toEqual(idle)
		expect(
			restoreTimer(
				{ phase: 'break', endsAt: null, remainingMs: 90_000, savedAt: now - 40 * 60_000 },
				DEFAULT_SETTINGS,
				now
			)
		).toEqual(idle)
	})
	it('starts fresh on nothing saved or junk', () => {
		expect(restoreTimer(null, DEFAULT_SETTINGS, now)).toEqual(idle)
		expect(restoreTimer({ phase: 'nap', remainingMs: 5 }, DEFAULT_SETTINGS, now)).toEqual(idle)
		expect(restoreTimer({ phase: 'work' }, DEFAULT_SETTINGS, now)).toEqual(idle)
	})
	it('knows a restored timer from an untouched one', () => {
		expect(isFresh(idle, DEFAULT_SETTINGS)).toBe(true)
		expect(isFresh({ phase: 'work', endsAt: null, remainingMs: 60_000 }, DEFAULT_SETTINGS)).toBe(
			false
		)
		expect(isFresh({ phase: 'work', endsAt: now, remainingMs: WORK_MS }, DEFAULT_SETTINGS)).toBe(
			false
		)
	})
})

describe('closeAbandoned', () => {
	const now = Date.now()

	it('ends an open pomo at the earlier of now and its full length', () => {
		const [short, long] = closeAbandoned(
			[pomoAt(now - 5 * 60_000, null), pomoAt(now - 90 * 60_000, null)],
			25,
			false,
			now
		)
		expect(short.end).toBe(new Date(now).toISOString())
		expect(long.end).toBe(new Date(now - 90 * 60_000 + 25 * 60_000).toISOString())
	})
	it('leaves the last open pomo running when the timer survived the reload', () => {
		const pomos = closeAbandoned(
			[pomoAt(now - 3 * 3_600_000, null), pomoAt(now - 5 * 60_000, null)],
			25,
			true,
			now
		)
		expect(pomos[0].end).not.toBe(null)
		expect(pomos[1].end).toBe(null)
	})
})

describe('resumablePomo', () => {
	const now = Date.now()
	const today = workDayOf(new Date(now))

	it('offers the last pomo when it stopped short, recently, unreviewed', () => {
		const pomo = pomoAt(now - 20 * 60_000, 10 * 60_000)
		expect(resumablePomo([pomo], today, WORK_MS, now)).toBe(pomo)
		expect(remainingOf(pomo, WORK_MS)).toBe(15 * 60_000)
	})
	it('leaves alone a pomo that ran its length, went cold, or was reviewed', () => {
		expect(resumablePomo([pomoAt(now - 30 * 60_000, WORK_MS)], today, WORK_MS, now)).toBe(null)
		expect(resumablePomo([pomoAt(now - 3 * 3_600_000, 10 * 60_000)], today, WORK_MS, now)).toBe(
			null
		)
		expect(
			resumablePomo(
				[pomoAt(now - 20 * 60_000, 10 * 60_000, { confirmed: true })],
				today,
				WORK_MS,
				now
			)
		).toBe(null)
		expect(
			resumablePomo([pomoAt(now - 20 * 60_000, 10 * 60_000)], 'not-today', WORK_MS, now)
		).toBe(null)
		expect(resumablePomo([pomoAt(now - 20 * 60_000, null)], today, WORK_MS, now)).toBe(null)
		expect(resumablePomo([], today, WORK_MS, now)).toBe(null)
	})
	it('always leaves enough on the clock to file a pomo', () => {
		expect(remainingOf(pomoAt(now - 60 * 60_000, 60 * 60_000), WORK_MS)).toBe(60_000)
	})
})
