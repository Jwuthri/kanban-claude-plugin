import { expect, mock, test } from 'claude-code/testing'

import type { AppSession, Board, SessionStatus } from '../types'
import {
  GONE_AFTER_MS,
  STALL_AFTER_MS,
  buildCards,
  collectBackground,
  compareVersions,
  describeCall,
  formatAge,
  parseAppSessions,
  projectLabel,
} from './status'

const NOW = Date.parse('2026-11-23T06:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

function app(over: Partial<AppSession>): AppSession {
  return {
    sessionId: 'local_x',
    title: 'T',
    cwd: '/Users/me/Github/webshop',
    isRunning: false,
    lastActivityAt: iso(60_000),
    ...over,
  }
}

function status(over: Partial<SessionStatus>): SessionStatus {
  return {
    id: 'cli',
    appId: '',
    title: 't',
    cwd: '/Users/me/Github/app',
    state: 'idle',
    detail: '',
    stateSince: NOW - 1000,
    aliveAt: NOW - 1000,
    background: [],
    ...over,
  }
}

test('each session lands in the right column', () => {
  const cards = buildCards(
    [
      app({ sessionId: 'ask', title: 'train probe', isRunning: true }),
      app({ sessionId: 'stuck', isRunning: true, lastActivityAt: iso(STALL_AFTER_MS + 60_000) }),
      app({ sessionId: 'work', isRunning: true, lastActivityAt: iso(5_000) }),
      app({ sessionId: 'cto', isRunning: false }),
      app({ sessionId: 'kid', isRunning: true, startedBy: 'cto', lastActivityAt: iso(5_000) }),
      app({ sessionId: 'fin', prNumber: 3, prState: 'MERGED' }),
      app({ sessionId: 'old', lastActivityAt: iso(3 * 24 * 3600_000) }),
    ],
    [status({ appId: 'ask', state: 'needs_you', detail: 'approve Bash: sbatch run.sh' })],
    'work',
    NOW,
  )
  const where = Object.fromEntries(cards.map(c => [c.id, c.column]))
  expect(where).toEqual({ ask: 'needs_you', stuck: 'blocked', work: 'wip', cto: 'wip', kid: 'wip', fin: 'done' })
  expect(cards.find(c => c.id === 'cto')?.reason).toBe('waiting on 1 sub-session')
  expect(cards.find(c => c.id === 'fin')?.reason).toBe('PR #3 merged')
  expect(cards.find(c => c.id === 'kid')?.parentTitle).toBe('T')
  expect(cards.find(c => c.id === 'work')?.isSelf).toBe(true)
})

test('a session whose process went silent is blocked', () => {
  const [card] = buildCards(
    [app({ sessionId: 'a', isRunning: true, lastActivityAt: iso(1000) })],
    [status({ appId: 'a', state: 'running', aliveAt: NOW - GONE_AFTER_MS - 1 })],
    '',
    NOW,
  )
  expect(card?.column).toBe('blocked')
  expect(card?.reason).toBe('no signal from the session')
})

test('a terminal session the app does not list still shows', () => {
  const [card] = buildCards([], [status({ id: 'term', state: 'running', detail: 'Bash: pytest' })], '', NOW)
  expect(card?.column).toBe('wip')
  expect(card?.reason).toBe('Bash: pytest')
})

test('the app result parses from text blocks; background is gathered per live session', () => {
  const rows = parseAppSessions([{ type: 'text', text: JSON.stringify([app({ sessionId: 's1' }), { junk: 1 }]) }])
  expect(rows.map(r => r.sessionId)).toEqual(['s1'])
  expect(parseAppSessions('not json')).toEqual([])
  const bg = collectBackground(
    [
      status({ appId: 's1', title: 'live', background: [{ kind: 'agent', label: 'Explore: callers' }] }),
      status({ title: 'dead', aliveAt: NOW - GONE_AFTER_MS - 1, background: [{ kind: 'agent', label: 'x' }] }),
    ],
    [app({ sessionId: 's1', title: 'Planner', link: 'claude://claude.ai/epitaxy/s1' })],
    '',
    NOW,
  )
  // The app's title names the session, and its link opens it.
  expect(bg).toEqual([
    { kind: 'agent', label: 'Explore: callers', session: 'Planner', link: 'claude://claude.ai/epitaxy/s1', isSelf: false },
  ])
})

test('labels are short and say what they mean', () => {
  expect(describeCall('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Bash: Run tests')
  expect(describeCall('mcp__github__create_pull_request', {})).toBe('create_pull_request')
  expect(formatAge(42_000)).toBe('42s')
  expect(formatAge(3_900_000)).toBe('1h05')
  expect(projectLabel('/Users/me/Github/webshop/.claude/worktrees/eng-x')).toBe('webshop')
  expect(projectLabel('/a/scratch-workspaces/b/c')).toBe('No folder')
})

const PANE = {
  plugin: 'mission-control',
  component: 'Pane',
  requestId: 'mission-control',
  props: {
    title: 'Mission Control',
    isFocused: false,
    bodyColumns: 200,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

test('the board shows each lane, filters by tab and lists background work, on every surface', async ($, on) => {
  const seeded: Board = {
    now: NOW,
    cards: buildCards(
      [
        app({ sessionId: 'a', title: 'refactor auth', isRunning: true, lastActivityAt: iso(1000) }),
        app({ sessionId: 'b', title: 'train probe', isRunning: true, lastActivityAt: iso(1000) }),
      ],
      [status({ appId: 'b', state: 'needs_you', detail: 'approve Bash: sbatch run.sh', stateSince: NOW - 240_000 })],
      '',
      NOW,
    ),
    backlog: [{ id: '1', text: 'write the eval report', createdAt: NOW }],
    background: [{ kind: 'shell', label: 'npm run dev', session: 'web app', link: 'claude://claude.ai/epitaxy/w', isSelf: false }],
  }
  on('state.get', (_, e, next) =>
    e.key === 'board' ? { value: { value: { shape: 'board-4', value: seeded }, version: 1 } } : next(e),
  )

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /sbatch/ }))?.text).toBe('⚠ approve Bash: sbatch run.sh')
    expect((await ui.find({ type: 'Text', text: /refactor auth/ }))?.text).toBe('refactor auth')
    expect((await ui.find({ type: 'Text', text: /eval report/ }))?.text).toBe('write the eval report')
    expect((await ui.find({ type: 'Text', text: /npm run dev/ }))?.text).toBe('$ npm run dev')
    expect(await ui.find({ key: 'bg-open-0' })).toBeDefined()

    await ui.press({ key: 'tab-needs_you' })
    expect(await ui.find({ type: 'Text', text: /^refactor auth$/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /train probe/ }))?.text).toBe('train probe')
    await ui.press({ key: 'tab-all' })
    await ui.unmount()
  }
})

test('a backlog item typed into the board is saved for every session', async ($, on) => {
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: NOW })
  const files = new Map<string, string>()
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 's1' }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ deny: 'not in the desktop app' }))
  on('command.register', () => ({ value: { command: 'mission' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/Users/me/code/app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'backlog-add-0', text: 'review PR #3' })
  // A second Enter on the same text right away adds nothing.
  await ui.input({ key: 'backlog-add-1', text: 'review PR #3' })
  await ui.input({ key: 'backlog-add-1', text: 'book GPU time' })

  const saved = JSON.parse(files.get('/home/me/.claude/mission-control/backlog.json') ?? '[]') as { text: string }[]
  expect(saved.map(i => i.text)).toEqual(['review PR #3', 'book GPU time'])
  await ui.unmount()
})

test('a turn writes this session as running, then error after an API failure', async ($, on) => {
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: NOW })
  const files = new Map<string, string>()
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 's1' }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ deny: 'not in the desktop app' }))
  on('command.register', () => ({ value: { command: 'mission' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  const path = '/home/me/.claude/mission-control/sessions/s1.json'
  const read = () => JSON.parse(files.get(path) ?? '{}') as SessionStatus

  await $.session.start({ cwd: '/Users/me/code/app', surface: 'desktop', isInteractive: true })
  expect(read().state).toBe('idle')

  await $.turn.start({ text: 'fix the flaky test', turnId: 't1' })
  expect(read().state).toBe('running')
  expect(read().title).toBe('fix the flaky test')

  await $.turn.complete({ reason: 'error', answer: '', durationMs: 5, isAborted: false, turnId: 't1' })
  expect(read().state).toBe('error')
})

test('Done shows the newest rows on the full board and all of them in its tab', async ($, on) => {
  const many = Array.from({ length: 12 }, (_, i) => app({ sessionId: `d${i}`, title: `finished ${i}`, lastActivityAt: iso((i + 1) * 60_000) }))
  const seeded: Board = { now: NOW, cards: buildCards(many, [], '', NOW), backlog: [], background: [] }
  on('state.get', (_, e, next) =>
    e.key === 'board' ? { value: { value: { shape: 'board-4', value: seeded }, version: 1 } } : next(e),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /finished 7$/ }))?.text).toBe('finished 7')
  expect(await ui.find({ type: 'Text', text: /finished 8$/ })).toBeUndefined()
  await ui.press({ key: 'done-more' })
  expect((await ui.find({ type: 'Text', text: /finished 11$/ }))?.text).toBe('finished 11')
  await ui.press({ key: 'tab-all' })
  await ui.unmount()
})

test('a narrow pane stacks the lanes, needs-you first; a wide one lays them side by side', async ($, on) => {
  const seeded: Board = {
    now: NOW,
    cards: buildCards(
      [app({ sessionId: 'b', title: 'train probe', isRunning: true, lastActivityAt: iso(1000) })],
      [status({ appId: 'b', state: 'needs_you', detail: 'approve Bash: sbatch run.sh' })],
      '',
      NOW,
    ),
    backlog: [],
    background: [{ kind: 'agent', label: 'Explore: callers', session: 'Planner', link: 'claude://x', isSelf: false }],
  }
  on('state.get', (_, e, next) =>
    e.key === 'board' ? { value: { value: { shape: 'board-4', value: seeded }, version: 1 } } : next(e),
  )
  for (const [bodyColumns, direction] of [
    [60, 'column'],
    [200, 'row'],
  ] as const) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'desktop' })
    expect((await ui.find({ key: 'lanes' }))?.props.flexDirection).toBe(direction)
    // Background is a lane of its own, with its own tab.
    expect((await ui.find({ type: 'Text', text: /^Background$/ }))?.text).toBe('Background')
    expect(await ui.find({ key: 'tab-background' })).toBeDefined()
    await ui.unmount()
  }
})

test('versions compare by number, and a session on older code is tagged', () => {
  expect(compareVersions('0.2.10', '0.2.9')).toBeGreaterThan(0)
  expect(compareVersions(undefined, '0.2.3')).toBeLessThan(0)
  expect(compareVersions('0.2.3', '0.2.3')).toBe(0)
  const cards = buildCards(
    [app({ sessionId: 'new', isRunning: true, lastActivityAt: iso(1000) }), app({ sessionId: 'old', isRunning: true, lastActivityAt: iso(1000) })],
    [status({ id: 'n', appId: 'new', state: 'running', version: '0.2.3' }), status({ id: 'o', appId: 'old', state: 'running' })],
    '',
    NOW,
    '0.2.3',
  )
  expect(Object.fromEntries(cards.map(c => [c.id, c.isOutdated]))).toEqual({ new: false, old: true })
})

test('an idle session reloads plugins once a newer version is installed', async ($, on) => {
  mock.env(on, { HOME: '/home/me' })
  const clock = mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  let installed = '0.2.3'
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ version: installed }) }
    throw new Error('missing')
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 's1' }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ deny: 'not in the desktop app' }))
  on('command.register', () => ({ value: { command: 'mission' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const reloads: string[] = []
  on('command.run', { command: 'reload-plugins' }, (_, e) => {
    reloads.push(e.command)
    return { text: 'reloaded' }
  })

  await $.session.start({ cwd: '/Users/me/code/app', surface: 'desktop', isInteractive: true })
  await clock.advance(5000)
  expect(reloads).toEqual([])

  installed = '0.2.4'
  // The board refreshes every 5 s.
  await clock.advance(5000)
  await clock.advance(5000)
  // One reload per loaded version, however often the board refreshes.
  expect(reloads).toEqual(['reload-plugins'])
})
