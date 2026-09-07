import { createFileRoute } from '@tanstack/react-router'
import { Fragment, memo, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { company } from '#/content/site'

import {
	byStart,
	cn,
	DEFAULT_SETTINGS,
	dayLabel,
	draftError,
	draftOf,
	fetchVideoTitle,
	formatClock,
	isFresh,
	keepIfSame,
	loadCursors,
	loadDay,
	loadIntention,
	loadPomos,
	loadSettings,
	loadTimer,
	loadYouTubeApi,
	isThrowaway,
	msFor,
	nextCursor,
	parseVideoId,
	pomoFromDraft,
	readPomos,
	readTimer,
	remainingOf,
	resumablePomo,
	saveCursors,
	saveDay,
	saveIntention,
	savePomos,
	saveSettings,
	saveTimer,
	sounds,
	STORAGE_PREFIX,
	straddlesRollover,
	trackAt,
	trackPos,
	workDayOf,
	type Phase,
	type PhaseSettings,
	type Pomo,
	type PomoDraft,
	type Settings,
	type Timer,
	type YTPlayer,
} from './-lib'

import pomodanceCss from './-styles.css?url'

export const Route = createFileRoute('/(projects)/pomodance/')({
	ssr: false,
	staticData: { bareLayout: true },
	head: () => ({
		meta: [{ title: `${TITLE} — EMJU` }, { name: 'description', content: DESCRIPTION }],
		links: [{ rel: 'stylesheet', href: pomodanceCss }],
	}),
	component: PomodancePage,
})

const TITLE = 'Pomodance'
const DESCRIPTION =
	'A pomodoro timer where the soundtrack changes when you go on break. Work and chill, then get up and dance.'

const CREDITS = [
	{ label: company.name, href: company.site },
	{ label: 'mhsnook', href: 'https://github.com/mhsnook' },
	{ label: 'MIT license', href: `${company.repo}/blob/main/LICENSE` },
	{ label: 'see the code', href: `${company.repo}/tree/main/src/routes/(projects)/pomodance` },
]

const PHASES: Phase[] = ['work', 'break']
const PLAYLIST_HEADING: Record<Phase, string> = {
	work: 'Work playlist',
	break: 'Dance playlist',
}
const MINUTES_LABEL: Record<Phase, string> = {
	work: 'Work minutes',
	break: 'Break minutes',
}

type TimerAction =
	| { type: 'start'; now: number }
	| { type: 'pause'; now: number }
	| { type: 'switch'; phase: Phase; durationMs: number; running: boolean; now: number }
	| { type: 'restore'; timer: Timer }

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
		case 'restore':
			return keepIfSame(t, a.timer)
	}
}

const timeFormat = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
const fmtTime = (iso: string) => timeFormat.format(new Date(iso))
const minutesBetween = (a: string, b: string) =>
	Math.round((Date.parse(b) - Date.parse(a)) / 60_000)
const weekday = (day: string) => dayLabel(day).split(',')[0]

const PROGRESS_SAVE_MS = 5_000
/** Long enough for a player told to play to have reached playing or buffering. */
const PLAYBACK_CHECK_MS = 1_500
/** How long after a track swap the player's own paused/ended events are its old song leaving. */
const SWAP_SETTLE_MS = 1_000

/** Whether sound is on its way out of this player, rather than waiting on a click. */
function playbackUnderway(player: YTPlayer) {
	const YT = window.YT
	if (!YT) return false
	try {
		const state = player.getPlayerState()
		return state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING
	} catch {
		return true
	}
}

function PomodancePage() {
	const [settings, setSettings] = useState<Settings>(loadSettings)
	const [restored] = useState(loadCursors)
	const [trackIndex, setTrackIndex] = useState<Record<Phase, number>>({
		work: restored.work.index,
		break: restored.break.index,
	})
	// nothing renders the playback position, so it stays out of state and the
	// page does not re-render every time it is saved
	const seconds = useRef<Record<Phase, number>>({
		work: restored.work.seconds,
		break: restored.break.seconds,
	})
	const [timer, dispatch] = useReducer(timerReducer, settings, loadTimer)
	const [intention, setIntention] = useState(loadIntention)
	// a restored work timer is a pomo still in progress, so it keeps its ledger entry open
	const [pomos, setPomos] = useState(() =>
		loadPomos(settings.phases.work.minutes, timer.phase === 'work' && !isFresh(timer, settings))
	)
	const [day, setDay] = useState(() => loadDay() ?? workDayOf(new Date()))

	const [review, setReview] = useState<Pomo | null>(null)
	const [confirmSwitch, setConfirmSwitch] = useState<Phase | null>(null)
	const [askResume, setAskResume] = useState<Pomo | null>(null)
	const [editing, setEditing] = useState<Pomo | null>(null)
	const [askRollover, setAskRollover] = useState(false)
	const [showSettings, setShowSettings] = useState(false)

	const players = useRef<Record<Phase, YTPlayer | null>>({ work: null, break: null })
	const played = useRef<Record<Phase, boolean>>({ work: false, break: false })
	// bumped whenever a phase should load its track afresh, so that playing the
	// same song again — or the same song under a new index — still reads as a change
	const [plays, setPlays] = useState<Record<Phase, number>>({ work: 0, break: 0 })
	const swappedAt = useRef<Record<Phase, number>>({ work: 0, break: 0 })
	const [playersReady, setPlayersReady] = useState(0)
	const [musicBlocked, setMusicBlocked] = useState(false)

	const { phase } = timer
	const running = timer.endsAt !== null
	const isBreak = phase === 'break'
	const idle = isFresh(timer, settings)
	const current = pomos.find((p) => p.end === null) ?? null

	useEffect(() => savePomos(pomos), [pomos])
	useEffect(() => saveDay(day), [day])
	useEffect(() => saveTimer(timer), [timer])

	// This tab is not the only writer: another tab, or a hand edit in devtools,
	// can move the same keys underneath it.
	useEffect(() => {
		const sync = () => {
			const stored = loadSettings()
			setSettings((prev) => keepIfSame(prev, stored))
			setPomos((prev) => keepIfSame(prev, readPomos()))
			setIntention(loadIntention())
			setDay(loadDay() ?? workDayOf(new Date()))
			const t = readTimer()
			if (t) dispatch({ type: 'restore', timer: t })
		}
		const onStorage = (e: StorageEvent) => {
			if (e.key === null || e.key.startsWith(STORAGE_PREFIX)) sync()
		}
		window.addEventListener('storage', onStorage)
		window.addEventListener('focus', sync)
		return () => {
			window.removeEventListener('storage', onStorage)
			window.removeEventListener('focus', sync)
		}
	}, [])

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
		if (isThrowaway(current, now)) {
			setPomos((ps) => ps.filter((p) => p.id !== current.id))
			return
		}
		const closed = { ...current, end: new Date(now).toISOString() }
		patchPomo(current.id, closed)
		setReview(closed)
	}

	const startTimer = (now: number) => {
		sounds.beep()
		dispatch({ type: 'start', now })
		if (phase === 'work') openPomo(now)
	}

	const start = () => {
		if (running) return
		const now = Date.now()
		const interrupted =
			phase === 'work' && !current ? resumablePomo(pomos, day, settings, now) : null
		if (interrupted) setAskResume(interrupted)
		else startTimer(now)
	}

	const resumePomo = (pomo: Pomo) => {
		const now = Date.now()
		sounds.beep()
		patchPomo(pomo.id, { end: null })
		if (pomo.intention && !intention) updateIntention(pomo.intention)
		dispatch({
			type: 'switch',
			phase: 'work',
			durationMs: remainingOf(pomo, msFor(settings, 'work')),
			running: true,
			now,
		})
		setAskResume(null)
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
	const persistCursors = (index: Record<Phase, number>) =>
		saveCursors({
			work: { index: index.work, seconds: seconds.current.work },
			break: { index: index.break, seconds: seconds.current.break },
		})

	// A paused player keeps its own position, so resuming a phase needs no help.
	// The saved seconds are for the next page load.
	const captureProgress = (p: Phase) => {
		const player = players.current[p]
		const YT = window.YT
		if (!player || !YT) return
		try {
			const state = player.getPlayerState()
			if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED) return
			seconds.current[p] = Math.max(0, Math.floor(player.getCurrentTime()))
			persistCursors(trackIndex)
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
		let check: ReturnType<typeof setTimeout> | undefined
		for (const p of PHASES) {
			const player = players.current[p]
			if (!player) continue
			if (p === phase && running) {
				player.playVideo()
				// a page that has not been clicked yet is not allowed to start audio,
				// and the refusal is silent: ask the player afterwards whether it took
				check = setTimeout(() => setMusicBlocked(!playbackUnderway(player)), PLAYBACK_CHECK_MS)
			} else {
				captureRef.current(p)
				player.pauseVideo()
			}
		}
		if (!running || !players.current[phase]) setMusicBlocked(false)
		return () => clearTimeout(check)
	}, [phase, running, playersReady])

	// the click that dismisses the notice is a user gesture wherever it lands, so
	// any click or key will do
	useEffect(() => {
		if (!musicBlocked) return
		const retry = () => players.current[phase]?.playVideo()
		window.addEventListener('pointerdown', retry)
		window.addEventListener('keydown', retry)
		return () => {
			window.removeEventListener('pointerdown', retry)
			window.removeEventListener('keydown', retry)
		}
	}, [musicBlocked, phase])

	const beginSwap = (p: Phase) => {
		swappedAt.current[p] = Date.now()
		setPlays((n) => ({ ...n, [p]: n[p] + 1 }))
	}

	const setTrack = (p: Phase, index: number) => {
		seconds.current[p] = 0
		const next = { ...trackIndex, [p]: index }
		setTrackIndex(next)
		beginSwap(p)
		persistCursors(next)
	}

	/**
	 * An edit to the playlist leaves the song that is playing alone. Removing that
	 * song is the one case that moves the cursor, on to whatever follows it.
	 */
	const updatePlaylist = (p: Phase, videos: string[]) => {
		const cursor = nextCursor(settings.phases[p].videos, videos, trackIndex[p])
		updatePhase(p, { videos })
		const next = { ...trackIndex, [p]: cursor.index }
		setTrackIndex(next)
		if (cursor.restart) {
			seconds.current[p] = 0
			beginSwap(p)
		}
		persistCursors(next)
	}

	const onPlayerState = (p: Phase, state: number) => {
		const YT = window.YT!
		if (state === YT.PlayerState.PLAYING) {
			played.current[p] = true
			if (p === phase) setMusicBlocked(false)
		}
		// a swapped-in track reports the old one pausing and ending on its way out;
		// neither is the song finishing or the user reaching for the controls
		const settling = Date.now() - swappedAt.current[p] < SWAP_SETTLE_MS
		if (settling && (state === YT.PlayerState.ENDED || state === YT.PlayerState.PAUSED)) return
		if (state === YT.PlayerState.ENDED) {
			setTrack(p, trackIndex[p] + 1)
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
		// a browser that blocked the autoplay of a restored pomo reports the player
		// as paused; only a player that did get going may stop the clock
		else if (state === YT.PlayerState.PAUSED && played.current[p]) pause()
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

	const updatePhase = (p: Phase, patch: Partial<PhaseSettings>) =>
		updateSettings({
			phases: { ...settings.phases, [p]: { ...settings.phases[p], ...patch } },
		})

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

	const today = workDayOf(new Date())

	return (
		<div
			data-testid="pomodance-page"
			data-theme="emju-dark"
			className={cn(
				'pomo flex min-h-screen flex-col',
				isBreak && 'is-break',
				settings.lessMotion && 'is-calm'
			)}
		>
			<div
				className={cn(
					'grid flex-1 gap-6 p-6',
					settings.showLedger && 'lg:grid-cols-[1fr_20rem]'
				)}
			>
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
					<header className="flex items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<h1 className="font-display text-3xl">
								{isBreak ? '💃 break time 🕺' : '🍅 pomodance'}
							</h1>
							<p className="font-ui text-sm opacity-70">{DESCRIPTION}</p>
						</div>
						<button
							type="button"
							id="pomo-settings"
							data-testid="settings-button"
							aria-label="Settings"
							title="Settings"
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
						<Clock
							endsAt={timer.endsAt}
							remainingMs={timer.remainingMs}
							isBreak={isBreak}
							onComplete={complete}
						/>
						{/* the ids are what the keyboard scene actor tells focus stops apart by
						    (tag name + id), so four bare buttons in a row read as a tab cycle */}
						<div className="flex flex-wrap justify-center gap-3">
							<button
								id="pomo-start"
								data-testid="start-button"
								onClick={() => (running ? pause() : start())}
								className="btn btn-lg rounded-full border-0 bg-[var(--pomo-accent)] font-bold text-black hover:scale-105 hover:bg-[var(--pomo-accent)]"
							>
								{running ? 'Pause' : idle ? 'Start' : 'Resume'}
							</button>
							<button
								id="pomo-reset"
								data-testid="reset-button"
								onClick={() => switchTo(phase, false)}
								className="btn btn-lg btn-outline rounded-full"
							>
								Reset
							</button>
							<button
								id="pomo-switch"
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
							label="Intention for this pomo"
							value={intention}
							onChange={updateIntention}
							placeholder="what are you going to do?"
						/>
					</section>

					{musicBlocked && (
						<div
							data-testid="music-blocked"
							className="flex flex-col items-center gap-1 text-center"
						>
							<button
								type="button"
								data-testid="resume-music"
								id="resume-music"
								onClick={() => players.current[phase]?.playVideo()}
								className="btn btn-outline rounded-full"
							>
								▶ Bring the music back
							</button>
							<p className="font-ui text-xs opacity-70">
								Browsers don’t let a page start audio on its own, so the soundtrack needs
								one click after a reload.
							</p>
						</div>
					)}

					<section className="grid items-start gap-4 md:grid-cols-3">
						{PHASES.map((p) => (
							<PhaseVideo
								key={p}
								phase={p}
								active={phase === p}
								playing={phase === p && running}
								videos={settings.phases[p].videos}
								index={trackIndex[p]}
								loadKey={plays[p]}
								startSeconds={seconds.current[p]}
								onPlaylistChange={(videos) => updatePlaylist(p, videos)}
								onSelectTrack={(i) => setTrack(p, i)}
								onReady={(player) => registerPlayer(p, player)}
								onState={(s) => onPlayerStateRef.current(p, s)}
							/>
						))}
					</section>
				</div>

				{settings.showLedger && <Ledger pomos={pomos} day={day} onEdit={setEditing} />}
			</div>

			<PomodanceFooter />

			{showSettings && (
				<Modal testId="settings-dialog" onDismiss={() => setShowSettings(false)}>
					<h2 className="font-display text-2xl">Settings</h2>
					<div className="grid gap-3 sm:grid-cols-2">
						{PHASES.map((p) => (
							<SettingInput
								key={p}
								testId={`${p}-minutes-input`}
								label={MINUTES_LABEL[p]}
								type="number"
								value={String(settings.phases[p].minutes)}
								onChange={(v) =>
									updatePhase(p, {
										minutes: clampMinutes(v, DEFAULT_SETTINGS.phases[p].minutes),
									})
								}
							/>
						))}
					</div>
					<Toggle
						testId="ledger-toggle"
						label="Show the ledger"
						checked={settings.showLedger}
						onChange={(v) => updateSettings({ showLedger: v })}
					/>
					<Toggle
						testId="less-motion-toggle"
						label="Less motion"
						hint="Calmer colours and no wobbling while the dance music plays."
						checked={settings.lessMotion}
						onChange={(v) => updateSettings({ lessMotion: v })}
					/>
					<div className="modal-action">
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => setShowSettings(false)}
						>
							Done
						</button>
					</div>
				</Modal>
			)}

			{review && (
				<ReviewDialog
					pomo={review}
					onDismiss={() =>
						finishReview(review.note || review.intention, review.confirmed, false)
					}
					onSave={(note, clearIntention) => finishReview(note, true, clearIntention)}
				/>
			)}

			{editing && (
				<EditPomoDialog
					pomo={editing}
					otherInProgress={current !== null && current.id !== editing.id}
					onDismiss={() => setEditing(null)}
					onSave={(edited) => {
						setPomos((ps) => ps.map((p) => (p.id === edited.id ? edited : p)).sort(byStart))
						setEditing(null)
					}}
					onDelete={() => {
						setPomos((ps) => ps.filter((p) => p.id !== editing.id))
						setEditing(null)
					}}
				/>
			)}

			{askResume && (
				<Modal testId="resume-dialog" onDismiss={() => setAskResume(null)}>
					<h2 className="font-display text-2xl">Pick your last pomo back up?</h2>
					<p>
						You started it at {fmtTime(askResume.start)} and it stopped{' '}
						{minutesBetween(askResume.start, askResume.end!)}m later, with{' '}
						{Math.ceil(remainingOf(askResume, msFor(settings, 'work')) / 60_000)}m still on
						the clock.
					</p>
					{askResume.intention && (
						<div className="prose prose-sm prose-invert max-w-none opacity-75">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>
								{askResume.intention}
							</ReactMarkdown>
						</div>
					)}
					<div className="modal-action">
						<button
							type="button"
							data-testid="resume-fresh"
							className="btn btn-outline"
							onClick={() => {
								setAskResume(null)
								startTimer(Date.now())
							}}
						>
							No, start a new one
						</button>
						<button
							type="button"
							data-testid="resume-yes"
							className="btn btn-primary"
							onClick={() => resumePomo(askResume)}
						>
							Yes, carry on
						</button>
					</div>
				</Modal>
			)}

			{confirmSwitch && (
				<Modal testId="confirm-switch-dialog" onDismiss={() => setConfirmSwitch(null)}>
					<h2 className="font-display text-2xl">
						{confirmSwitch === 'break'
							? 'End the pomo and start the break?'
							: 'End the break and get back to work?'}
					</h2>
					<div className="modal-action">
						<button
							type="button"
							className="btn btn-outline"
							onClick={() => setConfirmSwitch(null)}
						>
							No, stay
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
							Yes, switch
						</button>
					</div>
				</Modal>
			)}

			{askRollover && (
				<Modal testId="rollover-dialog" onDismiss={() => setAskRollover(false)}>
					<h2 className="font-display text-2xl">It’s past 4am</h2>
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

function PomodanceFooter() {
	return (
		<footer
			data-testid="pomodance-footer"
			className="font-ui px-6 pb-6 text-center text-xs opacity-60"
		>
			<p>
				<span>© {new Date().getFullYear()} </span>
				{CREDITS.map((link, i) => (
					<Fragment key={link.href}>
						{i > 0 && <span aria-hidden> · </span>}
						<a
							id={`pomo-credit-${i}`}
							href={link.href}
							className="underline underline-offset-2"
						>
							{link.label}
						</a>
					</Fragment>
				))}
			</p>
		</footer>
	)
}

function Clock({
	endsAt,
	remainingMs,
	isBreak,
	onComplete,
}: {
	endsAt: number | null
	remainingMs: number
	isBreak: boolean
	onComplete: () => void
}) {
	const [secondsLeft, setSecondsLeft] = useState(() => Math.ceil(remainingMs / 1000))
	const complete = useRef(onComplete)
	complete.current = onComplete

	// tick from the wall clock so a backgrounded tab still finishes on time
	useEffect(() => {
		if (endsAt === null) return setSecondsLeft(Math.ceil(remainingMs / 1000))
		const tick = () => {
			const left = endsAt - Date.now()
			if (left > 0) setSecondsLeft(Math.ceil(left / 1000))
			else complete.current()
		}
		tick()
		const id = setInterval(tick, 250)
		return () => clearInterval(id)
	}, [endsAt, remainingMs])

	const text = formatClock(secondsLeft)
	useEffect(() => {
		document.title = `${text} ${isBreak ? '💃' : '🍅'} ${TITLE}`
	}, [text, isBreak])

	return (
		<div
			data-testid="clock"
			className="pomo-clock font-display text-[clamp(4rem,20vw,11rem)] leading-none font-bold tabular-nums"
			aria-live="polite"
		>
			{text}
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
	type?: 'text' | 'number' | 'date' | 'datetime-local'
	placeholder?: string
	className?: string
}) {
	return (
		<label className={cn('font-ui flex flex-col gap-1 text-sm', className)}>
			<span className="opacity-70">{label}</span>
			<input
				id={testId}
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
				id={testId}
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

function useVideoTitles(ids: string[]) {
	const [titles, setTitles] = useState<Record<string, string>>({})
	const key = ids.join(',')

	useEffect(() => {
		let cancelled = false
		for (const id of key ? key.split(',') : []) {
			void fetchVideoTitle(id).then((title) => {
				if (title && !cancelled) setTitles((t) => (t[id] ? t : { ...t, [id]: title }))
			})
		}
		return () => {
			cancelled = true
		}
	}, [key])

	return (id: string) => titles[id] ?? id
}

function PhaseVideo({
	phase,
	active,
	playing,
	videos,
	index,
	loadKey,
	startSeconds,
	onPlaylistChange,
	onSelectTrack,
	onReady,
	onState,
}: {
	phase: Phase
	active: boolean
	playing: boolean
	videos: string[]
	index: number
	loadKey: number
	startSeconds: number
	onPlaylistChange: (videos: string[]) => void
	onSelectTrack: (index: number) => void
	onReady: (p: YTPlayer | null) => void
	onState: (state: number) => void
}) {
	const [draft, setDraft] = useState('')
	const [invalid, setInvalid] = useState(false)
	const [editingTrack, setEditingTrack] = useState<number | null>(null)
	const [trackDraft, setTrackDraft] = useState('')
	const [trackInvalid, setTrackInvalid] = useState(false)
	const titleOf = useVideoTitles(videos)

	const pos = trackPos(videos.length, index)
	const videoId = trackAt(videos, index)

	const add = () => {
		const id = parseVideoId(draft)
		if (!id) return setInvalid(true)
		setInvalid(false)
		setDraft('')
		onPlaylistChange([...videos, id])
	}

	// a phase with an empty playlist has no soundtrack, so the last track is
	// changed rather than taken away
	const remove = (i: number) =>
		videos.length > 1 && onPlaylistChange(videos.filter((_, n) => n !== i))

	const startEdit = (i: number) => {
		setEditingTrack(i)
		setTrackDraft(videos[i])
		setTrackInvalid(false)
	}

	const saveEdit = (i: number) => {
		const id = parseVideoId(trackDraft)
		if (!id) return setTrackInvalid(true)
		setEditingTrack(null)
		onPlaylistChange(videos.map((v, n) => (n === i ? id : v)))
	}

	return (
		<div
			data-testid={`${phase}-video`}
			className={cn(
				'flex flex-col gap-2 transition-all',
				active ? 'pomo-video-main md:col-span-2' : 'opacity-60 hover:opacity-100 md:col-span-1'
			)}
		>
			<span className="font-ui text-xs tracking-wide uppercase opacity-70">
				{PLAYLIST_HEADING[phase]}
				{videos.length > 1 && ` · ${pos + 1}/${videos.length}`}
				{active && ' · now playing'}
			</span>
			<div className="aspect-video w-full overflow-hidden rounded-lg bg-black/40">
				{videoId ? (
					<VideoFrame
						videoId={videoId}
						loadKey={loadKey}
						startSeconds={startSeconds}
						autoplay={playing}
						onReady={onReady}
						onState={onState}
					/>
				) : (
					<p className="p-4 text-sm opacity-70">
						No videos yet. Paste a youtube link to give this half of the timer a soundtrack.
					</p>
				)}
			</div>

			<details
				data-testid={`${phase}-playlist`}
				className="font-ui text-sm opacity-80 open:opacity-100"
			>
				<summary
					id={`${phase}-playlist-toggle`}
					data-testid={`${phase}-playlist-toggle`}
					className="cursor-pointer"
				>
					Playlist ({videos.length})
				</summary>
				<div className="mt-2 flex flex-col gap-2">
					<ol className="flex flex-col gap-1">
						{videos.map((id, i) => (
							<li key={`${id}-${i}`} className="flex items-center gap-2">
								<button
									type="button"
									id={`${phase}-playlist-play-${i}`}
									data-testid={`${phase}-playlist-play-${i}`}
									title="Play this one next"
									aria-label={`Play this one next: ${titleOf(id)}`}
									onClick={() => onSelectTrack(i)}
									className={cn(
										'btn btn-ghost btn-xs',
										i === pos && 'text-[var(--pomo-accent)]'
									)}
								>
									{i === pos ? '▶' : '▷'}
								</button>
								{editingTrack === i ? (
									<form
										className="flex flex-1 items-center gap-2"
										onSubmit={(e) => {
											e.preventDefault()
											saveEdit(i)
										}}
									>
										<input
											id={`${phase}-playlist-edit-input-${i}`}
											data-testid={`${phase}-playlist-edit-input-${i}`}
											autoFocus
											value={trackDraft}
											aria-label={`Youtube link for track ${i + 1}`}
											onChange={(e) => {
												setTrackDraft(e.target.value)
												setTrackInvalid(false)
											}}
											className="input input-xs flex-1"
										/>
										<button
											type="submit"
											id={`${phase}-playlist-edit-save-${i}`}
											data-testid={`${phase}-playlist-edit-save-${i}`}
											className="btn btn-xs"
										>
											Save
										</button>
										<button
											type="button"
											id={`${phase}-playlist-edit-cancel-${i}`}
											data-testid={`${phase}-playlist-edit-cancel-${i}`}
											onClick={() => setEditingTrack(null)}
											className="btn btn-ghost btn-xs"
										>
											Cancel
										</button>
									</form>
								) : (
									<>
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
											id={`${phase}-playlist-edit-${i}`}
											data-testid={`${phase}-playlist-edit-${i}`}
											aria-label={`Change the link for: ${titleOf(id)}`}
											title="Change the link"
											onClick={() => startEdit(i)}
											className="btn btn-ghost btn-xs"
										>
											✎
										</button>
										{videos.length > 1 && (
											<button
												type="button"
												id={`${phase}-playlist-remove-${i}`}
												data-testid={`${phase}-playlist-remove-${i}`}
												aria-label={`Remove: ${titleOf(id)}`}
												title="Remove"
												onClick={() => remove(i)}
												className="btn btn-ghost btn-xs"
											>
												✕
											</button>
										)}
									</>
								)}
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
							id={`${phase}-playlist-input`}
							data-testid={`${phase}-playlist-input`}
							value={draft}
							placeholder="Paste a youtube link or id"
							onChange={(e) => {
								setDraft(e.target.value)
								setInvalid(false)
							}}
							className="input input-sm flex-1"
						/>
						<button
							type="submit"
							id={`${phase}-playlist-add`}
							data-testid={`${phase}-playlist-add`}
							className="btn btn-sm"
						>
							Add
						</button>
					</form>
					{(invalid || trackInvalid) && (
						<p className="text-error text-xs">That doesn’t look like a youtube link.</p>
					)}
					<p className="text-xs opacity-60">
						Each switch picks up where this playlist left off, then rolls on to the next
						track.
						{videos.length === 1 && ' The last track can be changed, but not taken away.'}
					</p>
				</div>
			</details>
		</div>
	)
}

function VideoFrame({
	videoId,
	loadKey,
	startSeconds,
	autoplay,
	onReady,
	onState,
}: {
	videoId: string
	loadKey: number
	startSeconds: number
	autoplay: boolean
	onReady: (p: YTPlayer | null) => void
	onState: (state: number) => void
}) {
	const mount = useRef<HTMLDivElement>(null)
	const [player, setPlayer] = useState<YTPlayer | null>(null)
	const trackKey = `${loadKey}:${videoId}`
	const loaded = useRef<string | null>(null)

	const latest = useRef({ videoId, trackKey, startSeconds, autoplay, onReady, onState })
	latest.current = { videoId, trackKey, startSeconds, autoplay, onReady, onState }

	// One player per phase for the life of the page; tracks are swapped into it
	// below, because tearing the iframe down between songs loses the API handle.
	useEffect(() => {
		if (!mount.current) return
		const { videoId: id, startSeconds: at, trackKey: key } = latest.current
		let created: YTPlayer | null = null
		let cancelled = false
		const host = document.createElement('div')
		mount.current.replaceChildren(host)
		loaded.current = key
		void loadYouTubeApi().then((YT) => {
			if (cancelled) return
			created = new YT.Player(host, {
				videoId: id,
				playerVars: { rel: 0, playsinline: 1, start: Math.floor(at) },
				events: {
					onReady: () => {
						setPlayer(created)
						latest.current.onReady(created)
					},
					onStateChange: (e) => latest.current.onState(e.data),
				},
			})
		})
		return () => {
			cancelled = true
			loaded.current = null
			setPlayer(null)
			latest.current.onReady(null)
			created?.destroy()
		}
	}, [])

	useEffect(() => {
		if (!player || loaded.current === trackKey) return
		loaded.current = trackKey
		const { videoId: id, startSeconds: at, autoplay: play } = latest.current
		if (!id) return
		const request = { videoId: id, startSeconds: Math.floor(at) }
		if (play) player.loadVideoById(request)
		else player.cueVideoById(request)
	}, [trackKey, player])

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
	const [text, setText] = useState(pomo.note || pomo.intention)
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
					{pomo.intention
						? 'Here was your intention. Is that what you worked on, or do you want to put something else?'
						: 'No intention was set. What did you work on?'}
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
						Yep, and I’m done with it
					</button>
					<button type="submit" data-testid="review-keep" className="btn btn-primary">
						Yep, keep it as my intention
					</button>
				</div>
			</form>
		</Modal>
	)
}

function EditPomoDialog({
	pomo,
	otherInProgress,
	onSave,
	onDelete,
	onDismiss,
}: {
	pomo: Pomo
	otherInProgress: boolean
	onSave: (pomo: Pomo) => void
	onDelete: () => void
	onDismiss: () => void
}) {
	const [draft, setDraft] = useState<PomoDraft>(() => draftOf(pomo))
	const set = (patch: Partial<PomoDraft>) => setDraft((d) => ({ ...d, ...patch }))
	const error = draftError(draft, otherInProgress)
	const inProgress = pomo.end === null

	return (
		<Modal testId="edit-dialog" onDismiss={onDismiss}>
			<h2 className="font-display text-2xl">Edit this pomo</h2>
			<div className="grid gap-3 sm:grid-cols-3">
				<SettingInput
					testId="edit-day"
					label="Filed under"
					type="date"
					value={draft.day}
					onChange={(v) => set({ day: v })}
				/>
				<SettingInput
					testId="edit-start"
					label="Started"
					type="datetime-local"
					value={draft.start}
					onChange={(v) => set({ start: v })}
				/>
				<SettingInput
					testId="edit-end"
					label="Ended (empty = still going)"
					type="datetime-local"
					value={draft.end}
					onChange={(v) => set({ end: v })}
				/>
			</div>
			<SettingInput
				testId="edit-intention"
				label="Intention"
				value={draft.intention}
				onChange={(v) => set({ intention: v })}
			/>
			<label className="font-ui flex flex-col gap-1 text-sm">
				<span className="opacity-70">Note</span>
				<textarea
					id="edit-note"
					data-testid="edit-note"
					value={draft.note}
					onChange={(e) => set({ note: e.target.value })}
					rows={3}
					placeholder="- a bullet or two of markdown"
					className="textarea w-full font-mono text-sm"
				/>
			</label>
			<Toggle
				testId="edit-confirmed"
				label="Reviewed"
				checked={draft.confirmed}
				onChange={(v) => set({ confirmed: v })}
			/>
			{error && (
				<p data-testid="edit-error" className="text-error text-sm">
					{error}
				</p>
			)}
			<div className="modal-action justify-between">
				{inProgress ? (
					<p data-testid="edit-delete-blocked" className="max-w-2xs text-xs opacity-70">
						This one is still going. Stop the timer, then delete the finished entry.
					</p>
				) : (
					<button
						type="button"
						data-testid="edit-delete"
						id="edit-delete"
						className="btn btn-outline btn-error"
						onClick={onDelete}
					>
						Delete it
					</button>
				)}
				<div className="flex gap-2">
					<button type="button" id="edit-cancel" className="btn btn-ghost" onClick={onDismiss}>
						Cancel
					</button>
					<button
						type="button"
						data-testid="edit-save"
						id="edit-save"
						disabled={error !== null}
						className="btn btn-primary"
						onClick={() => onSave(pomoFromDraft(pomo, draft))}
					>
						Save
					</button>
				</div>
			</div>
		</Modal>
	)
}

const Ledger = memo(function Ledger({
	pomos,
	day,
	onEdit,
}: {
	pomos: Pomo[]
	day: string
	onEdit: (pomo: Pomo) => void
}) {
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
			<PomoList pomos={today} onEdit={onEdit} />
			{earlierDays.length > 0 && (
				<details className="opacity-70 open:opacity-100">
					<summary className="cursor-pointer">Earlier days</summary>
					{earlierDays.map((d) => (
						<div key={d} className="mt-3">
							<h3 className="font-bold">{dayLabel(d)}</h3>
							<PomoList pomos={earlier.filter((p) => p.day === d)} onEdit={onEdit} />
						</div>
					))}
				</details>
			)}
		</aside>
	)
})

function PomoList({ pomos, onEdit }: { pomos: Pomo[]; onEdit: (pomo: Pomo) => void }) {
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
						<span className="flex items-center gap-1">
							<span
								title={p.confirmed ? 'confirmed' : p.end ? 'unconfirmed' : 'in progress'}
							>
								{p.confirmed ? '✅' : p.end ? '◌' : '⏳'}
							</span>
							<button
								type="button"
								data-testid="ledger-edit"
								id={`ledger-edit-${p.id}`}
								aria-label={`Edit the pomo that started at ${fmtTime(p.start)}`}
								title="Edit"
								onClick={() => onEdit(p)}
								className="btn btn-ghost btn-xs"
							>
								✎
							</button>
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
