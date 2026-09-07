import { describe, expect, it } from 'vitest'

import { formatClock, parseVideoId, straddlesRollover, workDayOf, type Pomo } from './pomodance'

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
