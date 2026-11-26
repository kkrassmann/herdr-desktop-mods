import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Explanation, StepStatus, TickerData, TickerStep } from '../types'

const PANE = 'ticker'
const TOOL = 'mcp__ticker__update'
const data = atom({ plugin: 'ticker', key: 'data' } as const, null)
const isOpen = atom({ plugin: 'ticker', key: 'isOpen' } as const, false)
// keyed by question text -> numbering may shift between ticks without losing state
const openQuestions = atom({ plugin: 'ticker', key: 'openQuestions' } as const, [])
const explanations = atom({ plugin: 'ticker', key: 'explanations' } as const, {})
// answered questions -> controls hidden until question leaves ticker (blocks double send)
const sentQuestions = atom({ plugin: 'ticker', key: 'sentQuestions' } as const, [])
// band list without done steps -> long tickers stay short
const hideDone = atom({ plugin: 'ticker', key: 'hideDone' } as const, false)
// sync guard: second press before state write lands -> ignored
const inFlight = new Set<string>()

const ICON: Record<StepStatus, string> = { done: '✅', active: '🔄', todo: '⬜' }
const STEP_BAR = 10
// band bars kept short -> line does not wrap on narrow terminals
const BAND_TOTAL_BAR = 8
const BAND_STEP_BAR = 5
const MIN_STEPS = 3
const STALE_MS = 15 * 60 * 1000

// standing rule -> ticker shows up for multi-step work without /ticker skill
const PROMPT_SECTION = {
  id: 'ticker:auto',
  scope: 'session',
  text:
    `Live ticker: when a task needs ${MIN_STEPS} or more distinct steps, call \`${TOOL}\` ` +
    'once you have planned the steps, and again whenever a step changes status or a step is added/removed. ' +
    'Keep step names stable (short fragments, max ~6 words), mark exactly the running step `active` with an ' +
    'honest percent, total = honestly weighted overall progress, list open questions (empty array if none); ' +
    'a NEW question as {text, context, options, recommendation} (one short German line each), a known one as plain string. ' +
    'After the last step, send one final update with every step `done` and total 100. ' +
    `Do not call it for tasks with fewer than ${MIN_STEPS} steps.`,
} as const
const AGE_REFRESH_MS = 60 * 1000

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string', description: 'What is built, 2-5 words' },
    description: { type: 'string', description: 'One line, why it exists / what is stuck' },
    steps: {
      type: 'array',
      description: '3-8 steps, stable names and order across ticks',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Fragment, max ~6 words' },
          status: { type: 'string', enum: ['done', 'active', 'todo'] },
          percent: { type: 'number', minimum: 0, maximum: 100, description: 'Only for active steps' },
        },
        required: ['name', 'status'],
      },
    },
    total: { type: 'number', minimum: 0, maximum: 100, description: 'Honestly weighted overall progress' },
    questions: {
      type: 'array',
      description:
        'Open questions, empty if none. NEW question -> object with context/options/recommendation ' +
        '(one short German line each) so the person can expand it without another model call; known question -> plain string.',
      items: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The question' },
              context: { type: 'string', description: 'What it is about, why still open' },
              options: { type: 'string', description: 'Options, separated by |' },
              recommendation: { type: 'string', description: 'Clear recommendation + short reason' },
            },
            required: ['text'],
          },
        ],
      },
    },
  },
  required: ['topic', 'steps', 'total'],
}

const clampPercent = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)))

const toStatus = (s: unknown): StepStatus => (s === 'done' || s === 'active' ? s : 'todo')

// percent only meaningful for active steps -> done/todo carry null
const toStep = (raw: Record<string, unknown>): TickerStep => {
  const status = toStatus(raw.status)
  return {
    name: String(raw.name ?? '').trim(),
    status,
    percent: status === 'active' ? clampPercent(raw.percent) : null,
  }
}

// question arrives as plain string or {text, context, options, recommendation}
const questionText = (q: unknown) =>
  String(typeof q === 'object' && q !== null ? (q as Record<string, unknown>).text ?? '' : q ?? '').trim()

const field = (o: Record<string, unknown>, key: string) => (typeof o[key] === 'string' ? (o[key] as string).trim() : '')

/** Explanations the model shipped with the tick, keyed by question text; questions without details skipped. */
export const parseQuestionDetails = (e: Record<string, unknown>): Record<string, Explanation> => {
  const details: Record<string, Explanation> = {}
  for (const q of Array.isArray(e.questions) ? e.questions : []) {
    if (typeof q !== 'object' || q === null) continue
    const o = q as Record<string, unknown>
    const text = field(o, 'text')
    const context = field(o, 'context')
    const options = field(o, 'options')
    const recommendation = field(o, 'recommendation')
    if (text === '' || (context === '' && options === '' && recommendation === '')) continue

    const lines = [
      context && `Worum: ${context}`,
      options && `Optionen: ${options}`,
      recommendation && `Empfehlung: ${recommendation}`,
    ].filter(Boolean)
    details[text] = { status: 'ready', text: lines.join('\n'), recommendation: recommendation || null }
  }
  return details
}

/** Builds ticker data from tool input; returns a reason string when input is unusable. */
export const parseInput = (e: Record<string, unknown>, now: number): TickerData | string => {
  const topic = typeof e.topic === 'string' ? e.topic.trim() : ''
  if (topic === '') return 'topic missing'
  if (!Array.isArray(e.steps)) return 'steps missing'

  const steps = e.steps.map(s => toStep((s ?? {}) as Record<string, unknown>)).filter(s => s.name !== '')
  if (steps.length < MIN_STEPS) return `fewer than ${MIN_STEPS} steps, no ticker needed`

  return {
    topic,
    description: typeof e.description === 'string' ? e.description.trim() : '',
    steps,
    total: clampPercent(e.total),
    questions: (Array.isArray(e.questions) ? e.questions : []).map(questionText).filter(q => q !== ''),
    updatedAt: now,
  }
}

/** Names of steps that became done since the previous tick. */
export const newlyDone = (prev: TickerData | null, next: TickerData): string[] => {
  const wasDone = new Set((prev?.steps ?? []).filter(s => s.status === 'done').map(s => s.name))
  return next.steps.filter(s => s.status === 'done' && !wasDone.has(s.name)).map(s => s.name)
}

/** True on first tick or when steps were added, removed, renamed or changed status; percent-only -> false. */
export const hasStepChange = (prev: TickerData | null, next: TickerData) => {
  if (prev === null || prev.steps.length !== next.steps.length) return true
  return next.steps.some((s, i) => s.name !== prev.steps[i]?.name || s.status !== prev.steps[i]?.status)
}

export const barParts =(percent: number, width: number) => {
  const filled = Math.round((percent / 100) * width)
  return { filled: '█'.repeat(filled), rest: '░'.repeat(width - filled) }
}

const barColor = (percent: number) => (percent >= 100 ? 'green' : percent >= 50 ? 'cyan' : 'yellow')

export const formatAge = (ms: number) => {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} min`
  return `vor ${Math.floor(minutes / 60)} h`
}

export const explainPrompt = (topic: string, question: string) =>
  `Offene Frage aus dem laufenden Ticker „${topic}“: „${question}“\n` +
  'Antworte auf Deutsch in genau drei Zeilen, je max. ~20 Wörter, ohne Einleitung:\n' +
  'Worum: <worum es geht, warum die Frage offen ist>\n' +
  'Optionen: <Optionen, mit | getrennt>\n' +
  'Empfehlung: <klare Empfehlung + Kurzgrund>'

/** Text after "Empfehlung:" in model reply, null when line missing. */
export const parseRecommendation = (text: string) => {
  const match = /^\s*Empfehlung:\s*(.+)$/m.exec(text)
  return match?.[1]?.trim() || null
}

export const answerPrompt = (n: number, question: string, answer: string) =>
  `Antwort auf offene Frage ${n} „${question}“: ${answer.trim()}`

export const acceptPrompt = (n: number, question: string, recommendation: string) =>
  `Offene Frage ${n} „${question}“: Empfehlung übernehmen – ${recommendation}`

const explain = async ($: EngineInterface, topic: string, question: string) => {
  const loading: Explanation = { status: 'loading', text: '', recommendation: null }
  await update($, explanations, map => ({ ...map, [question]: loading }))

  // fork over session transcript -> model knows context of question, prefix served from cache
  const res = await $.model.fork({ prompt: explainPrompt(topic, question) })
  const entry: Explanation = res.isAnswered
    ? { status: 'ready', text: res.text.trim(), recommendation: parseRecommendation(res.text) }
    : { status: 'error', text: res.reason, recommendation: null }
  await update($, explanations, map => ({ ...map, [question]: entry }))
}

const toggleQuestion = async ($: EngineInterface, topic: string, question: string) => {
  const wasOpen = (await read($, openQuestions)).includes(question)
  await update($, openQuestions, list => (wasOpen ? list.filter(q => q !== question) : [...list, question]))
  if (wasOpen) return

  // explain lazily once; failed attempt retried on next expand
  const known = (await read($, explanations))[question]
  if (known === undefined || known.status === 'error') {
    await explain($, topic, question)
  }
}

const sendAnswer = async ($: EngineInterface, text: string, question: string) => {
  // claim before first await -> concurrent second press sees the claim
  if (inFlight.has(question)) return
  inFlight.add(question)
  try {
    if ((await read($, sentQuestions)).includes(question)) return
    await update($, sentQuestions, list => [...list, question])
    await $.prompt.submit({ text, asUser: true })
    await update($, openQuestions, list => list.filter(q => q !== question))
  } finally {
    inFlight.delete(question)
  }
}

const openPane = ($: { ui: { open: (a: { id: string; title: string }) => Promise<unknown> } }) =>
  $.ui.open({ id: PANE, title: 'Ticker' })

// JSON label on the herdr terminal running this session, read by herdr mod agent-groups; empty value removes it. Outside herdr: no-op
const syncHerdrLabel = async ($: EngineInterface, d: TickerData | null) => {
  try {
    const terminal = await $.env.get('HC_TERMINAL_ID')
    if (!terminal) return
    await $.process.run(['hc', 'label', terminal, `ticker=${d ? JSON.stringify({ total: d.total, steps: d.steps }) : ''}`], { timeoutMs: 5000 })
  } catch (err) {
    $.ui.log(`ticker: herdr label failed: ${String(err)}`, { to: 'debug' })
  }
}

// ticker + question state gone, herdr label removed; band toggles (isOpen, hideDone) are preferences and stay
const clearTicker = async ($: EngineInterface) => {
  await update($, data, () => null)
  await update($, openQuestions, () => [])
  await update($, sentQuestions, () => [])
  await update($, explanations, () => ({}))
  void syncHerdrLabel($, null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'update',
      description:
        'Updates the live ticker pane/band with the current /ticker block (topic, steps, total, open questions). ' +
        'Call on every ticker tick, in addition to printing the block.',
      inputSchema: INPUT_SCHEMA,
    })
    await $.command.register({ name: 'ticker-view', description: 'Open the ticker detail pane' })
    await $.command.register({ name: 'ticker-clear', description: 'Clear the ticker band and pane' })

    // age label ("vor 3 min") + stale warning need periodic redraw
    $.clock.every(AGE_REFRESH_MS, () => $.ui.invalidate('ui.render'))

    // new session on a reused terminal -> drop old label; reload -> restore from kept state
    void syncHerdrLabel($, await read($, data))

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, PROMPT_SECTION] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parseInput(e as unknown as Record<string, unknown>, await $.clock.now())
    if (typeof parsed === 'string') {
      return { deny: `ticker: ${parsed}` }
    }

    const prev = await read($, data)
    await update($, data, () => parsed)
    void syncHerdrLabel($, parsed)

    // question gone from ticker -> drop its sent mark, text may return as new question later
    await update($, sentQuestions, list => list.filter(q => parsed.questions.includes(q)))

    // shipped explanations win over cache -> expand shows them without fork
    const details = parseQuestionDetails(e as unknown as Record<string, unknown>)
    if (Object.keys(details).length > 0) {
      await update($, explanations, map => ({ ...map, ...details }))
    }

    for (const name of newlyDone(prev, parsed)) {
      $.ui.toast(`✅ ${name}`)
    }
    // steps changed -> surface pane so person sees what happens (seats unasked only on wide terminals)
    if (hasStepChange(prev, parsed)) {
      void openPane($)
    }

    return { result: `Ticker updated: ${parsed.topic} ${parsed.total}%` }
  })

  on('command.run', { command: 'ticker-view' }, async $ => {
    await openPane($)
    return { text: 'Ticker pane opened.' }
  })

  on('command.run', { command: 'ticker-clear' }, async $ => {
    await clearTicker($)
    return { text: 'Ticker cleared.' }
  })

  // /clear starts a new conversation without session.start -> old ticker would stay until the next tick
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await clearTicker($)
    }
    return next(e)
  })

  // compact one-liner above the prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ticker = await read($, data)
    if (ticker === null || e.props.hasSurvey) {
      return next(e)
    }
    // Other mods share this slot: draw theirs below ours instead of replacing it.
    const below = await next(e).catch(() => undefined)

    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // mobile has no Input -> explanation + accept button only
    const Input = 'Input' in elements ? elements.Input : null
    const open = await read($, isOpen)
    const openList = await read($, openQuestions)
    const explained = await read($, explanations)
    const sentList = await read($, sentQuestions)
    const isHidingDone = await read($, hideDone)
    const active = ticker.steps.find(s => s.status === 'active')
    const doneCount = ticker.steps.filter(s => s.status === 'done').length
    const isAllDone = doneCount === ticker.steps.length
    const steps = isHidingDone ? ticker.steps.filter(s => s.status !== 'done') : ticker.steps
    const total = barParts(ticker.total, BAND_TOTAL_BAR)
    const questionCount = ticker.questions.length

    // header: toggle, done/total, bar, current step (truncates first), question count
    const header = (
      <Box flexDirection="row" gap={1}>
        <Button
          key="toggle"
          label={open ? '▾' : '▸'}
          plain
          hotkey="t"
          onPress={() => update($, isOpen, v => !v)}
        />
        <Text bold color={isAllDone ? 'green' : 'cyan'}>{doneCount}/{ticker.steps.length}</Text>
        <Box flexDirection="row" flexShrink={0}>
          <Text color={barColor(ticker.total)}>{total.filled}</Text>
          <Text dimColor>{total.rest}</Text>
        </Box>
        <Text bold>{ticker.total}%</Text>
        {active && <Text dimColor>·</Text>}
        {active && (
          <Box flexShrink={1}>
            <Text wrap="truncate-end">{ICON.active} {active.name}</Text>
          </Box>
        )}
        {questionCount > 0 && <Text color="magenta">❓{questionCount}</Text>}
      </Box>
    )

    if (!open) {
      return below ? <Box flexDirection="column">{header}{below}</Box> : header
    }

    // name column as wide as longest name, capped -> right column stays aligned
    const nameWidth = Math.min(
      Math.max(0, ...steps.map(s => s.name.length)),
      Math.max(10, (e.props.bodyColumns ?? 80) - 22),
    )

    return (
      <Box flexDirection="column">
        {header}
        {steps.map((step, i) => {
          const bar = barParts(step.percent ?? 0, BAND_STEP_BAR)
          return (
            <Box key={`band-step-${i}`} flexDirection="row" gap={1} paddingLeft={2}>
              <Box width={nameWidth} flexShrink={0}>
                <Text wrap="truncate-end" dimColor={step.status === 'todo'} bold={step.status === 'active'}>
                  {step.name}
                </Text>
              </Box>
              {step.status === 'done' && <Text>✅</Text>}
              {step.status === 'todo' && <Text dimColor>⏳</Text>}
              {step.status === 'active' && (
                <Box flexDirection="row" gap={1}>
                  <Box flexDirection="row">
                    <Text color={barColor(step.percent ?? 0)}>{bar.filled}</Text>
                    <Text dimColor>{bar.rest}</Text>
                  </Box>
                  <Text>{String(step.percent).padStart(3)}%</Text>
                  {questionCount > 0 && <Text color="magenta">❓{questionCount}</Text>}
                </Box>
              )}
            </Box>
          )
        })}
        {ticker.questions.map((q, i) => {
          const n = i + 1
          const isQuestionOpen = openList.includes(q)
          const ex = explained[q]
          const isSent = sentList.includes(q)
          return (
            <Box key={`band-q-${i}`} flexDirection="column" paddingLeft={2}>
              <Button
                key={`q-${i}`}
                plain
                label={`${isQuestionOpen ? '▾' : '▸'} ${n}: ${q}${isSent ? '  ✓ gesendet' : ''}`}
                onPress={() => toggleQuestion($, ticker.topic, q)}
              />
              {isQuestionOpen && (
                <Box flexDirection="column" paddingLeft={4}>
                  {(ex === undefined || ex.status === 'loading') && <Text dimColor italic>… erkläre</Text>}
                  {ex?.status === 'error' && (
                    <Text color="red">Erklärung fehlgeschlagen ({ex.text}), zu- und aufklappen für neuen Versuch</Text>
                  )}
                  {ex?.status === 'ready' &&
                    ex.text
                      .split('\n')
                      .filter(line => line.trim() !== '')
                      .map(line => <Text dimColor>{line.trim()}</Text>)}
                  {isSent && <Text color="green">✓ Antwort gesendet</Text>}
                  {!isSent && ex?.status === 'ready' && ex.recommendation !== null && (
                    <Button
                      key={`accept-${i}`}
                      label="Empfehlung übernehmen"
                      variant="primary"
                      onPress={() => sendAnswer($, acceptPrompt(n, q, ex.recommendation ?? ''), q)}
                    />
                  )}
                  {!isSent && Input && (
                    <Input
                      key={`answer-${i}`}
                      placeholder="Antwort…"
                      onSubmit={value => (value.trim() === '' ? undefined : void sendAnswer($, answerPrompt(n, q, value), q))}
                    />
                  )}
                </Box>
              )}
            </Box>
          )
        })}
        {doneCount > 0 && (
          <Box flexDirection="column" paddingLeft={2}>
            {/* separator: list above, band functions below */}
            <Text dimColor>{'─'.repeat(Math.max(10, (e.props.bodyColumns ?? 80) - 2))}</Text>
            <Button
              key="hide-done"
              label={isHidingDone ? 'erledigt einblenden' : 'erledigt ausblenden'}
              onPress={() => update($, hideDone, v => !v)}
            />
          </Box>
        )}
        {below}
      </Box>
    )
  })

  // full ticker view
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const ticker = await read($, data)

    if (ticker === null) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>Noch kein Tick. /ticker starten.</Text>
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? 60
    const totalWidth = Math.max(10, Math.min(40, columns - 10))
    const total = barParts(ticker.total, totalWidth)
    const ageMs = (await $.clock.now()) - ticker.updatedAt
    const isStale = ageMs > STALE_MS

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        {/* header: topic, why, freshness */}
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color="cyan" wrap="truncate-end">{ticker.topic}</Text>
            <Text color={isStale ? 'red' : undefined} dimColor={!isStale}>
              {isStale ? '⚠ steht ' : ''}{formatAge(ageMs)}
            </Text>
          </Box>
          {ticker.description !== '' && <Text dimColor italic>{ticker.description}</Text>}
        </Box>

        {/* steps: icon left, progress right */}
        <Box flexDirection="column">
          {ticker.steps.map((step, i) => {
            const bar = step.percent === null ? null : barParts(step.percent, STEP_BAR)
            return (
              <Box key={`step-${i}`} flexDirection="row" gap={1}>
                <Text>{ICON[step.status]}</Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text
                    wrap="truncate-end"
                    dimColor={step.status === 'todo'}
                    bold={step.status === 'active'}
                  >
                    {step.name}
                  </Text>
                </Box>
                {step.status === 'done' && <Text color="green">✓</Text>}
                {bar && (
                  <Box flexDirection="row" gap={1}>
                    <Box flexDirection="row">
                      <Text color={barColor(step.percent ?? 0)}>{bar.filled}</Text>
                      <Text dimColor>{bar.rest}</Text>
                    </Box>
                    <Text>{String(step.percent).padStart(3)}%</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>

        {/* overall progress */}
        <Box flexDirection="row" gap={1} borderStyle="round" borderColor={barColor(ticker.total)} paddingX={1}>
          <Text bold>Gesamt</Text>
          <Box flexDirection="row">
            <Text color={barColor(ticker.total)}>{total.filled}</Text>
            <Text dimColor>{total.rest}</Text>
          </Box>
          <Text bold>{ticker.total}%</Text>
        </Box>

        {/* open questions, always shown */}
        <Box flexDirection="column">
          <Text bold color="magenta">Offene Fragen</Text>
          {ticker.questions.length === 0 && <Text dimColor>keine</Text>}
          {ticker.questions.map((q, i) => (
            <Box key={`q-${i}`} flexDirection="row" gap={1}>
              <Text color="magenta">{i + 1}:</Text>
              <Box flexShrink={1}>
                <Text>{q}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
