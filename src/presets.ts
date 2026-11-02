/**
 * Preset set: one live `@deepseek-ai/dsh-agent-preset` registration per card,
 * with the hot path the dashboard editor needs.
 *
 * The registry returns a disposer per definition, so an edited card is applied
 * by disposing its previous revision and registering the new one. Sessions
 * that already started keep their revision (the host owns that); the next
 * session opened by the endpoint picks up the edit.
 * @module dsh-companion/presets
 */
import { presetIdFor, type CardLibrary, type LoadedCard } from './cards.ts'

/** One declared child row, as the preset registry expects it. */
export interface PresetRow {
  readonly id?: string
  readonly name: string
  readonly config?: unknown
  readonly disabled?: unknown
}

/** Definition submitted to `ctx.agentPresets.register`. */
export interface PresetDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly plugins: readonly PresetRow[]
}

/** Structural slice of the host preset registry this plugin depends on. */
export interface PresetRegistryLike {
  register(definition: PresetDefinition): Promise<() => Promise<void>>
}

export const DEFAULT_PRESET_PREFIX = 'card-'
export const DEFAULT_ORDER_BASE = 100

/**
 * Preset definition of one card.
 *
 * `complete: true` makes the card body the only system prompt, so the persona
 * is not diluted by the default engineering instructions; runtime context is
 * off because the bridge already bakes time and speaker into each message.
 */
export function definitionFor(card: LoadedCard | { id: string; name: string; description: string; persona: string }, prefix: string, order: number): PresetDefinition {
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

/** The live preset registrations behind one card library. */
export interface PresetSet {
  /** Effective cards, in the order their presets are registered. */
  cards(): LoadedCard[]
  /** Register every card; per-card failures are reported and skipped. */
  registerAll(): Promise<void>
  /** Persist an edit and re-register that card's preset. */
  save(input: unknown): Promise<LoadedCard>
  /** Drop a card's override and re-register (or unregister) its preset. */
  reset(id: string): Promise<LoadedCard | undefined>
  /** Dispose every registration. */
  dispose(): Promise<void>
}

/** Build the preset set over a library and the host registry. */
export function createPresetSet(options: {
  readonly registry: PresetRegistryLike
  readonly library: CardLibrary
  readonly presetPrefix?: string
  readonly orderBase?: number
  readonly warn?: (message: string) => void
}): PresetSet {
  const prefix = options.presetPrefix ?? DEFAULT_PRESET_PREFIX
  const orderBase = options.orderBase ?? DEFAULT_ORDER_BASE
  const warn = options.warn ?? ((message: string) => console.warn(`[dsh-companion] ${message}`))
  const live = new Map<string, () => Promise<void>>()

  const orderOf = (cardId: string): number => orderBase + Math.max(0, options.library.list().findIndex((card) => card.id === cardId))

  const drop = async (cardId: string): Promise<void> => {
    const dispose = live.get(cardId)
    if (dispose === undefined) return
    live.delete(cardId)
    try {
      await dispose()
    } catch (error) {
      warn(`card ${cardId} was not disposed cleanly: ${String(error)}`)
    }
  }

  const apply = async (card: LoadedCard): Promise<void> => {
    await drop(card.id)
    try {
      live.set(card.id, await options.registry.register(definitionFor(card, prefix, orderOf(card.id))))
    } catch (error) {
      warn(`card ${card.id} (${card.name}) was not registered: ${String(error)}`)
      throw error
    }
  }

  return {
    cards: () => options.library.list(),
    async registerAll(): Promise<void> {
      for (const card of options.library.list()) {
        try {
          live.set(card.id, await options.registry.register(definitionFor(card, prefix, orderOf(card.id))))
        } catch (error) {
          warn(`card ${card.id} (${card.name}) was not registered: ${String(error)}`)
        }
      }
    },
    async save(input: unknown): Promise<LoadedCard> {
      const card = options.library.save(input)
      await apply(card)
      return card
    },
    async reset(id: string): Promise<LoadedCard | undefined> {
      const card = options.library.reset(id)
      if (card === undefined) {
        await drop(id)
        return undefined
      }
      await apply(card)
      return card
    },
    async dispose(): Promise<void> {
      // Start every disposer before awaiting, so a synchronous caller (plugin
      // teardown) at least kicks them all off; failures never block the rest.
      const pending: Promise<void>[] = []
      for (const cardId of [...live.keys()]) {
        const dispose = live.get(cardId)
        live.delete(cardId)
        if (dispose === undefined) continue
        try {
          pending.push(dispose())
        } catch (error) {
          warn(`card ${cardId} was not disposed cleanly: ${String(error)}`)
        }
      }
      await Promise.allSettled(pending)
    },
  }
}
