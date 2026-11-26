import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { barParts, formatAge, hasStepChange, newlyDone, parseInput, parseQuestionDetails, parseRecommendation } from './register'

const TOOL = 'mcp__ticker__update'

const TICK = {
  topic: 'Postgres-Support',
  description: 'Framework kann nur MySQL',
  steps: [
    { name: 'Treiber hinter Naht', status: 'done' },
    { name: 'uuid-Seeding', status: 'active', percent: 60 },
    { name: 'CI beide Dialekte', status: 'todo', percent: 99 },
  ],
  total: 60,
  questions: ['Eigenes Paket?'],
}

// engine stand-ins beneath the plugin: fixed clock, recorded toasts + pane opens
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const EXPLANATION = [
  'Worum: Treiber-Schnitt offen',
  'Optionen: eigenes Paket | optionale Dependency',
  'Empfehlung: eigenes Paket, haelt Kern schlank',
].join('\n')

const stubEngine = (on: On, forkReply: string | null = EXPLANATION) => {
  const toasts: string[] = []
  const opened: string[] = []
  const prompts: string[] = []
  const forks: string[] = []
  on('model.fork', (_$, e) => {
    forks.push(e.prompt)
    return {
      value: forkReply === null
        ? { isAnswered: false, reason: 'empty-reply', usage: USAGE }
        : { isAnswered: true, text: forkReply, usage: USAGE },
    }
  })
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return { toasts, opened, prompts, forks }
}

test('tool call toasts done steps, opens pane on first tick, not on percent-only update', async ($, on) => {
  const { toasts, opened } = stubEngine(on)

  const res = await $.tool.call({ tool: TOOL, ...TICK })
  expect(res.deny).toBe(undefined)
  expect(toasts).toEqual(['✅ Treiber hinter Naht'])

  await $.tool.call({ tool: TOOL, ...TICK, total: 70 })
  expect(opened).toEqual(['ticker'])
  expect(toasts).toEqual(['✅ Treiber hinter Naht'])
})

test('pane opens again when a step changes status', async ($, on) => {
  const { opened } = stubEngine(on)
  await $.tool.call({ tool: TOOL, ...TICK })
  await $.tool.call({
    tool: TOOL,
    ...TICK,
    steps: [
      { name: 'Treiber hinter Naht', status: 'done' },
      { name: 'uuid-Seeding', status: 'done' },
      { name: 'CI beide Dialekte', status: 'active', percent: 10 },
    ],
  })
  expect(opened).toEqual(['ticker', 'ticker'])
})

test('tool call with fewer than 3 steps is denied', async ($, on) => {
  stubEngine(on)
  const res = await $.tool.call({ tool: TOOL, ...TICK, steps: TICK.steps.slice(0, 2) })
  expect(res.deny).toBe('ticker: fewer than 3 steps, no ticker needed')
})

test('system prompt gets ticker rule appended', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  const res = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: { name: 'default', isKeepingCodingInstructions: true },
    traits: [],
  })
  expect(res.sections.map(sec => sec.id)).toEqual(['intro', 'ticker:auto'])
})

const PANE_PROPS = { title: 'Ticker', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const SEPARATOR = /^─+$/

const bandTexts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => !SEPARATOR.test(t))

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pane draws topic, steps, total + questions (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })

    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'Pane', requestId: 'ticker', props: PANE_PROPS })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

    expect(texts).toContain('Postgres-Support')
    expect(texts).toContain('Framework kann nur MySQL')
    expect(texts).toContain('uuid-Seeding')
    expect(texts).toContain(' 60%')
    expect(texts).toContain('Gesamt')
    expect(texts).toContain('Eigenes Paket?')
    expect(texts).not.toContain('keine')
  })

  test(`band collapsed: counter, total, current step, question count (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })

    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const texts = await bandTexts(ui)

    expect(texts).toEqual(['1/3', '█████', '░░░', '60%', '·', '🔄 uuid-Seeding', '❓1'])
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('▸')
  })

  test(`band expanded: all steps + questions after toggle (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })

    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    const texts = await bandTexts(ui)

    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('▾')
    expect(texts.slice(7)).toEqual([
      'Treiber hinter Naht', '✅',
      'uuid-Seeding', '███', '░░', ' 60%', '❓1',
      'CI beide Dialekte', '⏳',
    ])
    expect((await ui.find({ key: 'q-0' }))?.props.label).toBe('▸ 1: Eigenes Paket?')
  })

  test(`question expand: explains via fork, accept sends recommendation as prompt (${surface})`, async ($, on) => {
    const { prompts, forks } = stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })

    await ui.press({ key: 'q-0' })
    const texts = await bandTexts(ui)

    expect(forks).toHaveLength(1)
    expect((await ui.find({ key: 'q-0' }))?.props.label).toBe('▾ 1: Eigenes Paket?')
    expect(texts.slice(-3)).toEqual([
      'Worum: Treiber-Schnitt offen',
      'Optionen: eigenes Paket | optionale Dependency',
      'Empfehlung: eigenes Paket, haelt Kern schlank',
    ])

    await ui.press({ key: 'accept-0' })
    expect(prompts).toEqual(['Offene Frage 1 „Eigenes Paket?“: Empfehlung übernehmen – eigenes Paket, haelt Kern schlank'])
    expect((await ui.find({ key: 'q-0' }))?.props.label).toBe('▸ 1: Eigenes Paket?  ✓ gesendet')
  })

  test(`double click on accept sends once (${surface})`, async ($, on) => {
    const { prompts } = stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    await ui.press({ key: 'q-0' })

    await Promise.all([ui.press({ key: 'accept-0' }), ui.press({ key: 'accept-0' })])

    expect(prompts).toHaveLength(1)
  })

  test(`sent question re-expanded: no controls, sent note (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    await ui.press({ key: 'q-0' })
    await ui.press({ key: 'accept-0' })

    await ui.press({ key: 'q-0' })
    const texts = await bandTexts(ui)

    expect(texts.at(-1)).toBe('✓ Antwort gesendet')
    expect(await ui.find({ key: 'accept-0' })).toBe(undefined)
    expect(await ui.find({ key: 'answer-0' })).toBe(undefined)
  })

  test(`question leaving ticker drops sent mark (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    await ui.press({ key: 'q-0' })
    await ui.press({ key: 'accept-0' })

    await $.tool.call({ tool: TOOL, ...TICK, questions: [] })
    await $.tool.call({ tool: TOOL, ...TICK })

    expect((await ui.find({ key: 'q-0' }))?.props.label).toBe('▸ 1: Eigenes Paket?')
  })

  test(`question re-expand reuses explanation, no second fork (${surface})`, async ($, on) => {
    const { forks } = stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })

    await ui.press({ key: 'q-0' })
    await ui.press({ key: 'q-0' })
    await ui.press({ key: 'q-0' })

    expect(forks).toHaveLength(1)
  })

  test(`failed fork shows error hint, no accept button (${surface})`, async ($, on) => {
    stubEngine(on, null)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    await ui.press({ key: 'q-0' })

    const texts = await bandTexts(ui)
    expect(texts.at(-1)).toBe('Erklärung fehlgeschlagen (empty-reply), zu- und aufklappen für neuen Versuch')
    expect(await ui.find({ key: 'accept-0' })).toBe(undefined)
  })

  test(`shipped explanation shows on expand without fork (${surface})`, async ($, on) => {
    const { forks } = stubEngine(on)
    await $.tool.call({
      tool: TOOL,
      ...TICK,
      questions: [{ text: 'Eigenes Paket?', context: 'Treiber-Schnitt offen', recommendation: 'eigenes Paket' }],
    })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    await ui.press({ key: 'q-0' })
    const texts = await bandTexts(ui)

    expect(forks).toHaveLength(0)
    expect((await ui.find({ key: 'q-0' }))?.props.label).toBe('▾ 1: Eigenes Paket?')
    expect(texts.slice(-2)).toEqual(['Worum: Treiber-Schnitt offen', 'Empfehlung: eigenes Paket'])
    expect((await ui.find({ key: 'accept-0' }))?.props.label).toBe('Empfehlung übernehmen')
  })

  test(`typed answer is sent as prompt (${surface})`, async ($, on) => {
    const { prompts } = stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    await ui.press({ key: 'q-0' })

    await ui.input({ key: 'answer-0', text: 'optionale Dependency' })

    expect(prompts).toEqual(['Antwort auf offene Frage 1 „Eigenes Paket?“: optionale Dependency'])
  })

  test(`hide-done toggle hides done steps, counter keeps all, toggles back (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'hide-done' }))?.props.label).toBe('erledigt ausblenden')

    await ui.press({ key: 'hide-done' })
    const hidden = await bandTexts(ui)

    expect(hidden[0]).toBe('1/3')
    expect(hidden).not.toContain('Treiber hinter Naht')
    expect(hidden).toContain('uuid-Seeding')
    expect((await ui.find({ key: 'hide-done' }))?.props.label).toBe('erledigt einblenden')

    await ui.press({ key: 'hide-done' })
    expect(await bandTexts(ui)).toContain('Treiber hinter Naht')
  })

  test(`no done step -> no hide-done toggle (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK, steps: TICK.steps.map(st => ({ ...st, status: 'todo' })) })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })

    expect(await ui.find({ key: 'hide-done' })).toBe(undefined)
  })

  test(`separator above hide-done toggle (${surface})`, async ($, on) => {
    stubEngine(on)
    await $.tool.call({ tool: TOOL, ...TICK })
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'toggle' })

    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

    expect(texts.at(-1)).toBe('─'.repeat(118))
    expect((await ui.find({ key: 'hide-done' }))?.props.label).toBe('erledigt ausblenden')
  })

  test(`pane without tick shows hint (${surface})`, async ($, on) => {
    stubEngine(on)
    const ui = await $.ui.mount({ plugin: 'ticker', surface, component: 'Pane', requestId: 'ticker', props: PANE_PROPS })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

    expect(texts).toEqual(['Noch kein Tick. /ticker starten.'])
  })
}

test('tool call without topic is denied', async ($, on) => {
  stubEngine(on)
  const res = await $.tool.call({ tool: TOOL, steps: TICK.steps, total: 10 })
  expect(typeof res.deny).toBe('string')
})

test('parseInput clamps percent and defaults unknown status to todo', async () => {
  const parsed = parseInput(
    { topic: 'X', steps: [{ name: 'a', status: 'weird' }, { name: 'b', status: 'active', percent: 140 }, { name: 'c', status: 'done' }], total: -5 },
    0,
  )
  expect(typeof parsed).toBe('object')
  if (typeof parsed === 'string') return
  expect(parsed.steps).toEqual([
    { name: 'a', status: 'todo', percent: null },
    { name: 'b', status: 'active', percent: 100 },
    { name: 'c', status: 'done', percent: null },
  ])
  expect(parsed.total).toBe(0)
  expect(parsed.questions).toEqual([])
})

const tick = (steps: { name: string; status: string; percent?: number }[]) => {
  const parsed = parseInput({ topic: 'X', steps, total: 50 }, 0)
  if (typeof parsed === 'string') throw new Error(parsed)
  return parsed
}

test('newlyDone lists only freshly finished steps', async () => {
  const prev = tick([{ name: 'a', status: 'done' }, { name: 'b', status: 'active' }, { name: 'c', status: 'todo' }])
  const next = tick([{ name: 'a', status: 'done' }, { name: 'b', status: 'done' }, { name: 'c', status: 'todo' }])
  expect(newlyDone(prev, next)).toEqual(['b'])
  expect(newlyDone(null, next)).toEqual(['a', 'b'])
})

test('hasStepChange: first tick, status, rename, add -> true; percent only -> false', async () => {
  const base = tick([{ name: 'a', status: 'done' }, { name: 'b', status: 'active', percent: 10 }, { name: 'c', status: 'todo' }])
  expect(hasStepChange(null, base)).toBe(true)
  expect(hasStepChange(base, tick([{ name: 'a', status: 'done' }, { name: 'b', status: 'active', percent: 80 }, { name: 'c', status: 'todo' }]))).toBe(false)
  expect(hasStepChange(base, tick([{ name: 'a', status: 'done' }, { name: 'b', status: 'done' }, { name: 'c', status: 'active' }]))).toBe(true)
  expect(hasStepChange(base, tick([{ name: 'a', status: 'done' }, { name: 'B', status: 'active' }, { name: 'c', status: 'todo' }]))).toBe(true)
  expect(hasStepChange(base, tick([{ name: 'a', status: 'done' }, { name: 'b', status: 'active' }, { name: 'c', status: 'todo' }, { name: 'd', status: 'todo' }]))).toBe(true)
})

test('bar + age helpers', async () => {
  expect(barParts(60, 10)).toEqual({ filled: '██████', rest: '░░░░' })
  expect(formatAge(30 * 1000)).toBe('gerade eben')
  expect(formatAge(5 * 60 * 1000)).toBe('vor 5 min')
  expect(formatAge(2 * 60 * 60 * 1000)).toBe('vor 2 h')
})

test('parseRecommendation reads Empfehlung line, null when missing', async () => {
  expect(parseRecommendation(EXPLANATION)).toBe('eigenes Paket, haelt Kern schlank')
  expect(parseRecommendation('Worum: x')).toBe(null)
})

test('parseQuestionDetails: objects with details only, plain strings + bare objects skipped', async () => {
  const details = parseQuestionDetails({
    questions: [
      'Alte Frage?',
      { text: 'Nur Text?' },
      { text: 'Neue Frage?', context: 'Kontext', options: 'A | B', recommendation: 'A' },
    ],
  })
  expect(details).toEqual({
    'Neue Frage?': {
      status: 'ready',
      text: ['Worum: Kontext', 'Optionen: A | B', 'Empfehlung: A'].join('\n'),
      recommendation: 'A',
    },
  })
})

test('parseInput reduces object questions to their text', async () => {
  const parsed = parseInput({ ...TICK, questions: ['Alt?', { text: ' Neu? ', recommendation: 'x' }] }, 0)
  if (typeof parsed === 'string') throw new Error(parsed)
  expect(parsed.questions).toEqual(['Alt?', 'Neu?'])
})
