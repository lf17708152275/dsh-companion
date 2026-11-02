/**
 * dsh-companion: persona cards as first-class agent presets.
 *
 * The chat bridge sends every contact to an inbound endpoint, and each
 * endpoint names a preset. This plugin turns the card library into presets —
 * one `@deepseek-ai/dsh-agent-preset` declaration per card, each mounting the
 * card body as the agent's whole system prompt — so persona selection becomes
 * endpoint configuration instead of prompt assembly on the bridge side.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const name = 'dsh-companion'

/**
 * The registry service must exist before cards can be registered. Declaring it
 * makes Cordis hold this plugin until the service is up instead of racing the
 * boot order; a deployment without the registry never runs this plugin.
 */
export const inject = ['agentPresets']

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

/** Row config: where the cards live and how their presets are named. */
export interface CompanionConfig {
  /** Directory holding `<id>.json` cards; defaults to the bundled library. */
  readonly cardsDir?: string
  /** Preset id prefix; defaults to `card-`. */
  readonly presetPrefix?: string
  /** First preset order slot; presets register in card order after it. */
  readonly orderBase?: number
}

/** One declared child row, as the preset registry expects it. */
interface PresetRow {
  readonly id?: string
  readonly name: string
  readonly config?: unknown
  readonly disabled?: unknown
}

/** Definition submitted to `ctx.agentPresets.register`. */
interface PresetDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly plugins: readonly PresetRow[]
}

/** Structural slice of the host preset registry this plugin depends on. */
interface PresetRegistryLike {
  register(definition: PresetDefinition): Promise<() => Promise<void>>
}

/** Structural slice of the plugin context, so this package needs no host types. */
interface ContextLike {
  readonly agentPresets?: PresetRegistryLike
  effect?(setup: () => () => void): unknown
}

const DEFAULT_PRESET_PREFIX = 'card-'
const DEFAULT_ORDER_BASE = 100
const CARD_ID_RE = /^\d{2}$/

/** Directory holding the bundled card library (beside `lib/` in the package). */
export function bundledCardsDir(): string {
  return resolve(import.meta.dirname, '..', 'cards')
}

/** Read every card in a directory, sorted by id; unreadable cards are skipped. */
export function loadCards(directory: string): CompanionCard[] {
  const cards: CompanionCard[] = []
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(directory, entry), 'utf8'))
    } catch {
      continue
    }
    const card = parsed as Partial<CompanionCard>
    if (typeof card.id !== 'string' || !CARD_ID_RE.test(card.id)) continue
    if (typeof card.name !== 'string' || card.name.length === 0) continue
    if (typeof card.persona !== 'string' || card.persona.length < 200) continue
    cards.push({
      id: card.id,
      name: card.name,
      description: typeof card.description === 'string' ? card.description : `人格卡：${card.name}`,
      persona: card.persona,
      ...(typeof card.source === 'string' ? { source: card.source } : {}),
    })
  }
  return cards.sort((left, right) => left.id.localeCompare(right.id))
}

/** Preset id of one card: `card-22` unless the deployment renames the prefix. */
export function presetIdFor(cardId: string, prefix: string): string {
  return `${prefix}${cardId}`
}

/**
 * Preset definition of one card.
 *
 * `complete: true` makes the card body the only system prompt, so the persona
 * is not diluted by the default engineering instructions; runtime context is
 * off because the bridge already bakes time and speaker into each message.
 */
export function definitionFor(card: CompanionCard, prefix: string, order: number): PresetDefinition {
  return {
    id: presetIdFor(card.id, prefix),
    name: card.name,
    description: card.description,
    order,
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: { prefix: card.persona, complete: true, includeRuntimeContext: false },
      },
    ],
  }
}

/** One line per registration failure, so a broken card never hides in silence. */
function warn(message: string): void {
  console.warn(`[dsh-companion] ${message}`)
}

/** Register every card as a preset; failures are reported without aborting the rest. */
export async function apply(ctx: ContextLike, config: CompanionConfig = {}): Promise<void> {
  const registry = ctx.agentPresets
  if (registry === undefined) {
    warn('agent preset registry unavailable; no persona presets were registered')
    return
  }
  const directory = config.cardsDir ?? bundledCardsDir()
  const prefix = config.presetPrefix ?? DEFAULT_PRESET_PREFIX
  const orderBase = config.orderBase ?? DEFAULT_ORDER_BASE
  const cards = loadCards(directory)
  if (cards.length === 0) {
    warn(`no persona cards found in ${directory}`)
    return
  }
  const disposers: Array<() => Promise<void>> = []
  for (const [index, card] of cards.entries()) {
    try {
      disposers.push(await registry.register(definitionFor(card, prefix, orderBase + index)))
    } catch (error) {
      warn(`card ${card.id} (${card.name}) was not registered: ${String(error)}`)
    }
  }
  ctx.effect?.(() => () => {
    for (const dispose of disposers) void dispose()
  })
  console.log(`[dsh-companion] registered ${disposers.length}/${cards.length} persona preset(s) from ${directory}`)
}
