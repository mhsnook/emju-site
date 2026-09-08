import { createFileRoute } from '@tanstack/react-router'
import { FastForward, Minus, Pause, Play, Plus, Rewind, RotateCcw, SkipForward } from 'lucide-react'
import { Fragment, memo, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { company } from '#/content/site'

import {
	byStart,
	cn,
	DEFAULT_SETTINGS,
	dayLabel,
	dayTotals,
	draftError,
	draftOf,
	fetchVideoTitle,
	formatClock,
	formatDuration,
	isFresh,
	keepIfSame,
	lastUnreviewed,
	loadCursors,
	loadDay,
	loadIntention,
	loadPomos,
	loadSettings,
	loadTimer,
	loadYouTubeApi,
	isThrowaway,
	msFor,
	otherPhase,
	parseVideoId,
	pastDays,
	pomoFromDraft,
	readPomos,
	readTimer,
	remainingIn,
	remainingOf,
	resolveDay,
	resumablePomo,
	saveCursors,
	saveDay,
	saveIntention,
	savePomos,
	saveSettings,
	saveTimer,
	scrubTimer,
	sounds,
	STORAGE_PREFIX,
	straddlesRollover,
	timerAt,
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
		meta: [
			{ title: PAGE_TITLE },
			{ name: 'description', content: DESCRIPTION },
			{ property: 'og:title', content: PAGE_TITLE },
			{ property: 'og:description', content: DESCRIPTION },
			{ property: 'og:type', content: 'website' },
			{ property: 'og:url', content: PAGE_URL },
			{ name: 'twitter:card', content: 'summary' },
		],
		links: [
			{ rel: 'canonical', href: PAGE_URL },
			{ rel: 'stylesheet', href: pomodanceCss },
		],
	}),
	component: PomodancePage,
})

const TITLE = 'Pomodance'
const PAGE_TITLE = 'Pomodance: a Pomodoro timer slash break-time dance-off'
const PAGE_URL = `${company.site}/pomodance`
const DESCRIPTION =
	'A pomodoro timer where the soundtrack changes when you go on break. Work and chill, then get up and dance.'

const CREDITS = [
	{ label: new URL(company.site).hostname, href: company.site },
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
	| { type: 'set'; timer: Timer }
	| { type: 'restore'; timer: Timer }

function timerReducer(t: Timer, a: TimerAction): Timer {
	switch (a.type) {
		case 'start':
			return t.endsAt ? t : { ...t, endsAt: a.now + t.remainingMs }
		case 'pause':
			return t.endsAt ? { ...t, endsAt: null, remainingMs: remainingIn(t, a.now) } : t
		case 'set':
			return a.timer
		case 'restore':
			return keepIfSame(t, a.timer)
	}
}

const timeFormat = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
const fmtTime = (iso: string) => timeFormat.format(new Date(iso))
const minutesBetween = (a: string, b: string) =>
	Math.round((Date.parse(b) - Date.parse(a)) / 60_000)
const weekday = (day: string) => dayLabel(day).split(',')[0]

/** How far one press of the nudge or scrub controls moves the clock. */
const NUDGE_MS = 60_000
const PROGRESS_SAVE_MS = 5_000
/** Long enough for a player told to play to have reached playing or buffering. */
const PLAYBACK_CHECK_MS = 1_500

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
	// a restored work timer is a pomo still in progress, so it keeps its ledger entry open
	const [pomos, setPomos] = useState(() =>
		loadPomos(settings.phases.work.minutes, timer.phase === 'work' && !isFresh(timer, settings))
	)
	const [day, setDay] = useState(() => resolveDay(loadDay(), pomos, Date.now()))
	// the saved intention belongs to the saved day; a new day starts blank
	const [intention, setIntention] = useState(() => (day === loadDay() ? loadIntention() : ''))

	const [review, setReview] = useState<Pomo | null>(null)
	const [confirmSwitch, setConfirmSwitch] = useState<Phase | null>(null)
	const [askResume, setAskResume] = useState<Pomo | null>(null)
	const [editing, setEditing] = useState<Pomo | null>(null)
	const [askRollover, setAskRollover] = useState(false)
	const [showSettings, setShowSettings] = useState(false)

	const players = useRef<Record<Phase, YTPlayer | null>>({ work: null, break: null })
	const played = useRef<Record<Phase, boolean>>({ work: false, break: false })
	const [playersReady, setPlayersReady] = useState(0)
	const [musicBlocked, setMusicBlocked] = useState(false)

	const { phase } = timer
	const running = timer.endsAt !== null
	const isBreak = phase === 'break'
	const idle = isFresh(timer, settings)
	const current = pomos.find((p) => p.end === null) ?? null
	// enter puts you back to work: it starts a fresh session either way, and picks
	// a paused pomo back up, but it will not start a break you stopped on purpose
	const enterStarts = !running && (idle || phase === 'work')

	useEffect(() => savePomos(pomos), [pomos])
	useEffect(() => saveDay(day), [day])
	useEffect(() => saveIntention(intention), [intention])
	useEffect(() => saveTimer(timer), [timer])

	// This tab is not the only writer: another tab, or a hand edit in devtools,
	// can move the same keys underneath it.
	useEffect(() => {
		const sync = () => {
			setSettings((prev) => keepIfSame(prev, loadSettings()))
			const stored = readPomos()
			setPomos((prev) => keepIfSame(prev, stored))
			const savedDay = loadDay()
			const today = resolveDay(savedDay, stored, Date.now())
			setDay(today)
			setIntention(today === savedDay ? loadIntention() : '')
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

	/** Puts a finished pomo back in progress, and drops the review that finished it. */
	const reopenPomo = (pomo: Pomo) => {
		patchPomo(pomo.id, { end: null })
		setReview((r) => (r?.id === pomo.id ? null : r))
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
		reopenPomo(pomo)
		if (pomo.intention && !intention) updateIntention(pomo.intention)
		const left = remainingOf(pomo, msFor(settings, 'work'))
		dispatch({ type: 'set', timer: timerAt('work', left, true, now) })
		setAskResume(null)
	}
	const pause = () => {
		if (!running) return
		sounds.click()
		dispatch({ type: 'pause', now: Date.now() })
	}
	const switchTo = (next: Phase, autostart: boolean, s = settings) => {
		const now = Date.now()
		dispatch({ type: 'set', timer: timerAt(next, msFor(s, next), autostart, now) })
		if (phase === 'work') closePomo(now)
		if (next === 'work' && autostart) openPomo(now)
	}

	const finish = (autostart: boolean) => {
		sounds.ring()
		switchTo(otherPhase(phase), autostart)
	}
	const complete = () => finish(true)

	/** Adds or takes a minute off this session alone; the soundtrack stays put. */
	const stretch = (deltaMs: number) => {
		const now = Date.now()
		const remaining = remainingIn(timer, now) + deltaMs
		if (remaining <= 0) return finish(running)
		sounds.click()
		dispatch({ type: 'set', timer: timerAt(phase, remaining, running, now) })
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

	// seekTo leaves a paused player paused but starts a cued one, so anything that
	// is not the phase being played gets told to stop again afterwards
	const seekPhase = (p: Phase, deltaSeconds: number, playing: boolean) => {
		const player = players.current[p]
		if (!player || !deltaSeconds) return
		try {
			const at = Math.max(0, player.getCurrentTime() + deltaSeconds)
			player.seekTo(at, true)
			seconds.current[p] = Math.floor(at)
			if (!playing) player.pauseVideo()
		} catch {
			/* player went away mid-seek */
		}
	}

	/** Moves the clock and both soundtracks together, a minute at a time. */
	const scrub = (deltaMs: number) => {
		const now = Date.now()
		const { timer: next, seek } = scrubTimer(timer, settings, deltaMs, now)
		for (const p of PHASES) seekPhase(p, seek[p], running && p === next.phase)
		persistCursors(trackIndex)
		if (next.phase === phase) sounds.click()
		else {
			sounds.ring()
			if (next.phase === 'break') closePomo(now)
			else {
				// the break ended a pomo this is taking back; anything else starts a new one
				const last = lastUnreviewed(pomos, day)
				if (last) reopenPomo(last)
				else openPomo(now)
			}
		}
		dispatch({ type: 'set', timer: next })
	}

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
		if (!running) setMusicBlocked(false)
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

	const setTrack = (p: Phase, index: number) => {
		seconds.current[p] = 0
		const next = { ...trackIndex, [p]: index }
		setTrackIndex(next)
		persistCursors(next)
	}

	const onPlayerState = (p: Phase, state: number) => {
		const YT = window.YT!
		if (state === YT.PlayerState.PLAYING) {
			played.current[p] = true
			if (p === phase) setMusicBlocked(false)
		}
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
						<div className="flex items-center justify-center gap-4">
							<Clock
								endsAt={timer.endsAt}
								remainingMs={timer.remainingMs}
								isBreak={isBreak}
								onComplete={complete}
							/>
							<div className="flex flex-col gap-2">
								<TransportButton
									id="pomo-longer"
									testId="longer-button"
									label="Longer"
									title="Make this session a minute longer"
									onClick={() => stretch(NUDGE_MS)}
									className="size-8 border border-current/30"
								>
									<Plus className="size-5" />
								</TransportButton>
								<TransportButton
									id="pomo-shorter"
									testId="shorter-button"
									label="Shorter"
									title="Make this session a minute shorter"
									onClick={() => stretch(-NUDGE_MS)}
									className="size-8 border border-current/30"
								>
									<Minus className="size-5" />
								</TransportButton>
							</div>
						</div>
						{/* the ids are what the keyboard scene actor tells focus stops apart by
						    (tag name + id), so bare buttons in a row read as a tab cycle */}
						<div className="flex items-center justify-center gap-3">
							<TransportButton
								id="pomo-reset"
								testId="reset-button"
								label="Start over"
								onClick={() => switchTo(phase, false)}
								className="size-11"
							>
								<RotateCcw className="size-5" />
							</TransportButton>
							<TransportButton
								id="pomo-back"
								testId="back-button"
								label="Back a minute"
								title="Back a minute, music and all"
								onClick={() => scrub(-NUDGE_MS)}
								className="size-11"
							>
								<Rewind className="size-5" />
							</TransportButton>
							<TransportButton
								id="pomo-start"
								testId="start-button"
								label={running ? 'Pause' : 'Start'}
								title={running ? 'Pause' : idle ? 'Start' : 'Resume'}
								onClick={() => (running ? pause() : start())}
								className="size-16 border-0 bg-[var(--pomo-accent)] text-black hover:scale-105 hover:bg-[var(--pomo-accent)]"
							>
								{running ? (
									<Pause className="size-7 fill-current" />
								) : (
									<Play className="size-7 fill-current" />
								)}
							</TransportButton>
							<TransportButton
								id="pomo-forward"
								testId="forward-button"
								label="Forward a minute"
								title="Forward a minute, music and all"
								onClick={() => scrub(NUDGE_MS)}
								className="size-11"
							>
								<FastForward className="size-5" />
							</TransportButton>
							<TransportButton
								id="pomo-switch"
								testId="switch-button"
								label={isBreak ? 'Back to work' : 'Skip to break'}
								onClick={() => switchTo(otherPhase(phase), true)}
								className="size-11"
							>
								<SkipForward className="size-5" />
							</TransportButton>
						</div>
						<SettingInput
							testId="intention-input"
							className="w-full max-w-xl"
							label={`Intention for this pomo${
								enterStarts ? (idle ? ' — enter to start' : ' — enter to resume') : ''
							}`}
							value={intention}
							onChange={updateIntention}
							onEnter={enterStarts ? start : undefined}
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
								startSeconds={seconds.current[p]}
								onPlaylistChange={(videos) => updatePhase(p, { videos })}
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
							data-testid="settings-done"
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
				<span>a silly project by </span>
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

/**
 * One of the round controls under the clock. `className` carries the size, which
 * is also the hit box: daisyUI's own min-height would otherwise win over it.
 */
function TransportButton({
	id,
	testId,
	label,
	title,
	onClick,
	className,
	children,
}: {
	id: string
	testId: string
	label: string
	title?: string
	onClick: () => void
	className?: string
	children: ReactNode
}) {
	return (
		<button
			type="button"
			id={id}
			data-testid={testId}
			aria-label={label}
			title={title ?? label}
			onClick={onClick}
			className={cn('btn btn-circle btn-ghost min-h-0 p-0', className)}
		>
			{children}
		</button>
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
	onEnter,
	type = 'text',
	placeholder,
	className,
}: {
	testId: string
	label: string
	value: string
	onChange: (v: string) => void
	onEnter?: () => void
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
				onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
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
	startSeconds: number
	onPlaylistChange: (videos: string[]) => void
	onSelectTrack: (index: number) => void
	onReady: (p: YTPlayer | null) => void
	onState: (state: number) => void
}) {
	const [draft, setDraft] = useState('')
	const [invalid, setInvalid] = useState(false)
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
				{PLAYLIST_HEADING[phase]}
				{videos.length > 1 && ` · ${pos + 1}/${videos.length}`}
				{active && ' · now playing'}
			</span>
			<div className="aspect-video w-full overflow-hidden rounded-lg bg-black/40">
				{videoId ? (
					<VideoFrame
						videoId={videoId}
						index={index}
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
									id={`${phase}-playlist-remove-${i}`}
									data-testid={`${phase}-playlist-remove-${i}`}
									aria-label={`Remove: ${titleOf(id)}`}
									title="Remove"
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
					{invalid && (
						<p className="text-error text-xs">That doesn’t look like a youtube link.</p>
					)}
					<p className="text-xs opacity-60">
						Each switch picks up where this playlist left off, then rolls on to the next
						track.
					</p>
				</div>
			</details>
		</div>
	)
}

function VideoFrame({
	videoId,
	index,
	startSeconds,
	autoplay,
	onReady,
	onState,
}: {
	videoId: string
	index: number
	startSeconds: number
	autoplay: boolean
	onReady: (p: YTPlayer | null) => void
	onState: (state: number) => void
}) {
	const mount = useRef<HTMLDivElement>(null)
	const [player, setPlayer] = useState<YTPlayer | null>(null)
	const trackKey = `${index}:${videoId}`
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
	const [browsing, setBrowsing] = useState(false)
	const [openDay, setOpenDay] = useState<string | null>(null)
	const today = pomos.filter((p) => p.day === day)
	const past = pastDays(pomos, day)
	// the day being read can lose its last pomo to an edit while it is open
	const viewing = openDay && {
		day: openDay,
		pomos: past.find((d) => d.day === openDay)?.pomos ?? [],
	}

	const close = () => {
		setOpenDay(null)
		setBrowsing(false)
	}

	return (
		<aside
			data-testid="ledger"
			className="flex flex-col gap-3 text-sm lg:border-l lg:border-current/20 lg:pl-6"
		>
			{!browsing && (
				<>
					<LedgerHeading
						title={dayLabel(day)}
						pomos={today}
						action={
							<button
								type="button"
								id="pomo-history"
								data-testid="history-button"
								aria-label="Past days"
								title="Past days"
								onClick={() => setBrowsing(true)}
								className="btn btn-ghost btn-sm shrink-0"
							>
								🕘 History
							</button>
						}
					/>
					{today.length === 0 && <p className="opacity-60">No pomos yet today.</p>}
					<PomoList pomos={today} onEdit={onEdit} />
				</>
			)}

			{browsing && !viewing && (
				<>
					<LedgerHeading title="Past days" action={<CloseHistory onClick={close} />} />
					{past.length === 0 && <p className="opacity-60">No earlier days yet.</p>}
					<ol className="flex flex-col gap-2">
						{past.map((entry) => (
							<li key={entry.day}>
								<button
									type="button"
									id={`history-day-${entry.day}`}
									data-testid="history-day"
									onClick={() => setOpenDay(entry.day)}
									className="font-ui flex w-full flex-col items-start gap-0.5 rounded-lg bg-white/10 px-3 py-2 text-left hover:bg-white/20"
								>
									<span>{dayLabel(entry.day)}</span>
									<span className="text-xs opacity-70">{summarize(entry.pomos)}</span>
								</button>
							</li>
						))}
					</ol>
				</>
			)}

			{browsing && viewing && (
				<>
					<LedgerHeading
						title={dayLabel(viewing.day)}
						pomos={viewing.pomos}
						back={
							<button
								type="button"
								id="history-back"
								data-testid="history-back"
								aria-label="Back to the list of past days"
								title="All past days"
								onClick={() => setOpenDay(null)}
								className="btn btn-circle btn-ghost btn-sm shrink-0"
							>
								‹
							</button>
						}
						action={<CloseHistory onClick={close} />}
					/>
					{viewing.pomos.length === 0 && (
						<p className="opacity-60">Nothing left on this day.</p>
					)}
					<PomoList pomos={viewing.pomos} onEdit={onEdit} />
				</>
			)}
		</aside>
	)
})

const summarize = (pomos: Pomo[]) => {
	const { count, minutes } = dayTotals(pomos)
	return `${count} ${count === 1 ? 'pomo' : 'pomos'} · ${formatDuration(minutes)}`
}

function LedgerHeading({
	title,
	pomos,
	back,
	action,
}: {
	title: string
	pomos?: Pomo[]
	back?: ReactNode
	action: ReactNode
}) {
	return (
		<div className="flex items-start justify-between gap-2">
			{back}
			<div className="mr-auto flex min-w-0 flex-col">
				<h2 className="font-display text-xl">{title}</h2>
				{pomos && pomos.length > 0 && (
					<span className="font-ui text-xs opacity-70">{summarize(pomos)}</span>
				)}
			</div>
			{action}
		</div>
	)
}

function CloseHistory({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			id="history-close"
			data-testid="history-close"
			aria-label="Close the history and go back to today"
			title="Back to today"
			onClick={onClick}
			className="btn btn-circle btn-ghost btn-sm shrink-0"
		>
			✕
		</button>
	)
}

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
