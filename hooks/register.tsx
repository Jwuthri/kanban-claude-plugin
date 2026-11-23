import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AppSession, BacklogItem, Filter, SessionState, SessionStatus } from '../types'
import {
  PERSON_TOOLS,
  buildCards,
  collectBackground,
  compareVersions,
  cut,
  describeCall,
  parseAppSessions,
  projectLabel,
} from './status'
import { drawBoard } from './view'
import type { Kit } from './view'

const PANE = 'mission-control'
const TITLE = 'Mission Control'
const POLL_MS = 5000
const HEARTBEAT_MS = 30_000
/**
 * An ask still open after this went to a person: auto mode's classifier settles most within it.
 * Mods cannot hook the classifier (`tool.judge`) or the approval (`tool.run`), so a timer it is.
 */
const ASK_SETTLE_MS = 5000
const APP_LIST_LIMIT = 40
const DOUBLE_ADD_MS = 2000

const board = atom(
  { plugin: 'mission-control', key: 'board' } as const,
  { now: 0, cards: [], backlog: [], background: [] },
  { shape: 'board-4' },
)
const filter = atom({ plugin: 'mission-control', key: 'filter' } as const, 'all' as Filter)

// This session's own status. Module state: a reload starts it over, and
// session.start runs again then.
const self: SessionStatus = {
  id: '',
  appId: '',
  title: '',
  cwd: '',
  state: 'idle',
  detail: '',
  stateSince: 0,
  aliveAt: 0,
  background: [],
}
/** This session as the desktop app lists it; undefined outside the app. */
let selfApp: AppSession | undefined
let root = ''
/** The version of this mod the session loaded, and whether it has asked for a reload to a newer one. */
let loadedVersion = ''
let isReloadAsked = false
let isTurnRunning = false
let currentCall = ''
let lastTurnError = ''
/** Asks put to the person and not yet answered: tool_use_id -> label. */
const waiting = new Map<string, string>()
/** Asks that auto mode's classifier may still settle within ASK_SETTLE_MS. */
const settling = new Set<string>()
let writes: Promise<void> = Promise.resolve()

const sessionsDir = () => `${root}/sessions`
const backlogFile = () => `${root}/backlog.json`

function save($: EngineInterface): Promise<void> {
  const snapshot = JSON.stringify(self)
  const path = `${sessionsDir()}/${self.id}.json`
  writes = writes.then(() => $.fs.write(path, snapshot)).catch(() => undefined)
  return writes
}

/** Recomputes this session's state and writes it; never throws, so a hook stays harmless. */
async function refresh($: EngineInterface): Promise<void> {
  try {
    await recompute($)
  } catch {
    // Reporting is best effort: a failed write shows up as a stale card, never as a broken call.
  }
}

async function recompute($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const id = await $.session.id()
  if (id !== self.id) {
    // A /clear goes on under a new session id in the same process.
    self.id = id
    self.title = ''
    self.stateSince = now
  }
  let state: SessionState
  let detail = ''
  const firstWait = [...waiting.values()][0]
  if (self.state === 'ended') {
    state = 'ended'
  } else if (firstWait !== undefined) {
    state = 'needs_you'
    detail = firstWait
  } else if (isTurnRunning) {
    state = 'running'
    detail = currentCall
  } else if (lastTurnError !== '') {
    state = 'error'
    detail = lastTurnError
  } else {
    state = 'idle'
  }
  if (state !== self.state) self.stateSince = now
  self.state = state
  self.detail = detail
  self.aliveAt = now
  const agents = (await $.agent.list())
    .filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
    .map(a => ({ kind: 'agent', label: cut(`${a.type}: ${a.description}`, 90) }))
  self.background = agents
  await save($)
}

/** Looks up this session's own row in the desktop app, once. */
async function findSelfInApp($: EngineInterface): Promise<void> {
  const ran = await $.tool.call({ tool: 'mcp__ccd_session_mgmt__get_session', session_id: 'self' }).catch(() => undefined)
  if (!ran || ran.deny !== undefined || ran.isError) return
  selfApp = parseAppSessions(ran.result)[0]
  if (selfApp) self.appId = selfApp.sessionId
}

async function listAppSessions($: EngineInterface): Promise<AppSession[]> {
  const ran = await $.tool
    .call({ tool: 'mcp__ccd_session_mgmt__list_sessions', limit: APP_LIST_LIMIT })
    .catch(() => undefined)
  if (!ran || ran.deny !== undefined || ran.isError) return []
  return parseAppSessions(ran.result)
}

async function readBacklog($: EngineInterface): Promise<BacklogItem[]> {
  try {
    const items: unknown = JSON.parse(await $.fs.read(backlogFile()))
    return Array.isArray(items) ? (items as BacklogItem[]) : []
  } catch {
    return []
  }
}

async function addBacklog($: EngineInterface, text: string): Promise<void> {
  const clean = cut(text, 200)
  if (clean === '') return
  const now = await $.clock.now()
  const items = await readBacklog($)
  const last = items.at(-1)
  // A double Enter or Enter then Add sends the same text twice in a row.
  if (last && last.text === clean && now - last.createdAt < DOUBLE_ADD_MS) return
  items.push({ id: `${now}-${items.length}`, text: clean, createdAt: now })
  await $.fs.write(backlogFile(), JSON.stringify(items))
  await poll($)
}

async function removeBacklog($: EngineInterface, id: string): Promise<void> {
  const items = (await readBacklog($)).filter(i => i.id !== id)
  await $.fs.write(backlogFile(), JSON.stringify(items))
  await poll($)
}

/** Reads the app's sessions, every mod's status and the backlog; hands the pane a fresh board. */
async function poll($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  // At session start the app's tools may not be connected yet: keep asking until it answers.
  if (self.appId === '') await findSelfInApp($)
  if (now - self.aliveAt > HEARTBEAT_MS) await refresh($)
  const entries = await $.fs.list(sessionsDir()).catch(() => [])
  const others = await Promise.all(
    entries
      .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.name !== `${self.id}.json`)
      .map(async f => {
        try {
          return JSON.parse(await $.fs.read(`${sessionsDir()}/${f.name}`)) as SessionStatus
        } catch {
          return undefined
        }
      }),
  )
  const statuses = [{ ...self }, ...others.filter((s): s is SessionStatus => s !== undefined && !!s.id)]
  const app = await listAppSessions($)
  if (selfApp) {
    // The app's list leaves out the session that asks; this one knows its own state best.
    const busy = self.state === 'running' || self.state === 'needs_you'
    app.unshift({ ...selfApp, isRunning: busy, lastActivityAt: new Date(self.aliveAt).toISOString() })
  }
  const backlog = await readBacklog($)
  const installed = await readVersion($)
  await reloadIfOutdated($, installed)
  const newest = statuses.reduce((v, st) => (compareVersions(st.version, v) > 0 ? (st.version ?? v) : v), installed)
  await update($, board, () => ({
    now,
    cards: buildCards(app, statuses, self.appId, now, newest),
    backlog,
    background: collectBackground(statuses, app, self.appId, now),
  }))
}

/** Opens a session in the desktop app through its claude:// link; the pane itself only follows https links. */
async function openSession($: EngineInterface, link: string): Promise<void> {
  if (!link.startsWith('claude://')) return
  const ran = await $.process.run(['open', link]).catch(() => undefined)
  if (!ran || ran.exitCode !== 0) $.ui.toast('Could not open that session; open it from the sidebar.')
}

/** After ASK_SETTLE_MS, an ask nobody settled is the person's. */
function armSettle($: EngineInterface, id: string, label: string): void {
  $.clock.after(ASK_SETTLE_MS, () => {
    if (!settling.has(id)) return
    settling.delete(id)
    waiting.set(id, label)
    void refresh($)
    void ping($, label)
  })
}

/** The version in the installed manifest: the code a reload would load. */
async function readVersion($: EngineInterface): Promise<string> {
  try {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
}

/** Once the session is idle, reloads plugins when a newer version of this mod is installed. */
async function reloadIfOutdated($: EngineInterface, installed: string): Promise<void> {
  const isIdle = !isTurnRunning && waiting.size === 0
  if (isReloadAsked || !isIdle || loadedVersion === '' || compareVersions(installed, loadedVersion) <= 0) return
  isReloadAsked = true
  $.ui.toast(`Mission Control ${installed} is installed; reloading plugins.`)
  // A refused reload leaves the flag set: one try per loaded version, never a loop.
  await $.command.run({ command: 'reload-plugins' }).catch(() => undefined)
}

async function ping($: EngineInterface, label: string): Promise<void> {
  $.ui.toast(`Needs you: ${label}`, { timeoutMs: 8000 })
  await $.ui
    .notify(`${self.title || projectLabel(self.cwd)}: ${label}`, { title: 'Claude needs you' })
    .catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    root = `${home}/.claude/mission-control`
    loadedVersion = await readVersion($)
    self.version = loadedVersion
    self.cwd = e.cwd
    self.state = 'idle'
    await findSelfInApp($)
    await refresh($)
    await $.command.register({ name: 'mission', description: 'Open the Mission Control board' })
    await $.command.register({ name: 'todo', description: 'Add a to-do to the Mission Control backlog' })
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(POLL_MS, () => {
      void poll($).catch(() => undefined)
    })
    void poll($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'mission' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await poll($)
    return { text: 'Mission Control board opened.' }
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    if (e.args.trim() === '') return { text: 'Usage: /todo <what to do>' }
    await addBacklog($, e.args)
    return { text: `Added to the backlog: ${cut(e.args, 80)}` }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = true
      currentCall = ''
      lastTurnError = ''
      const text = e.text.trim()
      if (self.title === '' && text !== '' && !text.startsWith('<')) self.title = cut(text, 70)
      await refresh($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      isTurnRunning = false
      currentCall = ''
      lastTurnError =
        e.reason === 'error' ? 'last turn ended on an API error' : e.reason === 'refusal' ? 'last turn was refused' : ''
    }
    await refresh($)
    return done
  })

  on('tool.call', async ($, e, next) => {
    const label = describeCall(e.tool, e as unknown as Record<string, unknown>)
    const id = e.tool_use_id
    if (e.agentId === undefined) currentCall = label
    if (PERSON_TOOLS.has(e.tool)) {
      waiting.set(id, label)
      await refresh($)
      void ping($, label)
    } else if (e.agentId === undefined) {
      await refresh($)
    }
    try {
      return await next(e)
    } finally {
      // The call is over: answered, refused or run. Whatever it waited on is done.
      waiting.delete(id)
      settling.delete(id)
      if (e.agentId === undefined && currentCall === label) currentCall = ''
      await refresh($)
    }
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'ask' && id !== undefined && e.approver === 'person' && !PERSON_TOOLS.has(e.tool)) {
      const label = `approve ${describeCall(e.tool, (e.input ?? {}) as Record<string, unknown>)}`
      settling.add(id)
      armSettle($, id, label)
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    waiting.clear()
    settling.clear()
    self.state = 'ended'
    await refresh($)
    await writes
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const kit: Kit = {
      Box: el.Box,
      Text: el.Text,
      Button: el.Button,
      Input: el.Input,
      Svg: 'Svg' in el ? el.Svg : undefined,
    }
    const current = await read($, board)
    const chosen = await read($, filter)
    return drawBoard(kit, current, chosen, {
      setFilter: f => void update($, filter, () => f),
      addBacklog: text => void addBacklog($, text).catch(() => undefined),
      removeBacklog: id => void removeBacklog($, id).catch(() => undefined),
      openSession: link => void openSession($, link),
    }, e.props.bodyColumns)
  })
}
