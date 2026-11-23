/** What one session reports about itself, written to the shared folder. */
export type SessionState = 'needs_you' | 'running' | 'idle' | 'error' | 'ended'

/** Work that runs on its own: a subagent, a shell, a monitor, a workflow or a scheduled wake-up. */
export type BgItem = { kind: string; label: string }

export type SessionStatus = {
  /** Claude Code session id. */
  id: string
  /** The desktop app's id for this session (`local_…`); '' until known or outside the app. */
  appId: string
  /** First prompt of the session, cut short; '' before the first prompt. */
  title: string
  /** Absolute working directory. */
  cwd: string
  state: SessionState
  /** What it waits on or runs now, e.g. "Bash: npm test"; '' when nothing. */
  detail: string
  /** Epoch ms when `state` last changed. */
  stateSince: number
  /** Epoch ms of the last heartbeat; a stale value means the process is gone. */
  aliveAt: number
  background: BgItem[]
  /** The mod version this session runs; absent in versions before 0.2.3. */
  version?: string
}

/** One row of the desktop app's own session list (ccd_session_mgmt list_sessions). */
export type AppSession = {
  sessionId: string
  title: string
  cwd: string
  branch?: string
  isRunning: boolean
  lastActivityAt: string
  prNumber?: number
  prState?: string
  link?: string
  name?: string
  startedBy?: string
}

/** The board's four columns. */
export type Column = 'needs_you' | 'wip' | 'blocked' | 'done'

/** One card on the board: an app session joined with what its mod reports. */
export type Card = {
  id: string
  title: string
  project: string
  branch: string
  column: Column
  /** Why it sits in its column, e.g. "approve Bash: sbatch run.sh" or "no activity for 14m". */
  reason: string
  /** Epoch ms the card's age counts from. */
  since: number
  pr: string
  link: string
  parentTitle: string
  runningChildren: number
  background: number
  isSelf: boolean
  /** The session runs an older version of this mod than the newest installed. */
  isOutdated: boolean
}

/** A to-do you typed into the board's backlog; shared by every session. */
export type BacklogItem = { id: string; text: string; createdAt: number }

/** A background item on the board, with the session that owns it. */
export type BackgroundRow = BgItem & { session: string; link: string; isSelf: boolean }

/** Which column the pane shows, or all of them. */
export type Filter = 'all' | 'backlog' | 'background' | Column

/** What the pane draws, read at `now`. */
export type Board = {
  now: number
  cards: Card[]
  backlog: BacklogItem[]
  /** Every live session's background work, with the session it belongs to and its app link ('' when none). */
  background: BackgroundRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': { board: Shaped<Board>; filter: Filter }
  }
}
