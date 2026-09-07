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

export const DEFAULT_SETTINGS: Settings = {
	phases: {
		work: { videos: ['jfKfPfyJRdk'], minutes: 25 },
		break: { videos: ['FGBhQbmPwH8', 'dQw4w9WgXcQ'], minutes: 5 },
	},
	showLedger: true,
	lessMotion: false,
}

/** Pomos shorter than this are discarded rather than filed. */
export const MIN_POMO_MS = 60_000
const DAY_ROLLOVER_HOURS = 4
/** Past this gap since the last pomo, a new day starts without asking. */
const LATE_NIGHT_GAP_MS = 3 * 3_600_000

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

/** Any pomo left open by a closed tab gets ended at the earlier of now or its full length. */
export function loadPomos(workMinutes: number): Pomo[] {
	const now = Date.now()
	return read<Pomo[]>(POMOS_KEY, []).map((p) =>
		p.end === null
			? {
					...p,
					end: new Date(
						Math.min(now, Date.parse(p.start) + workMinutes * 60_000)
					).toISOString(),
				}
			: p
	)
}
export const savePomos = (pomos: Pomo[]) => write(POMOS_KEY, pomos)

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
	PlayerState: { ENDED: number; PLAYING: number; PAUSED: number }
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

export function cn(...parts: Array<string | false | null | undefined>) {
	return parts.filter(Boolean).join(' ')
}
