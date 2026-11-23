import type { AppSession, BackgroundRow, Card, Column, SessionStatus } from '../types'

/** A session whose heartbeat is older than this has no live process. */
export const GONE_AFTER_MS = 2 * 60_000
/** A running session with no activity for this long counts as stuck. */
export const STALL_AFTER_MS = 10 * 60_000
/** Finished sessions stay in Done for this long. */
export const DONE_WINDOW_MS = 24 * 60 * 60_000
/** Tools that always stop and wait for the person. */
export const PERSON_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d`
}

export function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** A short label for a tool call: the tool and its most telling argument. */
export function describeCall(tool: string, input: Readonly<Record<string, unknown>>): string {
  const name = tool.startsWith('mcp__') ? (tool.split('__').at(-1) ?? tool) : tool
  const questions = input.questions
  if (Array.isArray(questions) && questions.length > 0) {
    const q = (questions[0] as Record<string, unknown>).question
    if (typeof q === 'string') return `${name}: ${cut(q, 80)}`
  }
  for (const key of ['description', 'command', 'file_path', 'url', 'pattern', 'query', 'prompt']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return `${name}: ${cut(value, 80)}`
  }
  return name
}

/** Compares dotted versions ("0.2.10" > "0.2.9"); a missing version is the oldest. */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const parts = (v: string | undefined) => (v ?? '').split('.').map(n => Number.parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** The project a folder belongs to: a worktree reads as its repository. */
export function projectLabel(cwd: string): string {
  if (cwd.includes('/scratch-workspaces/')) return 'No folder'
  const repo = cwd.split('/.claude/worktrees/')[0] ?? cwd
  return repo.split('/').filter(Boolean).at(-1) ?? cwd
}

/** The text of a tool's result, whatever shape it came in. */
export function resultText(result: unknown): string {
  if (typeof result === 'string') return result
  const blocks = Array.isArray(result)
    ? result
    : typeof result === 'object' && result !== null && Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: unknown[] }).content
      : undefined
  if (blocks) {
    return blocks
      .map(b => (typeof b === 'object' && b !== null && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .join('')
  }
  return JSON.stringify(result ?? '')
}

function isAppSession(v: unknown): v is AppSession {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.sessionId === 'string' && typeof r.cwd === 'string' && typeof r.isRunning === 'boolean'
}

/** Rows of the app's list_sessions (an array) or get_session (one object); [] when unreadable. */
export function parseAppSessions(result: unknown): AppSession[] {
  try {
    const parsed: unknown = JSON.parse(resultText(result))
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.filter(isAppSession).map(r => ({ ...r, title: typeof r.title === 'string' ? r.title : '' }))
  } catch {
    return []
  }
}

function prLabel(s: AppSession): string {
  if (s.prNumber === undefined) return ''
  return `PR #${s.prNumber}${s.prState ? ` ${s.prState.toLowerCase()}` : ''}`
}

type Placement = { column: Column; reason: string; since: number }

/** Where an app session goes, from what the app knows and what its mod reports. */
export function place(
  app: AppSession,
  st: SessionStatus | undefined,
  runningChildren: number,
  now: number,
): Placement | undefined {
  const last = Date.parse(app.lastActivityAt) || now
  const isAlive = st !== undefined && now - st.aliveAt <= GONE_AFTER_MS
  if (st && isAlive && st.state === 'needs_you') return { column: 'needs_you', reason: st.detail, since: st.stateSince }
  if (st && st.state === 'error') return { column: 'blocked', reason: st.detail || 'last turn failed', since: st.stateSince }
  if (app.isRunning && st && st.state !== 'ended' && !isAlive) {
    return { column: 'blocked', reason: 'no signal from the session', since: st.aliveAt }
  }
  if (app.isRunning && !isAlive && now - last > STALL_AFTER_MS) {
    return { column: 'blocked', reason: `no activity for ${formatAge(now - last)}`, since: last }
  }
  if (app.isRunning) {
    return { column: 'wip', reason: (isAlive && st?.detail) || 'working', since: isAlive && st ? st.stateSince : last }
  }
  if (runningChildren > 0) {
    return { column: 'wip', reason: `waiting on ${runningChildren} sub-session${runningChildren > 1 ? 's' : ''}`, since: last }
  }
  if (now - last <= DONE_WINDOW_MS) return { column: 'done', reason: prLabel(app) || 'your turn', since: last }
  return undefined
}

/** Where a session the app does not list goes (a terminal session): from its mod alone. */
function placeAlone(st: SessionStatus, now: number): Placement | undefined {
  if (st.state === 'ended') return undefined
  if (now - st.aliveAt > GONE_AFTER_MS) {
    return now - st.aliveAt <= DONE_WINDOW_MS ? { column: 'blocked', reason: 'no signal from the session', since: st.aliveAt } : undefined
  }
  if (st.state === 'needs_you') return { column: 'needs_you', reason: st.detail, since: st.stateSince }
  if (st.state === 'error') return { column: 'blocked', reason: st.detail || 'last turn failed', since: st.stateSince }
  if (st.state === 'running') return { column: 'wip', reason: st.detail || 'working', since: st.stateSince }
  return { column: 'done', reason: 'your turn', since: st.stateSince }
}

const ORDER: Record<Column, number> = { needs_you: 0, blocked: 1, wip: 2, done: 3 }

/** Every card, most urgent column first; the longest wait first among those that need you. */
export function buildCards(
  app: readonly AppSession[],
  statuses: readonly SessionStatus[],
  selfAppId: string,
  now: number,
  newestVersion = '',
): Card[] {
  const isOld = (st: SessionStatus | undefined) =>
    st !== undefined && newestVersion !== '' && now - st.aliveAt <= GONE_AFTER_MS && compareVersions(st.version, newestVersion) < 0
  const byApp = new Map<string, SessionStatus>()
  for (const st of statuses) {
    const seen = byApp.get(st.appId)
    if (st.appId !== '' && (!seen || seen.aliveAt < st.aliveAt)) byApp.set(st.appId, st)
  }
  const titleOf = new Map(app.map(a => [a.sessionId, a.title]))
  const runningKids = new Map<string, number>()
  for (const a of app) {
    if (a.startedBy && a.isRunning) runningKids.set(a.startedBy, (runningKids.get(a.startedBy) ?? 0) + 1)
  }

  const cards: Card[] = []
  for (const a of app) {
    const st = byApp.get(a.sessionId)
    const kids = runningKids.get(a.sessionId) ?? 0
    const at = place(a, st, kids, now)
    if (!at) continue
    cards.push({
      id: a.sessionId,
      title: a.title || st?.title || 'Untitled session',
      project: projectLabel(a.cwd),
      branch: a.branch ?? '',
      ...at,
      pr: prLabel(a),
      link: a.link ?? '',
      parentTitle: (a.startedBy && titleOf.get(a.startedBy)) || '',
      runningChildren: kids,
      background: st && now - st.aliveAt <= GONE_AFTER_MS ? st.background.length : 0,
      isSelf: a.sessionId === selfAppId,
      isOutdated: isOld(st),
    })
  }
  const listed = new Set(app.map(a => a.sessionId))
  for (const st of statuses) {
    if (st.appId !== '' && listed.has(st.appId)) continue
    const at = placeAlone(st, now)
    if (!at) continue
    cards.push({
      id: st.id,
      title: st.title || 'Untitled session',
      project: projectLabel(st.cwd),
      branch: '',
      ...at,
      pr: '',
      link: '',
      parentTitle: '',
      runningChildren: 0,
      background: st.background.length,
      isSelf: false,
      isOutdated: isOld(st),
    })
  }
  return cards.sort((x, y) => {
    const byColumn = ORDER[x.column] - ORDER[y.column]
    if (byColumn !== 0) return byColumn
    return x.column === 'needs_you' ? x.since - y.since : y.since - x.since
  })
}

/** Background work of every live session, with its session's title and app link. */
export function collectBackground(
  statuses: readonly SessionStatus[],
  app: readonly AppSession[],
  selfAppId: string,
  now: number,
): BackgroundRow[] {
  const byId = new Map(app.map(a => [a.sessionId, a]))
  return statuses
    .filter(st => st.state !== 'ended' && now - st.aliveAt <= GONE_AFTER_MS)
    .flatMap(st => {
      const a = st.appId !== '' ? byId.get(st.appId) : undefined
      const session = a?.title || st.title || projectLabel(st.cwd)
      const isSelf = st.appId !== '' && st.appId === selfAppId
      return st.background.map(b => ({ ...b, session, link: a?.link ?? '', isSelf }))
    })
}
