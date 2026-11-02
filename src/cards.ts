/**
 * Card library: the bundled card JSON files plus a writable layer of local
 * overrides the dashboard editor writes.
 *
 * The bundled library ships with the package and stays untouched; an edit
 * writes one override file per card under the DSH home, so upgrading the
 * package never loses a hand edit and "restore" is deleting one file.
 * @module dsh-companion/cards
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** One card as generated from the persona source folder. */
export interface CompanionCard {
  /** Two-digit source number, also the stable part of the preset id. */
  readonly id: string
  readonly name: string
  readonly description: string
  /** The card body; becomes the sole system prompt of the preset. */
  readonly persona: string
  readonly source?: string
}

/** A card plus where the dashboard read it from. */
export interface LoadedCard extends CompanionCard {
  /** True when a local override shadows the bundled card. */
  readonly overridden: boolean
}

/** What the dashboard submits to save one card. */
export interface CardEdit {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly persona: string
}

/** Directory holding the bundled card library (beside `lib/`). */
export function bundledCardsDir(): string {
  return resolve(import.meta.dirname, '..', 'cards')
}

/**
 * Directory holding local overrides.
 *
 * Lives under the DSH home rather than the package so a package upgrade or a
 * repository checkout keeps the hand-edited cards.
 */
export function defaultOverridesDir(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'companion', 'cards')
}

const CARD_ID_RE = /^\d{2}$/
const MAX_NAME = 40
const MAX_DESCRIPTION = 200
const MIN_PERSONA = 200
const MAX_PERSONA = 40_000

/** Read every `*.json` card in a directory, sorted by id; bad files are skipped. */
export function loadCards(directory: string): CompanionCard[] {
  if (!existsSync(directory)) return []
  const cards: CompanionCard[] = []
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue
    const card = readCardFile(join(directory, entry))
    if (card !== undefined) cards.push(card)
  }
  return cards.sort((left, right) => left.id.localeCompare(right.id))
}

/** Parse one card file; undefined when it is unreadable or malformed. */
function readCardFile(path: string): CompanionCard | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  const card = parsed as Partial<CompanionCard>
  if (typeof card.id !== 'string' || !CARD_ID_RE.test(card.id)) return undefined
  if (typeof card.name !== 'string' || card.name.length === 0) return undefined
  if (typeof card.persona !== 'string' || card.persona.length < MIN_PERSONA) return undefined
  return {
    id: card.id,
    name: card.name,
    description: typeof card.description === 'string' ? card.description : `人格卡：${card.name}`,
    persona: card.persona,
    ...(typeof card.source === 'string' ? { source: card.source } : {}),
  }
}

/** Normalize and check a submitted edit; throws one readable message per problem. */
function validateEdit(input: CardEdit): CardEdit {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!CARD_ID_RE.test(id)) throw new Error('卡片 id 必须是两位数字')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length === 0) throw new Error('名字不能为空')
  if (name.length > MAX_NAME) throw new Error(`名字不能超过 ${MAX_NAME} 字`)
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length > MAX_DESCRIPTION) throw new Error(`描述不能超过 ${MAX_DESCRIPTION} 字`)
  const persona = typeof input.persona === 'string' ? input.persona.trim() : ''
  if (persona.length < MIN_PERSONA) throw new Error(`人设正文至少 ${MIN_PERSONA} 字（否则人格立不住）`)
  if (persona.length > MAX_PERSONA) throw new Error(`人设正文不能超过 ${MAX_PERSONA} 字`)
  return { id, name, description: description.length > 0 ? description : `人格卡：${name}`, persona }
}

/** The card library the plugin registers presets from. */
export interface CardLibrary {
  readonly bundledDir: string
  readonly overridesDir: string
  /** Effective cards, bundled ones shadowed by overrides, sorted by id. */
  list(): LoadedCard[]
  /** Persist one edit; returns the effective card. */
  save(input: unknown): LoadedCard
  /** Drop the override of one card; returns its effective card, if any. */
  reset(id: string): LoadedCard | undefined
}

/** Open a card library over one bundled directory and one override directory. */
export function createCardLibrary(options: {
  readonly bundledDir?: string
  readonly overridesDir?: string
} = {}): CardLibrary {
  const bundledDir = options.bundledDir ?? bundledCardsDir()
  const overridesDir = options.overridesDir ?? defaultOverridesDir()

  const effective = (): LoadedCard[] => {
    const merged = new Map<string, LoadedCard>()
    for (const card of loadCards(bundledDir)) merged.set(card.id, { ...card, overridden: false })
    for (const card of loadCards(overridesDir)) merged.set(card.id, { ...card, overridden: true })
    return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  return {
    bundledDir,
    overridesDir,
    list: effective,
    save(input: unknown): LoadedCard {
      const edit = validateEdit(input as CardEdit)
      try {
        mkdirSync(overridesDir, { recursive: true })
        const target = join(overridesDir, `${edit.id}.json`)
        // Write beside the target and rename, so a crash never leaves half a card.
        const staging = `${target}.tmp`
        writeFileSync(staging, `${JSON.stringify({ ...edit, source: 'override' }, null, 2)}\n`, 'utf8')
        renameSync(staging, target)
      } catch (error) {
        throw new Error(`保存失败：${String(error)}`)
      }
      const card = effective().find((candidate) => candidate.id === edit.id)
      if (card === undefined) throw new Error('保存后读不到这张卡，请刷新重试')
      return card
    },
    reset(id: string): LoadedCard | undefined {
      const target = join(overridesDir, `${id}.json`)
      if (existsSync(target)) rmSync(target, { force: true })
      return effective().find((card) => card.id === id)
    },
  }
}

/** Preset id of one card: `card-22` unless the deployment renames the prefix. */
export function presetIdFor(cardId: string, prefix: string): string {
  return `${prefix}${cardId}`
}
