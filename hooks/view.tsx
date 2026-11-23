import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RenderElement,
  RenderNode,
  SvgProps,
  TextProps,
} from 'claude-code'

import type { BacklogItem, Board, Card, Column, Filter } from '../types'
import { formatAge } from './status'

/** The elements the board draws with; `Svg` only where the surface has it. */
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input: ElementConstructor<InputProps>
  Svg?: ElementConstructor<SvgProps>
}

export type Actions = {
  setFilter: (f: Filter) => void
  addBacklog: (text: string) => void
  removeBacklog: (id: string) => void
  openSession: (link: string) => void
}

type Lane = 'backlog' | 'background' | Column

const LANES: { lane: Lane; title: string }[] = [
  { lane: 'backlog', title: 'Backlog' },
  { lane: 'needs_you', title: 'Needs you' },
  { lane: 'wip', title: 'WIP' },
  { lane: 'blocked', title: 'Blocked' },
  { lane: 'done', title: 'Done' },
  { lane: 'background', title: 'Background' },
]

const THEME: Record<Lane, string> = {
  backlog: 'inactive',
  background: 'claude',
  needs_you: 'error',
  wip: 'claude',
  blocked: 'warning',
  done: 'success',
}

const HEX: Record<Lane, string> = {
  backlog: '#8B8D98',
  background: '#7D6BC7',
  needs_you: '#E5484D',
  wip: '#D97757',
  blocked: '#F5A524',
  done: '#30A46C',
}

const GLYPH: Record<Lane, string> = { background: '◆', backlog: '○', needs_you: '●', wip: '◐', blocked: '▲', done: '✓' }

const BG_GLYPH: Record<string, string> = { agent: '◆', shell: '$', monitor: '◉', workflow: '⇄', scheduled: '⏰' }

function iconSvg(lane: Lane): string {
  const c = HEX[lane]
  const open = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">'
  switch (lane) {
    case 'needs_you':
      return `${open}<circle cx="7" cy="7" r="6" fill="${c}" opacity="0.25"><animate attributeName="r" values="4;6.5;4" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="7" cy="7" r="3.5" fill="${c}"/></svg>`
    case 'wip':
      return `${open}<circle cx="7" cy="7" r="5" fill="none" stroke="${c}" stroke-opacity="0.25" stroke-width="2"/><path d="M7 2a5 5 0 0 1 5 5" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="1s" repeatCount="indefinite"/></path></svg>`
    case 'blocked':
      return `${open}<path d="M7 1.5l6 10.5H1z" fill="${c}"/><rect x="6.3" y="5" width="1.4" height="3.6" rx=".7" fill="#fff"/><circle cx="7" cy="10.2" r=".8" fill="#fff"/></svg>`
    case 'done':
      return `${open}<circle cx="7" cy="7" r="6" fill="${c}"/><path d="M4.2 7.2l1.9 1.9 3.7-3.9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    case 'background':
      return `${open}<rect x="2" y="3" width="10" height="2" rx="1" fill="${c}"/><rect x="2" y="6" width="7" height="2" rx="1" fill="${c}" opacity=".7"><animate attributeName="width" values="4;10;4" dur="1.8s" repeatCount="indefinite"/></rect><rect x="2" y="9" width="5" height="2" rx="1" fill="${c}" opacity=".45"/></svg>`
    case 'backlog':
      return `${open}<circle cx="7" cy="7" r="5" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="2.5 2"/></svg>`
  }
}

function Icon(kit: Kit, lane: Lane): RenderNode {
  const { Svg, Text } = kit
  if (Svg) return <Svg source={iconSvg(lane)} alt={lane} width={14} height={14} />
  return <Text color={THEME[lane]}>{GLYPH[lane]}</Text>
}

/** The reason line, worded for the column it explains. */
function reasonLine(c: Card): string {
  if (c.column === 'needs_you') {
    if (c.reason.startsWith('AskUserQuestion: ')) return `? ${c.reason.slice('AskUserQuestion: '.length)}`
    if (c.reason.startsWith('ExitPlanMode')) return '✎ Plan ready for your approval'
    return `⚠ ${c.reason}`
  }
  if (c.column === 'blocked') return `▲ ${c.reason}`
  return c.reason
}

function CardView(kit: Kit, c: Card, now: number, actions: Actions): RenderNode {
  const { Box, Text, Button } = kit
  const meta = [
    formatAge(now - c.since),
    c.pr,
    c.runningChildren > 0 ? `↳ ${c.runningChildren} running` : '',
    c.background > 0 ? `${c.background} bg` : '',
    c.isSelf ? 'this session' : '',
    c.isOutdated ? 'old mod version' : '',
  ].filter(Boolean)
  const where = [c.project, c.branch.replace(/^claude\//, '')].filter(Boolean).join(' · ')
  const isLoud = c.column === 'needs_you' || c.column === 'blocked'
  return (
    <Box key={c.id} flexDirection="column" borderStyle="round" borderColor={THEME[c.column]} paddingX={1}>
      <Text weight="semibold" wrap="truncate-end">
        {c.title}
      </Text>
      <Text dimColor size="caption" wrap="truncate-end">
        {where}
        {c.parentTitle !== '' ? ` · from ${c.parentTitle}` : ''}
      </Text>
      {c.reason !== '' && (
        <Text color={isLoud ? THEME[c.column] : undefined} dimColor={!isLoud} size="caption" wrap="wrap">
          {reasonLine(c)}
        </Text>
      )}
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text dimColor size="caption" tabular wrap="truncate-end">
          {meta.join(' · ')}
        </Text>
        {c.link !== '' && !c.isSelf && (
          <Button key={`open-${c.id}`} label="Open ↗" plain dimColor onPress={() => actions.openSession(c.link)} />
        )}
      </Box>
    </Box>
  )
}

function BacklogView(kit: Kit, items: readonly BacklogItem[], actions: Actions): RenderNode {
  const { Box, Text, Button, Input } = kit
  return (
    <Box flexDirection="column" gap={1}>
      <Input
        key={`backlog-add-${items.length}`}
        placeholder="Add a to-do"
        submitLabel="add"
        onSubmit={text => actions.addBacklog(text)}
      />
      {items.map(item => (
        <Box
          key={`item-${item.id}`}
          flexDirection="row"
          justifyContent="space-between"
          gap={1}
          borderStyle="round"
          borderColor="inactive"
          paddingX={1}
        >
          <Text wrap="wrap">{item.text}</Text>
          <Button key={`done-${item.id}`} label="✓" plain dimColor onPress={() => actions.removeBacklog(item.id)} />
        </Box>
      ))}
    </Box>
  )
}

/** From this many cells across, the six lanes sit side by side; below it they stack. */
export const WIDE_COLUMNS = 160

/** How the board is laid out: lanes side by side, stacked on the full board, or one lane (a tab). */
type Layout = 'columns' | 'stacked' | 'single'

/** On the full board, Done shows this many rows; its tab shows them all. */
const DONE_PREVIEW: Record<Layout, number> = { columns: 8, stacked: 5, single: Infinity }

/** Stacked lanes put what needs attention first. */
const STACK_ORDER: Lane[] = ['needs_you', 'blocked', 'wip', 'background', 'backlog', 'done']

/** Done as one-line rows: title, then project and age; the newest first. */
function DoneList(kit: Kit, cards: readonly Card[], now: number, actions: Actions, layout: Layout): RenderNode {
  const { Box, Text, Button } = kit
  const shown = cards.slice(0, DONE_PREVIEW[layout])
  return (
    <Box flexDirection="column" gap={0}>
      {shown.map(c => (
        <Box key={c.id} flexDirection="column" paddingY={0}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text wrap="truncate-end">{c.title}</Text>
            {c.link !== '' && !c.isSelf && (
              <Button key={`open-${c.id}`} label="↗" plain dimColor onPress={() => actions.openSession(c.link)} />
            )}
          </Box>
          <Text dimColor size="caption" wrap="truncate-end">
            {[c.project, formatAge(now - c.since), c.pr].filter(Boolean).join(' · ')}
          </Text>
        </Box>
      ))}
      {shown.length < cards.length && (
        <Button
          key="done-more"
          label={`Show all ${cards.length}`}
          plain
          dimColor
          onPress={() => actions.setFilter('done')}
        />
      )}
    </Box>
  )
}

function isSessionLane(lane: Lane): lane is Column {
  return lane !== 'backlog' && lane !== 'background'
}

function laneCount(b: Board, lane: Lane): number {
  if (lane === 'backlog') return b.backlog.length
  if (lane === 'background') return b.background.length
  return b.cards.filter(c => c.column === lane).length
}

function LaneView(kit: Kit, b: Board, lane: Lane, title: string, actions: Actions, layout: Layout): RenderNode {
  const { Box, Text } = kit
  const cards = isSessionLane(lane) ? b.cards.filter(c => c.column === lane) : []
  const count = laneCount(b, lane)
  const empty = lane === 'needs_you' ? 'Nothing waits on you' : lane === 'background' ? 'Nothing in the background' : 'Empty'
  return (
    <Box
      key={`lane-${lane}`}
      flexDirection="column"
      gap={1}
      flexGrow={1}
      flexShrink={1}
      width={layout === 'columns' ? '15%' : undefined}
    >
      <Box flexDirection="row" gap={1} alignItems="center">
        {Icon(kit, lane)}
        <Text weight="bold" color={THEME[lane]}>
          {title}
        </Text>
        <Text dimColor tabular>
          {count}
        </Text>
      </Box>
      {lane === 'backlog' && BacklogView(kit, b.backlog, actions)}
      {lane !== 'backlog' && count === 0 && layout !== 'stacked' && (
        <Text dimColor size="caption">
          {empty}
        </Text>
      )}
      {lane === 'background' && BackgroundList(kit, b, actions)}
      {lane === 'done'
        ? DoneList(kit, cards, b.now, actions, layout)
        : cards.map(c => CardView(kit, c, b.now, actions))}
    </Box>
  )
}

/** Background work as rows: what runs, the session that owns it, and Open. */
function BackgroundList(kit: Kit, b: Board, actions: Actions): RenderNode {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="column" gap={1}>
      {b.background.map((item, i) => (
        <Box key={`bg-${i}`} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
          <Text wrap="wrap">
            {BG_GLYPH[item.kind] ?? '•'} {item.label}
          </Text>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text dimColor size="caption" wrap="truncate-end">
              {item.session}
            </Text>
            {item.link !== '' && !item.isSelf && (
              <Button key={`bg-open-${i}`} label="Open ↗" plain dimColor onPress={() => actions.openSession(item.link)} />
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** The whole board: filter chips, then six lanes: side by side when wide, stacked when narrow. */
export function drawBoard(kit: Kit, b: Board, filter: Filter, actions: Actions, columns: number): RenderElement {
  const { Box, Button } = kit
  const count = (lane: Lane) => laneCount(b, lane)
  const isNarrow = columns < WIDE_COLUMNS
  const layout: Layout = filter !== 'all' ? 'single' : isNarrow ? 'stacked' : 'columns'
  const titleOf = (lane: Lane) => LANES.find(l => l.lane === lane)?.title ?? lane
  const shown =
    layout === 'single'
      ? LANES.filter(l => l.lane === filter)
      : layout === 'stacked'
        ? STACK_ORDER.map(lane => ({ lane, title: titleOf(lane) }))
        : LANES

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button
          key="tab-all"
          label={`All ${b.cards.length}`}
          variant={filter === 'all' ? 'primary' : 'secondary'}
          dimColor={filter !== 'all'}
          onPress={() => actions.setFilter('all')}
        />
        {LANES.map(l => (
          <Button
            key={`tab-${l.lane}`}
            label={`${l.title} ${count(l.lane)}`}
            variant={filter === l.lane ? 'primary' : 'secondary'}
            dimColor={filter !== l.lane}
            onPress={() => actions.setFilter(l.lane)}
          />
        ))}
      </Box>
      <Box
        key="lanes"
        flexDirection={layout === 'columns' ? 'row' : 'column'}
        gap={layout === 'columns' ? 2 : 1}
        alignItems={layout === 'columns' ? 'flex-start' : 'stretch'}
      >
        {shown.map(l => LaneView(kit, b, l.lane, l.title, actions, layout))}
      </Box>
    </Box>
  )
}
