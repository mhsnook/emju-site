import { createFileRoute } from '@tanstack/react-router'
import { memo, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { pomodance as copy } from '#/content/site'
import {
	cachedVideoTitle,
	cn,
	DEFAULT_SETTINGS,
	dayLabel,
	fetchVideoTitle,
	formatClock,
	loadCursors,
	loadDay,
	loadIntention,
	loadPomos,
	loadSettings,
	loadYouTubeApi,
	MIN_POMO_MS,
	MINUTES_KEY,
	msFor,
	parseVideoId,
	saveCursors,
	saveDay,
	saveIntention,
	savePomos,
	saveSettings,
	sounds,
	straddlesRollover,
	trackAt,
	trackPos,
	VIDEOS_KEY,
	workDayOf,
	type Cursors,
	type Phase,
	type Pomo,
	type Settings,
	type YTPlayer,
} from '#/lib/pomodance'

import pomodanceCss from '#/pomodance.css?url'

export const Route = createFileRoute('/pomodance')({
	ssr: false,
	head: () => ({
		meta: [{ title: `${copy.title} — EMJU` }, { name: 'description', content: copy.description }],
		links: [{ rel: 'stylesheet', href: pomodanceCss }],
	}),
	component: PomodancePage,
})

const PHASES: Phase[] = ['work', 'break']

// endsAt set means running; remainingMs is only meaningful while endsAt is null.
type Timer = { phase: Phase; endsAt: number | null; remainingMs: number }
type TimerAction =
	| { type: 'start'; now: number }
	| { type: 'pause'; now: number }
	| { type: 'switch'; phase: Phase; durationMs: number; running: boolean; now: number }

function timerReducer(t: Timer, a: TimerAction): Timer {
	switch (a.type) {
		case 'start':
			return t.endsAt ? t : { ...t, endsAt: a.now + t.remainingMs }
		case 'pause':
			return t.endsAt ? { ...t, endsAt: null, remainingMs: Math.max(0, t.endsAt - a.now) } : t
		case 'switch':
			return {
				phase: a.phase,
				remainingMs: a.durationMs,
				endsAt: a.running ? a.now + a.durationMs : null,
			}
	}
}

const timeFormat = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
const fmtTime = (iso: string) => timeFormat.format(new Date(iso))
const minutesBetween = (a: string, b: string) =>
	Math.round((Date.parse(b) - Date.parse(a)) / 60_000)
const weekday = (day: string) => dayLabel(day).split(',')[0]

const PROGRESS_SAVE_MS = 5_000

function PomodancePage() {
	const [settings, setSettings] = useState<Settings>(loadSettings)
	const [cursors, setCursors] = useState<Cursors>(loadCursors)
	const [timer, dispatch] = useReducer(timerReducer, {
		phase: 'work',
		endsAt: null,
		remainingMs: msFor(settings, 'work'),
	} satisfies Timer)
	const [secondsLeft, setSecondsLeft] = useState(0)
	const [intention, setIntention] = useState(loadIntention)
	const [pomos, setPomos] = useState(() => loadPomos(settings.workMinutes))
	const [day, setDay] = useState(() => loadDay() ?? workDayOf(new Date()))

	const [review, setReview] = useState<Pomo | null>(null)
	const [confirmSwitch, setConfirmSwitch] = useState<Phase | null>(null)
	const [askRollover, setAskRollover] = useState(false)
	const [showSettings, setShowSettings] = useState(false)

	const players = useRef<Record<Phase, YTPlayer | null>>({ work: null, break: null })
	const [playersReady, setPlayersReady] = useState(0)

	const { phase } = timer
	const running = timer.endsAt !== null
	const isBreak = phase === 'break'
	const idle = !running && timer.remainingMs === msFor(settings, phase)
	const current = pomos.find((p) => p.end === null) ?? null

	useEffect(() => savePomos(pomos), [pomos])
	useEffect(() => saveDay(day), [day])
	useEffect(() => saveCursors(cursors), [cursors])

	const patchPomo = (id: string, patch: Partial<Pomo>) =>
		setPomos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))

	const openPomo = (now: number) => {
		if (current) return
		if (straddlesRollover(day, pomos, now)) setAskRollover(true)
		setPomos((ps) => [
			...ps,
			{
				id: crypto.randomUUID(),
				day,
				start: new Date(now).toISOString(),
				end: null,
				intention,
				note: '',
				confirmed: false,
			},
		])
	}

	const closePomo = (now: number) => {
		if (!current) return
		if (now - Date.parse(current.start) < MIN_POMO_MS) {
			setPomos((ps) => ps.filter((p) => p.id !== current.id))
			return
		}
		const closed = { ...current, end: new Date(now).toISOString() }
		patchPomo(current.id, closed)
		setReview(closed)
	}

	const start = () => {
		if (running) return
		const now = Date.now()
		sounds.beep()
		dispatch({ type: 'start', now })
		if (phase === 'work') openPomo(now)
	}
	const pause = () => {
		if (!running) return
		sounds.click()
		dispatch({ type: 'pause', now: Date.now() })
	}
	const switchTo = (next: Phase, autostart: boolean, s = settings) => {
		const now = Date.now()
		dispatch({ type: 'switch', phase: next, durationMs: msFor(s, next), running: autostart, now })
		if (phase === 'work') closePomo(now)
		if (next === 'work' && autostart) openPomo(now)
	}

	const complete = () => {
		sounds.ring()
		switchTo(phase === 'work' ? 'break' : 'work', true)
	}
	const completeRef = useRef(complete)
	completeRef.current = complete

	// tick from the wall clock so a backgrounded tab still finishes on time
	useEffect(() => {
		const endsAt = timer.endsAt
		if (endsAt === null) return
		const tick = () => {
			const left = endsAt - Date.now()
			if (left > 0) setSecondsLeft(Math.ceil(left / 1000))
			else completeRef.current()
		}
		tick()
		const id = setInterval(tick, 250)
		return () => clearInterval(id)
	}, [timer.endsAt])

	// A paused player keeps its own position, so resuming a phase needs no help.
	// The stored seconds are for the next page load.
	const captureProgress = (p: Phase) => {
		const player = players.current[p]
		const YT = window.YT
		if (!player || !YT) return
		try {
			const state = player.getPlayerState()
			if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED) return
			const seconds = Math.max(0, Math.floor(player.getCurrentTime()))
			setCursors((c) => (c[p].seconds === seconds ? c : { ...c, [p]: { ...c[p], seconds } }))
		} catch {
			/* player went away mid-read */
		}
	}
	const captureRef = useRef(captureProgress)
	captureRef.current = captureProgress

	useEffect(() => {
		if (!running) return
		const id = setInterval(() => captureRef.current(phase), PROGRESS_SAVE_MS)
		return () => clearInterval(id)
	}, [running, phase])

	// the players follow the timer; only the active phase's player may drive it back.
	// pressing play on the other one is a request to switch phases, so it gets
	// paused again and routed through the confirm dialog.
	useEffect(() => {
		for (const p of PHASES) {
			const player = players.current[p]
			if (!player) continue
			if (p === phase && running) player.playVideo()
			else {
				captureRef.current(p)
				player.pauseVideo()
			}
		}
	}, [phase, running, playersReady])

	const advanceTrack = (p: Phase) =>
		setCursors((c) => ({ ...c, [p]: { index: c[p].index + 1, seconds: 0 } }))

	const selectTrack = (p: Phase, index: number) =>
		setCursors((c) => ({ ...c, [p]: { index, seconds: 0 } }))

	const onPlayerState = (p: Phase, state: number) => {
		const YT = window.YT!
		if (state === YT.PlayerState.ENDED) {
			advanceTrack(p)
			return
		}
		if (p !== phase) {
			if (state !== YT.PlayerState.PLAYING) return
			if (running) {
				players.current[p]?.pauseVideo()
				setConfirmSwitch(p)
			} else {
				switchTo(p, true)
			}
			return
		}
		if (state === YT.PlayerState.PLAYING) start()
		else if (state === YT.PlayerState.PAUSED) pause()
	}
	const onPlayerStateRef = useRef(onPlayerState)
	onPlayerStateRef.current = onPlayerState

	const registerPlayer = (p: Phase, player: YTPlayer | null) => {
		players.current[p] = player
		setPlayersReady((n) => n + 1)
	}

	const updateSettings = (patch: Partial<Settings>) => {
		const next = { ...settings, ...patch }
		setSettings(next)
		saveSettings(next)
		if (idle) switchTo(phase, false, next)
	}

	const updatePlaylist = (p: Phase, videos: string[]) =>
		updateSettings({ [VIDEOS_KEY[p]]: videos })

	const updateIntention = (value: string) => {
		setIntention(value)
		saveIntention(value)
		if (current) patchPomo(current.id, { intention: value })
	}

	const finishReview = (note: string, confirmed: boolean, clearIntention: boolean) => {
		if (review) patchPomo(review.id, { note, confirmed })
		if (clearIntention) updateIntention('')
		setReview(null)
	}

	const clock = formatClock(running ? secondsLeft : Math.ceil(timer.remainingMs / 1000))

	useEffect(() => {
		document.title = `${clock} ${isBreak ? '💃' : '🍅'} ${copy.title}`
	}, [clock, isBreak])

	const today = workDayOf(new Date())
	const showLedger = !settings.ledgerHidden

	return (
		<div
			data-testid="pomodance-page"
			data-theme="emju-dark"
			className={cn('pomo', isBreak && 'is-break', settings.lessMotion && 'is-calm')}
		>
			<div className={cn('grid gap-6 p-6', showLedger && 'lg:grid-cols-[1fr_20rem]')}>
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
					<header className="flex items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<h1 className="font-display text-3xl">
								{isBreak ? copy.breakHeading : copy.workHeading}
							</h1>
							<p className="font-ui text-sm opacity-70">{copy.description}</p>
						</div>
						<button
							type="button"
							data-testid="settings-button"
							aria-label={copy.settings.open}
							title={copy.settings.open}
							onClick={() => setShowSettings(true)}
							className="btn btn-circle btn-ghost shrink-0 text-xl"
						>
							⚙
						</button>
					</header>

					{isBreak && (
						<div className="pomo-dancers" aria-hidden>
							{['💃', '🪩', '🕺', '✨', '💃', '🪩', '🕺'].map((d, i) => (
								<span key={i}>{d}</span>
							))}
						</div>
					)}

					<section className="flex flex-col items-center gap-4">
						<div
							data-testid="clock"
							className="pomo-clock font-display text-[clamp(4rem,20vw,11rem)] leading-none font-bold tabular-nums"
							aria-live="polite"
						>
							{clock}
						</div>
						<div className="flex flex-wrap justify-center gap-3">
							<button
								data-testid="start-button"
								onClick={running ? pause : start}
								className="btn btn-lg rounded-full border-0 bg-[var(--pomo-accent)] font-bold text-black hover:scale-105 hover:bg-[var(--pomo-accent)]"
							>
								{running ? 'Pause' : idle ? 'Start' : 'Resume'}
							</button>
							<button
								data-testid="reset-button"
								onClick={() => switchTo(phase, false)}
								className="btn btn-lg btn-outline rounded-full"
							>
								Reset
							</button>
							<button
								data-testid="switch-button"
								onClick={() => switchTo(isBreak ? 'work' : 'break', true)}
								className="btn btn-lg btn-outline rounded-full"
							>
								{isBreak ? 'Back to work' : 'Skip to break'}
							</button>
						</div>
						<SettingInput
							testId="intention-input"
							className="w-full max-w-xl"
							label={copy.intentionLabel}
							value={intention}
							onChange={updateIntention}
							placeholder={copy.intentionPlaceholder}
						/>
					</section>

					<section className="grid items-start gap-4 md:grid-cols-3">
						{PHASES.map((p) => (
							<PhaseVideo
								key={p}
								phase={p}
								active={phase === p}
								playing={phase === p && running}
								videos={settings[VIDEOS_KEY[p]]}
								cursor={cursors[p]}
								onPlaylistChange={(videos) => updatePlaylist(p, videos)}
								onSelectTrack={(i) => selectTrack(p, i)}
								onReady={(player) => registerPlayer(p, player)}
								onState={(s) => onPlayerStateRef.current(p, s)}
							/>
						))}
					</section>
				</div>

				{showLedger && <Ledger pomos={pomos} day={day} />}
			</div>

			{showSettings && (
				<Modal testId="settings-dialog" onDismiss={() => setShowSettings(false)}>
					<h2 className="font-display text-2xl">{copy.settings.title}</h2>
					<div className="grid gap-3 sm:grid-cols-2">
						{PHASES.map((p) => (
							<SettingInput
								key={p}
								testId={`${p}-minutes-input`}
								label={
									p === 'work' ? copy.settings.workMinutes : copy.settings.breakMinutes
								}
								type="number"
								value={String(settings[MINUTES_KEY[p]])}
								onChange={(v) =>
									updateSettings({
										[MINUTES_KEY[p]]: clampMinutes(v, DEFAULT_SETTINGS[MINUTES_KEY[p]]),
									})
								}
							/>
						))}
					</div>
					<Toggle
						testId="ledger-toggle"
						label={copy.settings.showLedger}
						checked={showLedger}
						onChange={(v) => updateSettings({ ledgerHidden: !v })}
					/>
					<Toggle
						testId="less-motion-toggle"
						label={copy.settings.lessMotion}
						hint={copy.settings.lessMotionHint}
						checked={settings.lessMotion}
						onChange={(v) => updateSettings({ lessMotion: v })}
					/>
					<div className="modal-action">
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => setShowSettings(false)}
						>
							{copy.settings.close}
						</button>
					</div>
				</Modal>
			)}

			{review && (
				<ReviewDialog
					pomo={review}
					onDismiss={() => finishReview(review.intention, false, false)}
					onSave={(note, clearIntention) => finishReview(note, true, clearIntention)}
				/>
			)}

			{confirmSwitch && (
				<Modal testId="confirm-switch-dialog" onDismiss={() => setConfirmSwitch(null)}>
					<h2 className="font-display text-2xl">
						{confirmSwitch === 'break'
							? copy.confirmSwitch.toBreak
							: copy.confirmSwitch.toWork}
					</h2>
					<div className="modal-action">
						<button
							type="button"
							className="btn btn-outline"
							onClick={() => setConfirmSwitch(null)}
						>
							{copy.confirmSwitch.stay}
						</button>
						<button
							type="button"
							data-testid="confirm-switch-yes"
							className="btn btn-primary"
							onClick={() => {
								switchTo(confirmSwitch, true)
								setConfirmSwitch(null)
							}}
						>
							{copy.confirmSwitch.go}
						</button>
					</div>
				</Modal>
			)}

			{askRollover && (
				<Modal testId="rollover-dialog" onDismiss={() => setAskRollover(false)}>
					<h2 className="font-display text-2xl">{copy.rollover.title}</h2>
					<p>
						Still working late on {dayLabel(day)}, or is this {dayLabel(today)} now?
					</p>
					<div className="modal-action">
						<button
							type="button"
							className="btn btn-outline"
							onClick={() => setAskRollover(false)}
						>
							Still {weekday(day)}
						</button>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => {
								setDay(today)
								if (current) patchPomo(current.id, { day: today })
								setAskRollover(false)
							}}
						>
							Switch to {weekday(today)}
						</button>
					</div>
				</Modal>
			)}
		</div>
	)
}

function clampMinutes(v: string, fallback: number) {
	const n = Number.parseInt(v, 10)
	return Number.isFinite(n) && n > 0 ? Math.min(n, 180) : fallback
}

function SettingInput({
	testId,
	label,
	value,
	onChange,
	type = 'text',
	placeholder,
	className,
}: {
	testId: string
	label: string
	value: string
	onChange: (v: string) => void
	type?: 'text' | 'number'
	placeholder?: string
	className?: string
}) {
	return (
		<label className={cn('font-ui flex flex-col gap-1 text-sm', className)}>
			<span className="opacity-70">{label}</span>
			<input
				data-testid={testId}
				type={type}
				min={type === 'number' ? 1 : undefined}
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className="input w-full"
			/>
		</label>
	)
}

function Toggle({
	testId,
	label,
	hint,
	checked,
	onChange,
}: {
	testId: string
	label: string
	hint?: string
	checked: boolean
	onChange: (v: boolean) => void
}) {
	return (
		<label className="font-ui flex cursor-pointer items-start gap-3 text-sm">
			<input
				data-testid={testId}
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="toggle toggle-primary"
			/>
			<span className="flex flex-col">
				<span>{label}</span>
				{hint && <span className="opacity-60">{hint}</span>}
			</span>
		</label>
	)
}

/** Titles are a nicety: until (or unless) one arrives, the id stands in for it. */
function useVideoTitles(ids: string[]) {
	const [, bump] = useReducer((n: number) => n + 1, 0)
	const key = ids.join(',')
	useEffect(() => {
		let cancelled = false
		void Promise.all(key ? key.split(',').map(fetchVideoTitle) : []).then(
			() => !cancelled && bump()
		)
		return () => {
			cancelled = true
		}
	}, [key])
	return (id: string) => cachedVideoTitle(id) ?? id
}

function PhaseVideo({
	phase,
	active,
	playing,
	videos,
	cursor,
	onPlaylistChange,
	onSelectTrack,
	onReady,
	onState,
}: {
	phase: Phase
	active: boolean
	playing: boolean
	videos: string[]
	cursor: { index: number; seconds: number }
	onPlaylistChange: (videos: string[]) => void
	onSelectTrack: (index: number) => void
	onReady: (p: YTPlayer | null) => void
	onState: (state: number) => void
}) {
	const [draft, setDraft] = useState('')
	const [invalid, setInvalid] = useState(false)
	const titleOf = useVideoTitles(videos)

	const pos = trackPos(videos.length, cursor.index)
	const videoId = trackAt(videos, cursor.index)
	const heading = phase === 'work' ? copy.playlist.work : copy.playlist.break

	const add = () => {
		const id = parseVideoId(draft)
		if (!id) return setInvalid(true)
		setInvalid(false)
		setDraft('')
		onPlaylistChange([...videos, id])
	}

	const remove = (i: number) => onPlaylistChange(videos.filter((_, n) => n !== i))

	return (
		<div
			data-testid={`${phase}-video`}
			className={cn(
				'flex flex-col gap-2 transition-all',
				active ? 'pomo-video-main md:col-span-2' : 'opacity-60 hover:opacity-100 md:col-span-1'
			)}
		>
			<span className="font-ui text-xs tracking-wide uppercase opacity-70">
				{heading} {videos.length > 1 && `· ${pos + 1}/${videos.length}`}
				{active && ' · now playing'}
			</span>
			<div className="aspect-video w-full overflow-hidden rounded-lg bg-black/40">
				{videoId ? (
					<VideoFrame
						videoId={videoId}
						trackKey={`${cursor.index}:${videoId}`}
						startSeconds={cursor.seconds}
						autoplay={playing}
						onReady={onReady}
						onState={onState}
					/>
				) : (
					<p className="p-4 text-sm opacity-70">{copy.playlist.empty}</p>
				)}
			</div>

			<details
				data-testid={`${phase}-playlist`}
				className="font-ui text-sm opacity-80 open:opacity-100"
			>
				<summary data-testid={`${phase}-playlist-toggle`} className="cursor-pointer">
					{copy.playlist.summary} ({videos.length})
				</summary>
				<div className="mt-2 flex flex-col gap-2">
					<ol className="flex flex-col gap-1">
						{videos.map((id, i) => (
							<li key={`${id}-${i}`} className="flex items-center gap-2">
								<button
									type="button"
									data-testid={`${phase}-playlist-play-${i}`}
									title={copy.playlist.play}
									aria-label={`${copy.playlist.play}: ${titleOf(id)}`}
									onClick={() => onSelectTrack(i)}
									className={cn(
										'btn btn-ghost btn-xs',
										i === pos && 'text-[var(--pomo-accent)]'
									)}
								>
									{i === pos ? '▶' : '▷'}
								</button>
								<a
									href={`https://www.youtube.com/watch?v=${id}`}
									target="_blank"
									rel="noreferrer"
									className="link link-hover flex-1 truncate"
								>
									{titleOf(id)}
								</a>
								<button
									type="button"
									data-testid={`${phase}-playlist-remove-${i}`}
									aria-label={`${copy.playlist.remove}: ${titleOf(id)}`}
									title={copy.playlist.remove}
									onClick={() => remove(i)}
									className="btn btn-ghost btn-xs"
								>
									✕
								</button>
							</li>
						))}
					</ol>
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault()
							add()
						}}
					>
						<input
							data-testid={`${phase}-playlist-input`}
							value={draft}
							placeholder={copy.playlist.add}
							onChange={(e) => {
								setDraft(e.target.value)
								setInvalid(false)
							}}
							className="input input-sm flex-1"
						/>
						<button
							type="submit"
							data-testid={`${phase}-playlist-add`}
							className="btn btn-sm"
						>
							{copy.playlist.addAction}
						</button>
					</form>
					{invalid && <p className="text-error text-xs">{copy.playlist.invalid}</p>}
					<p className="text-xs opacity-60">{copy.playlist.hint}</p>
				</div>
			</details>
		</div>
	)
}

function VideoFrame({
	videoId,
	trackKey,
	startSeconds,
	autoplay,
	onReady,
	onState,
}: {
	videoId: string
	trackKey: string
	startSeconds: number
	autoplay: boolean
	onReady: (p: YTPlayer | null) => void
	onState: (state: number) => void
}) {
	const mount = useRef<HTMLDivElement>(null)
	const player = useRef<YTPlayer | null>(null)
	const loaded = useRef<string | null>(null)
	const [ready, setReady] = useState(false)

	const latest = useRef({ videoId, trackKey, startSeconds, autoplay, onReady, onState })
	latest.current = { videoId, trackKey, startSeconds, autoplay, onReady, onState }

	// One player per phase for the life of the page; tracks are swapped into it
	// below, because tearing the iframe down between songs loses the API handle.
	useEffect(() => {
		if (!mount.current) return
		let created: YTPlayer | null = null
		let cancelled = false
		const host = document.createElement('div')
		mount.current.replaceChildren(host)
		const initial = latest.current
		loaded.current = initial.trackKey
		void loadYouTubeApi().then((YT) => {
			if (cancelled) return
			created = new YT.Player(host, {
				videoId: initial.videoId,
				playerVars: {
					rel: 0,
					playsinline: 1,
					start: Math.floor(initial.startSeconds),
				},
				events: {
					onReady: () => {
						player.current = created
						setReady(true)
						latest.current.onReady(created)
					},
					onStateChange: (e) => latest.current.onState(e.data),
				},
			})
		})
		return () => {
			cancelled = true
			player.current = null
			loaded.current = null
			setReady(false)
			latest.current.onReady(null)
			created?.destroy()
		}
	}, [])

	useEffect(() => {
		if (!ready || loaded.current === trackKey) return
		loaded.current = trackKey
		const { videoId: id, startSeconds: at, autoplay: play } = latest.current
		if (!id) return
		const request = { videoId: id, startSeconds: Math.floor(at) }
		if (play) player.current?.loadVideoById(request)
		else player.current?.cueVideoById(request)
	}, [trackKey, ready])

	return <div ref={mount} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
}

function Modal({
	testId,
	onDismiss,
	children,
}: {
	testId: string
	onDismiss: () => void
	children: ReactNode
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onDismiss])
	return (
		<div data-testid={testId} className="modal modal-open" role="dialog">
			<div className="modal-box flex flex-col gap-4">
				<button
					type="button"
					onClick={onDismiss}
					aria-label="Dismiss"
					className="btn btn-circle btn-ghost btn-sm absolute top-2 right-2"
				>
					✕
				</button>
				{children}
			</div>
			<button
				type="button"
				aria-label="Dismiss"
				className="modal-backdrop"
				onClick={onDismiss}
			/>
		</div>
	)
}

function ReviewDialog({
	pomo,
	onDismiss,
	onSave,
}: {
	pomo: Pomo
	onDismiss: () => void
	onSave: (note: string, clearIntention: boolean) => void
}) {
	const [text, setText] = useState(pomo.intention)
	return (
		<Modal testId="review-dialog" onDismiss={onDismiss}>
			<form
				onSubmit={(e) => {
					e.preventDefault()
					onSave(text, false)
				}}
				className="flex flex-col gap-4"
			>
				<h2 className="font-display text-2xl">
					Pomo done: {minutesBetween(pomo.start, pomo.end!)}m, started {fmtTime(pomo.start)}
				</h2>
				<p className="text-sm opacity-75">
					{pomo.intention ? copy.review.withIntention : copy.review.withoutIntention}
				</p>
				<textarea
					data-testid="review-note"
					autoFocus
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={3}
					placeholder="- a bullet or two of markdown"
					className="textarea w-full font-mono text-sm"
				/>
				<div className="modal-action">
					<button
						type="button"
						data-testid="review-done"
						className="btn btn-outline"
						onClick={() => onSave(text, true)}
					>
						{copy.review.done}
					</button>
					<button type="submit" data-testid="review-keep" className="btn btn-primary">
						{copy.review.keep}
					</button>
				</div>
			</form>
		</Modal>
	)
}

const Ledger = memo(function Ledger({ pomos, day }: { pomos: Pomo[]; day: string }) {
	const today = pomos.filter((p) => p.day === day)
	const earlier = pomos.filter((p) => p.day !== day)
	const earlierDays = [...new Set(earlier.map((p) => p.day))].sort().reverse()
	return (
		<aside
			data-testid="ledger"
			className="flex flex-col gap-3 text-sm lg:border-l lg:border-current/20 lg:pl-6"
		>
			<h2 className="font-display text-xl">{dayLabel(day)}</h2>
			{today.length === 0 && <p className="opacity-60">No pomos yet today.</p>}
			<PomoList pomos={today} />
			{earlierDays.length > 0 && (
				<details className="opacity-70 open:opacity-100">
					<summary className="cursor-pointer">Earlier days</summary>
					{earlierDays.map((d) => (
						<div key={d} className="mt-3">
							<h3 className="font-bold">{dayLabel(d)}</h3>
							<PomoList pomos={earlier.filter((p) => p.day === d)} />
						</div>
					))}
				</details>
			)}
		</aside>
	)
})

function PomoList({ pomos }: { pomos: Pomo[] }) {
	return (
		<ol className="flex flex-col gap-2">
			{pomos.map((p) => (
				<li
					key={p.id}
					data-testid="ledger-entry"
					className={cn(
						'flex flex-col gap-1 rounded-lg bg-white/10 px-3 py-2',
						!p.end && 'ring-1 ring-[var(--pomo-accent)]'
					)}
				>
					<div className="font-ui flex justify-between gap-2 text-xs tabular-nums opacity-70">
						<span>
							{fmtTime(p.start)} – {p.end ? fmtTime(p.end) : 'now'}
							{p.end && ` · ${minutesBetween(p.start, p.end)}m`}
						</span>
						<span title={p.confirmed ? 'confirmed' : p.end ? 'unconfirmed' : 'in progress'}>
							{p.confirmed ? '✅' : p.end ? '◌' : '⏳'}
						</span>
					</div>
					<div
						className={cn('prose prose-sm prose-invert max-w-none', !p.confirmed && 'italic')}
					>
						<ReactMarkdown remarkPlugins={[remarkGfm]}>
							{(p.end ? p.note || p.intention : p.intention) || '_(no intention)_'}
						</ReactMarkdown>
					</div>
				</li>
			))}
		</ol>
	)
}
