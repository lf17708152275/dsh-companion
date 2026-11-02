/** Editing surface: override library, live preset re-registration, dashboard API. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import * as plugin from '../lib/index.js'
import { handleCardsRequest } from '../lib/api.js'

const PERSONA = '你是一只测试用的鲸鱼，说话短、爱眨眼。'.repeat(20)

/** One throwaway bundled library plus one throwaway override directory. */
function fixture(cards = { '22': { name: '内置撩人精', persona: PERSONA } }) {
  const bundledDir = mkdtempSync(join(tmpdir(), 'dsh-companion-bundled-'))
  const overridesDir = mkdtempSync(join(tmpdir(), 'dsh-companion-overrides-'))
  for (const [id, card] of Object.entries(cards)) {
    writeFileSync(join(bundledDir, `${id}.json`), JSON.stringify({
      id,
      name: card.name,
      description: `人格卡：${card.name}`,
      persona: card.persona,
      source: 'bundle',
    }))
  }
  const cleanup = () => {
    rmSync(bundledDir, { recursive: true, force: true })
    rmSync(overridesDir, { recursive: true, force: true })
  }
  return { bundledDir, overridesDir, cleanup }
}

/** Registry stub that remembers every registration and disposal. */
function fakeRegistry(failIds = new Set()) {
  const registered = []
  const disposed = []
  return {
    registered,
    disposed,
    async register(definition) {
      if (failIds.has(definition.id)) throw new Error('duplicate agent preset')
      registered.push(definition.id)
      return async () => { disposed.push(definition.id) }
    },
  }
}

test('an override shadows the bundled card and is marked as such', () => {
  const fixtureDirs = fixture()
  try {
    const library = plugin.createCardLibrary(fixtureDirs)
    assert.equal(library.list()[0].overridden, false)
    library.save({ id: '22', name: '我的撩人精', persona: `${PERSONA}\n\n我偏要更撩。` })
    const [card] = library.list()
    assert.equal(card.overridden, true)
    assert.equal(card.name, '我的撩人精')
    assert.match(card.persona, /我偏要更撩。/)
    // One file per card, written beside the target and renamed into place.
    assert.deepEqual(readdirSync(fixtureDirs.overridesDir), ['22.json'])
    assert.equal(JSON.parse(readFileSync(join(fixtureDirs.overridesDir, '22.json'), 'utf8')).id, '22')
  } finally {
    fixtureDirs.cleanup()
  }
})

test('reset drops the override and restores the bundled card', () => {
  const fixtureDirs = fixture()
  try {
    const library = plugin.createCardLibrary(fixtureDirs)
    library.save({ id: '22', name: '我的撩人精', persona: `${PERSONA}\n\nx` })
    const restored = library.reset('22')
    assert.equal(restored.overridden, false)
    assert.equal(restored.name, '内置撩人精')
    assert.deepEqual(readdirSync(fixtureDirs.overridesDir), [])
    // Resetting a card that never had an override is a no-op, not an error.
    assert.equal(library.reset('22').overridden, false)
    assert.equal(library.reset('99'), undefined)
  } finally {
    fixtureDirs.cleanup()
  }
})

test('save rejects edits that would produce a useless card', () => {
  const fixtureDirs = fixture()
  try {
    const library = plugin.createCardLibrary(fixtureDirs)
    assert.throws(() => library.save({ id: '2', name: 'x', persona: PERSONA }), /两位数字/)
    assert.throws(() => library.save({ id: '22', name: '  ', persona: PERSONA }), /名字不能为空/)
    assert.throws(() => library.save({ id: '22', name: 'x', persona: '太短了' }), /至少 200 字/)
    assert.throws(() => library.save({ id: '22', name: 'x'.repeat(41), persona: PERSONA }), /不能超过 40 字/)
  } finally {
    fixtureDirs.cleanup()
  }
})

test('saving a card re-registers only that preset', async () => {
  const fixtureDirs = fixture({ '22': { name: '内置', persona: PERSONA }, '01': { name: '奶糖', persona: PERSONA } })
  try {
    const registry = fakeRegistry()
    const library = plugin.createCardLibrary(fixtureDirs)
    const presets = plugin.createPresetSet({ registry, library, presetPrefix: 'card-', orderBase: 100 })
    await presets.registerAll()
    assert.deepEqual(registry.registered, ['card-01', 'card-22'])
    await presets.save({ id: '22', name: '改过的', persona: `${PERSONA}\n\n新的` })
    assert.deepEqual(registry.disposed, ['card-22'])
    assert.deepEqual(registry.registered, ['card-01', 'card-22', 'card-22'])
    await presets.reset('22')
    assert.deepEqual(registry.disposed, ['card-22', 'card-22'])
    assert.deepEqual(registry.registered.at(-1), 'card-22')
    await presets.dispose()
    assert.deepEqual(registry.disposed, ['card-22', 'card-22', 'card-01', 'card-22'])
  } finally {
    fixtureDirs.cleanup()
  }
})

test('a failing re-registration keeps the previous preset until it is revived', async () => {
  const fixtureDirs = fixture()
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    const registry = fakeRegistry()
    const library = plugin.createCardLibrary(fixtureDirs)
    const presets = plugin.createPresetSet({ registry, library, warn: (message) => warnings.push(message) })
    await presets.registerAll()
    const failing = fakeRegistry(new Set(['card-22']))
    const strict = plugin.createPresetSet({ registry: failing, library, warn: (message) => warnings.push(message) })
    await assert.rejects(() => strict.save({ id: '22', name: '坏卡', persona: `${PERSONA}\n\nx` }), /duplicate agent preset/)
    assert.match(warnings.at(-1), /card 22 .*duplicate agent preset/)
    await presets.dispose()
  } finally {
    console.warn = originalWarn
    fixtureDirs.cleanup()
  }
})

/** Minimal ServerResponse stand-in: records the single JSON body. */
function fakeResponse() {
  const chunks = []
  const res = {
    statusCode: 0,
    headers: undefined,
    writeHead(status, headers) {
      res.statusCode = status
      res.headers = headers
    },
    end(payload) {
      if (payload !== undefined) chunks.push(String(payload))
    },
  }
  return {
    res,
    json() {
      return JSON.parse(chunks.join('') || 'null')
    },
  }
}

/** Minimal IncomingMessage stand-in: yields the body once. */
function fakeRequest(method, url, body) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
  }
}

test('the dashboard api lists, saves and restores cards', async () => {
  const fixtureDirs = fixture()
  try {
    const registry = fakeRegistry()
    const library = plugin.createCardLibrary(fixtureDirs)
    const presets = plugin.createPresetSet({ registry, library })
    await presets.registerAll()
    const host = { library, presets, presetPrefix: 'card-' }

    const listed = fakeResponse()
    await handleCardsRequest(fakeRequest('GET', '/x-dsh-companion/api/cards'), listed.res, host)
    assert.equal(listed.res.statusCode, 200)
    assert.equal(listed.json().cards.length, 1)
    assert.equal(listed.json().presetPrefix, 'card-')

    const saved = fakeResponse()
    await handleCardsRequest(fakeRequest('POST', '/x-dsh-companion/api/cards/save', {
      id: '22', name: '改过', description: '新描述', persona: `${PERSONA}\n\n改过`,
    }), saved.res, host)
    assert.equal(saved.res.statusCode, 200)
    assert.equal(saved.json().cards[0].overridden, true)
    assert.equal(saved.json().cards[0].name, '改过')

    const bad = fakeResponse()
    await handleCardsRequest(fakeRequest('POST', '/x-dsh-companion/api/cards/save', { id: '22', name: 'x', persona: '短' }), bad.res, host)
    assert.equal(bad.res.statusCode, 400)
    assert.match(bad.json().message, /至少 200 字/)

    const restored = fakeResponse()
    await handleCardsRequest(fakeRequest('POST', '/x-dsh-companion/api/cards/reset', { id: '22' }), restored.res, host)
    assert.equal(restored.res.statusCode, 200)
    assert.equal(restored.json().cards[0].overridden, false)

    const unknown = fakeResponse()
    await handleCardsRequest(fakeRequest('GET', '/x-dsh-companion/api/nope'), unknown.res, host)
    assert.equal(unknown.res.statusCode, 404)

    const broken = fakeResponse()
    await handleCardsRequest(fakeRequest('POST', '/x-dsh-companion/api/cards/save', '{not json'), broken.res, host)
    assert.equal(broken.res.statusCode, 400)
    assert.match(broken.json().message, /不是合法 JSON/)
  } finally {
    fixtureDirs.cleanup()
  }
})
