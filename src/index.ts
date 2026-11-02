/**
 * dsh-companion: persona cards as first-class agent presets.
 *
 * The chat bridge sends every contact to an inbound endpoint, and each
 * endpoint names a preset. This plugin turns the card library into presets —
 * one `@deepseek-ai/dsh-agent-preset` declaration per card, each mounting the
 * card body as the agent's whole system prompt — so persona selection becomes
 * endpoint configuration instead of prompt assembly on the bridge side.
 *
 * The card library is editable from the DSH web UI: this host half owns the
 * card files and the live preset registrations, the bundled client half renders
 * the editor on the plugin's page and calls the routes registered below.
 * @module dsh-companion
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { bundledCardsDir, createCardLibrary, defaultOverridesDir, loadCards, presetIdFor, type CardLibrary, type CompanionCard } from './cards.ts'
import {
  createPresetSet,
  definitionFor,
  DEFAULT_ORDER_BASE,
  DEFAULT_PRESET_PREFIX,
  type PresetDefinition,
  type PresetRegistryLike,
  type PresetSet,
} from './presets.ts'
import { CARDS_API_PREFIX, handleCardsRequest } from './api.ts'

export type { CompanionCard, CardEdit, CardLibrary, LoadedCard } from './cards.ts'
export type { PresetDefinition, PresetRegistryLike, PresetSet } from './presets.ts'
export { bundledCardsDir, createCardLibrary, loadCards, presetIdFor } from './cards.ts'
export { createPresetSet, definitionFor } from './presets.ts'

export const name = 'dsh-companion'

/**
 * The registry service must exist before cards can be registered. Declaring it
 * makes Cordis hold this plugin until the service is up instead of racing the
 * boot order; a deployment without the registry never runs this plugin.
 */
export const inject = ['agentPresets']

/** Row config: where the cards live and how their presets are named. */
export interface CompanionConfig {
  /** Directory holding the bundled `<id>.json` cards; defaults to the package copy. */
  readonly cardsDir?: string
  /** Directory holding local overrides written by the dashboard; defaults under the DSH home. */
  readonly overridesDir?: string
  /** Preset id prefix; defaults to `card-`. */
  readonly presetPrefix?: string
  /** First preset order slot; presets register in card order after it. */
  readonly orderBase?: number
}

/** Structural slice of the host web server. */
interface WebServerLike {
  register(route: {
    readonly kind: 'exact' | 'prefix'
    readonly path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void
}

/** Structural slice of the plugin context, so this package needs no host types. */
interface ContextLike {
  readonly agentPresets?: PresetRegistryLike
  readonly reflect?: { get(name: string, strict?: boolean): unknown }
  effect?(setup: () => () => void, label?: string): unknown
}

/** Optional service lookup without an inject dependency. */
function probeWebServer(ctx: ContextLike): WebServerLike | undefined {
  try {
    const service = ctx.reflect?.get('webServer', true) as WebServerLike | undefined
    if (service !== undefined && typeof service.register === 'function') return service
  } catch {
    // reflection unavailable — the dashboard stays dark, presets still work
  }
  return undefined
}

/** One line per registration failure, so a broken card never hides in silence. */
function warn(message: string): void {
  console.warn(`[dsh-companion] ${message}`)
}

/**
 * Register every card as a preset and mount the dashboard API.
 *
 * Old entry point kept for tests and for callers that only want the presets
 * (no web server → no editor routes).
 */
export async function apply(ctx: ContextLike, config: CompanionConfig = {}): Promise<void> {
  const registry = ctx.agentPresets
  if (registry === undefined) {
    warn('agent preset registry unavailable; no persona presets were registered')
    return
  }
  const presetPrefix = config.presetPrefix ?? DEFAULT_PRESET_PREFIX
  const library = createCardLibrary({
    bundledDir: config.cardsDir ?? bundledCardsDir(),
    overridesDir: config.overridesDir ?? defaultOverridesDir(),
  })
  const presets = createPresetSet({
    registry,
    library,
    presetPrefix,
    orderBase: config.orderBase ?? DEFAULT_ORDER_BASE,
    warn,
  })
  await presets.registerAll()
  const cards = presets.cards()
  if (cards.length === 0) {
    warn(`no persona cards found in ${library.bundledDir}`)
  }

  const webServer = probeWebServer(ctx)
  if (webServer !== undefined) {
    ctx.effect?.(() => webServer.register({
      kind: 'prefix',
      path: CARDS_API_PREFIX,
      handler: (req, res) => handleCardsRequest(req, res, { library, presets, presetPrefix }),
    }), 'dsh-companion: cards api')
  } else {
    warn('webServer unavailable; the card editor stays dark, presets still load')
  }

  ctx.effect?.(() => () => {
    void presets.dispose()
  }, 'dsh-companion: presets')
  console.log(`[dsh-companion] registered ${cards.length} persona preset(s) from ${library.bundledDir}`)
}
