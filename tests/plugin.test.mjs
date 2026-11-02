/** Behaviour of the card loader and the preset definitions it registers. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import * as plugin from '../lib/index.js'

const cards = plugin.loadCards(plugin.bundledCardsDir())

test('the bundled library holds every source card', () => {
  assert.equal(cards.length, 23)
  assert.deepEqual(cards.map((card) => card.id), [
    '01', '02', '03', '06', '07', '08', '10', '11', '12', '13', '14', '15', '16',
    '17', '18', '19', '20', '21', '22', '23', '24', '25', '26',
  ])
})

test('a card carries its persona body, name and one-line description', () => {
  const card = cards.find((candidate) => candidate.id === '22')
  assert.equal(card.name, '撩人精')
  assert.match(card.description, /^你是撩人精/)
  assert.ok(card.persona.length > 1500, 'persona body is the whole card')
  assert.ok(!card.persona.includes('## 十一、快速切换'), 'human metadata is not part of the prompt')
  assert.ok(!card.persona.includes('QQ'), 'the bridge speaks WeChat, not QQ')
})

test('one card becomes one persona-only preset', () => {
  const card = cards.find((candidate) => candidate.id === '22')
  const definition = plugin.definitionFor(card, 'card-', 122)
  assert.equal(definition.id, 'card-22')
  assert.equal(definition.order, 122)
  assert.deepEqual(definition.plugins.map((row) => row.id), ['persona'])
  const persona = definition.plugins[0]
  assert.equal(persona.name, '@deepseek-ai/dsh-persona')
  assert.equal(persona.config.prefix, card.persona)
  assert.equal(persona.config.complete, true)
  assert.equal(persona.config.includeRuntimeContext, false)
})

test('apply registers every card and disposes them together', async () => {
  const registered = []
  const disposed = []
  let cleanup
  const ctx = {
    agentPresets: {
      register: async (definition) => {
        registered.push(definition.id)
        return async () => {
          disposed.push(definition.id)
        }
      },
    },
    effect: (setup) => {
      cleanup = setup()
    },
  }
  await plugin.apply(ctx)
  assert.equal(registered.length, 23)
  assert.equal(registered[0], 'card-01')
  assert.equal(registered.at(-1), 'card-26')
  cleanup()
  assert.equal(disposed.length, 23)
})

test('a failing card never stops the remaining registrations', async () => {
  const registered = []
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    const ctx = {
      agentPresets: {
        register: async (definition) => {
          if (definition.id === 'card-02') throw new Error('duplicate agent preset')
          registered.push(definition.id)
          return async () => {}
        },
      },
    }
    await plugin.apply(ctx)
  } finally {
    console.warn = originalWarn
  }
  assert.equal(registered.length, 22)
  assert.ok(!registered.includes('card-02'))
  assert.match(warnings[0], /card 02 .*duplicate agent preset/)
})

test('a custom cards directory and prefix are honoured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-companion-'))
  try {
    writeFileSync(join(directory, '22.json'), JSON.stringify({
      id: '22',
      name: '自定义卡',
      description: 'custom',
      persona: 'x'.repeat(300),
    }))
    const registered = []
    await plugin.apply({ agentPresets: { register: async (definition) => {
      registered.push(definition.id)
      return async () => {}
    } } }, { cardsDir: directory, presetPrefix: 'mine-' })
    assert.deepEqual(registered, ['mine-22'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the generator turns card markdown into persona JSON', () => {
  const source = mkdtempSync(join(tmpdir(), 'dsh-companion-src-'))
  const output = mkdtempSync(join(tmpdir(), 'dsh-companion-gen-'))
  try {
    mkdirSync(join(source, '22-撩人精'))
    writeFileSync(join(source, '22-撩人精', '人格卡.md'), [
      '# 人格卡 22｜撩人精',
      '',
      '> **一句话人设**：测试用。',
      '',
      '## 〇、人味校准',
      '',
      '你是在 QQ 上打字。'.repeat(20),
      '',
      '## 十一、快速切换',
      '',
      '- **角色名**：`22-撩人精`',
      '- **一句话系统提示**：你是撩人精：测试。',
    ].join('\n'))
    execFileSync(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'gen-cards.mjs'), source, output], { stdio: 'pipe' })
    const generated = plugin.loadCards(output)
    assert.deepEqual(generated.map((card) => card.id), ['22'])
    assert.equal(generated[0].name, '撩人精')
    assert.equal(generated[0].description, '你是撩人精：测试。')
    assert.ok(generated[0].persona.includes('你是在 微信 上打字'), 'QQ is rewritten to WeChat')
    assert.ok(!generated[0].persona.includes('## 十一、快速切换'))
    assert.ok(!generated[0].persona.includes('角色名'))
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(output, { recursive: true, force: true })
  }
})
