/**
 * HTTP surface of the card dashboard: list / save / restore.
 *
 * The client half ships inside this package and talks to these routes, so the
 * editor needs no host remote-service wiring of its own. Routes are registered
 * on the host web server under a plugin-private prefix.
 * @module dsh-companion/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CardLibrary, LoadedCard } from './cards.ts'
import type { PresetSet } from './presets.ts'
import { presetIdFor } from './cards.ts'

/** Prefix these routes are mounted under. */
export const CARDS_API_PREFIX = '/x-dsh-companion/api'

const MAX_BODY_BYTES = 512 * 1024

/** What the HTTP layer needs from the plugin. */
export interface CardsApiHost {
  readonly library: CardLibrary
  readonly presets: PresetSet
  readonly presetPrefix: string
}

/** What the dashboard receives. */
export interface CardsSnapshot {
  readonly ok: true
  readonly cards: readonly LoadedCard[]
  readonly overridesDir: string
  readonly bundledDir: string
  readonly presetPrefix: string
}

function snapshot(host: CardsApiHost): CardsSnapshot {
  return {
    ok: true,
    cards: host.library.list(),
    overridesDir: host.library.overridesDir,
    bundledDir: host.library.bundledDir,
    presetPrefix: host.presetPrefix,
  }
}

/** One JSON response. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Read one JSON request body, bounded so a huge paste cannot wedge the host. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  if (size === 0) throw new Error('请求体为空')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** Route one dashboard request; always answers, never throws. */
export async function handleCardsRequest(req: IncomingMessage, res: ServerResponse, host: CardsApiHost): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.startsWith(CARDS_API_PREFIX) ? url.pathname.slice(CARDS_API_PREFIX.length) : url.pathname
  try {
    if (req.method === 'GET' && (path === '/cards' || path === '/')) {
      sendJson(res, 200, snapshot(host))
      return
    }
    if (req.method === 'POST' && path === '/cards/save') {
      const card = await host.presets.save(await readJson(req))
      sendJson(res, 200, { ...snapshot(host), saved: card })
      return
    }
    if (req.method === 'POST' && path === '/cards/reset') {
      const body = (await readJson(req)) as { id?: unknown }
      if (typeof body.id !== 'string') throw new Error('缺少卡片 id')
      const card = await host.presets.reset(body.id)
      sendJson(res, 200, { ...snapshot(host), saved: card ?? null })
      return
    }
    sendJson(res, 404, { ok: false, message: `未知接口：${req.method ?? 'GET'} ${path}` })
  } catch (error) {
    sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}

/** Preset id the dashboard shows beside one card. */
export function presetIdOf(card: LoadedCard, prefix: string): string {
  return presetIdFor(card.id, prefix)
}
