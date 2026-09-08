export type Phase = 'work' | 'break'

export type PhaseSettings = { videos: string[]; minutes: number }

export type Settings = {
	phases: Record<Phase, PhaseSettings>
	showLedger: boolean
	lessMotion: boolean
}

type Cursors = Record<Phase, { index: number; seconds: number }>

export type Pomo = {
	id: string
	/** work-day key (yyyy-mm-dd) the pomo is filed under; days roll over at 4am */
	day: string
	start: string
	end: string | null
	intention: string
	note: string
	confirmed: boolean
}

const SETTINGS_KEY = 'pomodance:settings'
const POMOS_KEY = 'pomodance:pomos'
const INTENTION_KEY = 'pomodance:intention'
const DAY_KEY = 'pomodance:day'
const CURSORS_KEY = 'pomodance:cursors'
const TIMER_KEY = 'pomodance:timer'

/** Every key this project owns, so a foreign write can be ignored on sync. */
export const STORAGE_PREFIX = 'pomodance:'

export const DEFAULT_SETTINGS: Settings = {
	phases: {
		work: { videos: ['uNw_a7HFwvg', 'CFGLoQIhmow'], minutes: 25 },
		break: { videos: ['zjiU2YAlYKY', 'NF-kLy44Hls'], minutes: 5 },
	},
	showLedger: true,
	lessMotion: false,
}

/** Pomos shorter than this are discarded rather than filed. */
export const MIN_POMO_MS = 60_000
const DAY_ROLLOVER_HOURS = 4
/** Past this gap since the last pomo, a new day starts without asking. */
const LATE_NIGHT_GAP_MS = 3 * 3_600_000
/** A pomo that got this close to its full length ran out rather than stopped short. */
const INTERRUPTED_SLACK_MS = 30_000

/**
 * How long a stopped timer or pomo stays pick-up-able: one full work + break
 * cycle, so a session you walked away from mid-break is still the same session.
 */
export const resumeWindowMs = (settings: Settings) =>
	msFor(settings, 'work') + msFor(settings, 'break')

function read<T>(key: string, fallback: T): T {
	if (typeof localStorage === 'undefined') return fallback
	try {
		const raw = localStorage.getItem(key)
		return raw ? (JSON.parse(raw) as T) : fallback
	} catch {
		return fallback
	}
}

function write(key: string, value: unknown) {
	localStorage.setItem(key, JSON.stringify(value))
}

/**
 * Fills in the defaults for anything a save is missing, and reduces every
 * playlist entry to a bare video id so a position in the list and a playable
 * track are the same thing.
 */
export function normalizeSettings(stored: unknown): Settings {
	const s = (stored ?? {}) as Partial<Settings>
	const phase = (p: Phase): PhaseSettings => {
		const fallback = DEFAULT_SETTINGS.phases[p]
		const saved = s.phases?.[p]
		const minutes = saved?.minutes
		return {
			videos: saved?.videos
				? saved.videos
						.filter((v) => typeof v === 'string')
						.map(parseVideoId)
						.filter(Boolean)
				: fallback.videos,
			minutes: typeof minutes === 'number' && minutes > 0 ? minutes : fallback.minutes,
		}
	}
	return {
		phases: { work: phase('work'), break: phase('break') },
		showLedger: s.showLedger ?? DEFAULT_SETTINGS.showLedger,
		lessMotion: s.lessMotion ?? DEFAULT_SETTINGS.lessMotion,
	}
}

export const loadSettings = () => normalizeSettings(read(SETTINGS_KEY, {}))
export const saveSettings = (settings: Settings) => write(SETTINGS_KEY, settings)

export function loadCursors(): Cursors {
	const stored = read<Partial<Cursors>>(CURSORS_KEY, {})
	return {
		work: stored.work ?? { index: 0, seconds: 0 },
		break: stored.break ?? { index: 0, seconds: 0 },
	}
}
export const saveCursors = (cursors: Cursors) => write(CURSORS_KEY, cursors)

export const readPomos = () => read<Pomo[]>(POMOS_KEY, [])
export const savePomos = (pomos: Pomo[]) => write(POMOS_KEY, pomos)

/**
 * Ends anything a closed tab left open, at the earlier of now or its full
 * length. The pomo a restored timer is still counting down is left alone:
 * `keepLastOpen` says the session survived the reload.
 */
export function closeAbandoned(
	pomos: Pomo[],
	workMinutes: number,
	keepLastOpen: boolean,
	now: number
): Pomo[] {
	const open = pomos.filter((p) => p.end === null)
	const carried = keepLastOpen ? open.at(-1) : undefined
	return pomos.map((p) =>
		p.end === null && p !== carried
			? {
					...p,
					end: new Date(
						Math.min(now, Date.parse(p.start) + workMinutes * 60_000)
					).toISOString(),
				}
			: p
	)
}

export const loadPomos = (workMinutes: number, keepLastOpen: boolean) =>
	closeAbandoned(readPomos(), workMinutes, keepLastOpen, Date.now())

/**
 * The pomo a fresh start should offer to pick up rather than replace: the most
 * recent one, if it stopped short of its full length, stopped recently, and was
 * never reviewed.
 */
export function resumablePomo(
	pomos: Pomo[],
	day: string,
	settings: Settings,
	now: number
): Pomo | null {
	const last = pomos.at(-1)
	if (!last?.end || last.confirmed || last.day !== day) return null
	const ended = Date.parse(last.end)
	if (now - ended > resumeWindowMs(settings)) return null
	const workMs = msFor(settings, 'work')
	return ended - Date.parse(last.start) < workMs - INTERRUPTED_SLACK_MS ? last : null
}

/** The fields of a pomo as its edit form holds them, all as plain input strings. */
export type PomoDraft = {
	day: string
	start: string
	end: string
	intention: string
	note: string
	confirmed: boolean
}

/** `datetime-local` has no timezone, so both directions go through the local clock. */
export function toLocalInput(iso: string) {
	const d = new Date(iso)
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const draftOf = (pomo: Pomo): PomoDraft => ({
	day: pomo.day,
	start: toLocalInput(pomo.start),
	end: pomo.end ? toLocalInput(pomo.end) : '',
	intention: pomo.intention,
	note: pomo.note,
	confirmed: pomo.confirmed,
})

/**
 * What is wrong with the draft, or null when it can be filed. An empty end
 * reopens the pomo, which only one of them may be at a time: `otherOpen` is
 * whether a different pomo is already in progress.
 */
export function draftError(draft: PomoDraft, otherOpen = false): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.day)) return 'The work day needs to be a date.'
	const start = Date.parse(draft.start)
	if (Number.isNaN(start)) return 'That start time is not a time.'
	if (!draft.end)
		return otherOpen ? 'Another pomo is already in progress. Stop that one first.' : null
	const end = Date.parse(draft.end)
	if (Number.isNaN(end)) return 'That end time is not a time.'
	return end < start ? 'That pomo would end before it started.' : null
}

/** An empty end puts the pomo back in progress, which is how two get merged by hand. */
export const pomoFromDraft = (pomo: Pomo, draft: PomoDraft): Pomo => ({
	...pomo,
	day: draft.day,
	start: new Date(draft.start).toISOString(),
	end: draft.end ? new Date(draft.end).toISOString() : null,
	intention: draft.intention,
	note: draft.note,
	confirmed: draft.confirmed,
})

/** Edited times can land anywhere, and the ledger reads the list in order. */
export const byStart = (a: Pomo, b: Pomo) => Date.parse(a.start) - Date.parse(b.start)

/**
 * Whether a pomo is dropped rather than filed when it ends. Too short to be
 * worth a ledger entry — unless it has been reviewed, which is someone saying
 * this one counts however long it ran.
 */
export const isThrowaway = (pomo: Pomo, now: number) =>
	!pomo.confirmed && now - Date.parse(pomo.start) < MIN_POMO_MS

/** What is left on the clock of an interrupted pomo, never less than a filable one. */
export const remainingOf = (pomo: Pomo, workMs: number) =>
	Math.max(MIN_POMO_MS, workMs - (Date.parse(pomo.end ?? pomo.start) - Date.parse(pomo.start)))

export const loadIntention = () => read<string>(INTENTION_KEY, '')
export const saveIntention = (v: string) => write(INTENTION_KEY, v)

export const loadDay = () => read<string | null>(DAY_KEY, null)
export const saveDay = (day: string) => write(DAY_KEY, day)

export function workDayOf(date: Date): string {
	const shifted = new Date(date.getTime() - DAY_ROLLOVER_HOURS * 3_600_000)
	const y = shifted.getFullYear()
	const m = String(shifted.getMonth() + 1).padStart(2, '0')
	const d = String(shifted.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

export function dayLabel(day: string) {
	return new Date(`${day}T12:00:00`).toLocaleDateString([], {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
	})
}

/**
 * Whether starting a pomo now sits on the far side of 4am from the day the
 * user was working on, close enough to the last pomo that it's plausibly the
 * same late-night session and worth asking about.
 */
export function straddlesRollover(currentDay: string | null, pomos: Pomo[], now: number) {
	if (!currentDay || currentDay === workDayOf(new Date(now))) return false
	const last = pomos.filter((p) => p.day === currentDay).at(-1)
	return !!last && now - Date.parse(last.end ?? last.start) < LATE_NIGHT_GAP_MS
}

/**
 * The day a visit files its pomos under. A saved day that is no longer today's
 * only survives while the late-night session that made it is still going; every
 * other visit starts on a fresh day.
 */
export function resolveDay(stored: string | null, pomos: Pomo[], now: number): string {
	return stored && straddlesRollover(stored, pomos, now) ? stored : workDayOf(new Date(now))
}

/** The days behind the one being worked on, newest first, for the history. */
export function pastDays(pomos: Pomo[], day: string): { day: string; pomos: Pomo[] }[] {
	const days = new Map<string, Pomo[]>()
	for (const pomo of pomos) {
		if (pomo.day === day) continue
		days.set(pomo.day, [...(days.get(pomo.day) ?? []), pomo])
	}
	return [...days.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([key, filed]) => ({ day: key, pomos: [...filed].sort(byStart) }))
}

/** What a day came to: how many pomos, and how long the finished ones ran. */
export function dayTotals(pomos: Pomo[]) {
	const ms = pomos.reduce(
		(total, p) => total + (p.end ? Date.parse(p.end) - Date.parse(p.start) : 0),
		0
	)
	return { count: pomos.length, minutes: Math.round(ms / 60_000) }
}

/** Minutes as a spoken duration: `45m`, `1h`, `2h 05m`. */
export function formatDuration(minutes: number) {
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	if (!hours) return `${rest}m`
	return rest ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${hours}h`
}

/** Accepts a bare video id or any of the usual youtube URL shapes. */
export function parseVideoId(input: string): string {
	const s = input.trim()
	if (/^[\w-]{11}$/.test(s)) return s
	try {
		const url = new URL(s)
		if (url.hostname === 'youtu.be') return url.pathname.slice(1, 12)
		const v = url.searchParams.get('v')
		if (v) return v.slice(0, 11)
		const m = url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)
		if (m) return m[1]
	} catch {
		/* not a url */
	}
	return ''
}

/**
 * A cursor index counts tracks played rather than position in the list, so that
 * advancing past the end of a one-track playlist still reads as a change.
 */
export const trackPos = (length: number, index: number) =>
	length > 0 ? ((index % length) + length) % length : -1

export const trackAt = (ids: string[], index: number) => ids[trackPos(ids.length, index)] ?? ''

export function msFor(settings: Settings, phase: Phase) {
	return settings.phases[phase].minutes * 60_000
}

// ---- the timer, across reloads ----

/** endsAt set means running; remainingMs is only meaningful while endsAt is null. */
export type Timer = { phase: Phase; endsAt: number | null; remainingMs: number }
type StoredTimer = Timer & { savedAt: number }

/** Where a session that is over leaves the next one: the top of a work pomo. */
const idleTimer = (settings: Settings): Timer => ({
	phase: 'work',
	endsAt: null,
	remainingMs: msFor(settings, 'work'),
})

/** Whether the timer is sitting at the top of its phase, untouched. */
export const isFresh = (timer: Timer, settings: Settings) =>
	timer.endsAt === null && timer.remainingMs === msFor(settings, timer.phase)

function validTimer(stored: unknown): StoredTimer | null {
	const t = (stored ?? {}) as Partial<StoredTimer>
	if (t.phase !== 'work' && t.phase !== 'break') return null
	if (typeof t.remainingMs !== 'number' || !Number.isFinite(t.remainingMs)) return null
	if (t.endsAt != null && typeof t.endsAt !== 'number') return null
	return {
		phase: t.phase,
		endsAt: t.endsAt ?? null,
		remainingMs: t.remainingMs,
		savedAt: typeof t.savedAt === 'number' ? t.savedAt : 0,
	}
}

/**
 * A running timer picks its countdown back up from the wall clock, and a paused
 * one from where it stopped. Either way, a timer that ran out or was abandoned
 * while the page was gone starts the next session fresh instead.
 */
export function restoreTimer(stored: unknown, settings: Settings, now: number): Timer {
	const t = validTimer(stored)
	if (!t) return idleTimer(settings)
	if (t.endsAt !== null)
		return t.endsAt > now
			? { phase: t.phase, endsAt: t.endsAt, remainingMs: t.endsAt - now }
			: idleTimer(settings)
	if (now - t.savedAt > resumeWindowMs(settings)) return idleTimer(settings)
	return { phase: t.phase, endsAt: null, remainingMs: t.remainingMs }
}

export const loadTimer = (settings: Settings) =>
	restoreTimer(read<unknown>(TIMER_KEY, null), settings, Date.now())

/** The stored timer as written, for picking up another tab's edit mid-session. */
export const readTimer = (): Timer | null => {
	const t = validTimer(read<unknown>(TIMER_KEY, null))
	return t && { phase: t.phase, endsAt: t.endsAt, remainingMs: t.remainingMs }
}

export const saveTimer = (timer: Timer) => write(TIMER_KEY, { ...timer, savedAt: Date.now() })

export function formatClock(seconds: number) {
	const total = Math.max(0, seconds)
	const m = Math.floor(total / 60)
	const s = total % 60
	return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// ---- sounds ----

let ctx: AudioContext | null = null
function audio() {
	if (typeof window === 'undefined') return null
	ctx ??= new AudioContext()
	if (ctx.state === 'suspended') void ctx.resume()
	return ctx
}

function tone(
	freq: number,
	start: number,
	duration: number,
	gain = 0.15,
	type: OscillatorType = 'sine'
) {
	const ac = audio()
	if (!ac) return
	const osc = ac.createOscillator()
	const g = ac.createGain()
	osc.type = type
	osc.frequency.value = freq
	const t0 = ac.currentTime + start
	g.gain.setValueAtTime(0, t0)
	g.gain.linearRampToValueAtTime(gain, t0 + 0.01)
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
	osc.connect(g).connect(ac.destination)
	osc.start(t0)
	osc.stop(t0 + duration + 0.05)
}

export const sounds = {
	beep: () => tone(880, 0, 0.12),
	click: () => tone(220, 0, 0.05, 0.1, 'square'),
	ring: () => {
		tone(1046, 0, 0.5)
		tone(1318, 0.15, 0.5)
		tone(1568, 0.3, 0.8)
	},
}

// ---- youtube iframe api ----

type VideoRequest = { videoId: string; startSeconds?: number }

export type YTPlayer = {
	playVideo(): void
	pauseVideo(): void
	loadVideoById(request: VideoRequest): void
	cueVideoById(request: VideoRequest): void
	getCurrentTime(): number
	getPlayerState(): number
	destroy(): void
}

type YTNamespace = {
	Player: new (
		el: HTMLElement,
		opts: {
			videoId: string
			playerVars?: Record<string, string | number>
			events?: {
				onReady?: () => void
				onStateChange?: (e: { data: number }) => void
			}
		}
	) => YTPlayer
	PlayerState: {
		UNSTARTED: number
		ENDED: number
		PLAYING: number
		PAUSED: number
		BUFFERING: number
		CUED: number
	}
}

declare global {
	interface Window {
		YT?: YTNamespace
		onYouTubeIframeAPIReady?: () => void
	}
}

let ytReady: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
	ytReady ??= new Promise((resolve) => {
		if (window.YT?.Player) return resolve(window.YT)
		const prev = window.onYouTubeIframeAPIReady
		window.onYouTubeIframeAPIReady = () => {
			prev?.()
			resolve(window.YT!)
		}
		const script = document.createElement('script')
		script.src = 'https://www.youtube.com/iframe_api'
		document.head.appendChild(script)
	})
	return ytReady
}

// ---- video titles ----

const titles = new Map<string, Promise<string | null>>()

async function requestTitle(id: string): Promise<string | null> {
	try {
		const res = await fetch(
			`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
				`https://www.youtube.com/watch?v=${id}`
			)}`
		)
		if (!res.ok) return null
		const { title } = (await res.json()) as { title?: string }
		return title ?? null
	} catch {
		return null
	}
}

/** Caches the promise, not the title, so a miss is not retried on every edit. */
export function fetchVideoTitle(id: string): Promise<string | null> {
	const pending = titles.get(id) ?? requestTitle(id)
	titles.set(id, pending)
	return pending
}

/** Keeps the old value when a re-read from storage turns up the same thing. */
export const keepIfSame = <T>(prev: T, next: T) =>
	JSON.stringify(prev) === JSON.stringify(next) ? prev : next

export function cn(...parts: Array<string | false | null | undefined>) {
	return parts.filter(Boolean).join(' ')
}
