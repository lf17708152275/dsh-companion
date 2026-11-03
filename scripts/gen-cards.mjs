#!/usr/bin/env node
/**
 * Turn the 26-persona-card source folder into one card JSON per persona.
 *
 * Each card folder holds `人格卡.md`, a prompt written for a chat model: the
 * body from 〇 to 十 is the persona itself, while the trailing 快速切换 section
 * is metadata for humans (角色名 / 一句话系统提示 / 适配), so it is lifted into
 * fields and dropped from the prompt. The source text targets QQ; the bot
 * bridges WeChat, so the platform word is rewritten.
 *
 * Usage: node scripts/gen-cards.mjs [sourceDir] [outputDir]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const source = process.argv[2]
if (source === undefined) {
  console.error('用法: node scripts/gen-cards.mjs <人格卡目录> [输出目录]')
  console.error('例: node scripts/gen-cards.mjs ~/cards')
  process.exit(1)
}
const output = resolve(process.argv[3] ?? join(import.meta.dirname, '..', 'cards'))
const META_HEADING = '## 十一、快速切换'
const CARD_DIR_RE = /^(\d{2})-(.+)$/

/** Read one field out of the trailing metadata block. */
function metaField(text, label) {
  const match = new RegExp(`^- \\*\\*${label}\\*\\*：(.+)$`, 'm').exec(text)
  return match?.[1]?.trim()
}

/** Build one card record from one source folder, or undefined when unreadable. */
function parseCard(folder) {
  const match = CARD_DIR_RE.exec(folder)
  if (!match) return undefined
  const [, number, folderName] = match
  const file = join(source, folder, '人格卡.md')
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const metaAt = raw.indexOf(META_HEADING)
  const personaSection = (metaAt === -1 ? raw : raw.slice(0, metaAt)).trim()
  const persona = personaSection
    .replace(/^# 人格卡[^\n]*\n+/, '')
    .replace(/QQ/g, '微信')
    .trim()
  const roleName = (metaField(raw, '角色名') ?? folderName)
    .replace(/`/g, '')
    .replace(/^\d{2}-/, '')
    .trim()
  const oneLiner = metaField(raw, '一句话系统提示')?.replace(/`/g, '')
  const card = {
    id: number,
    name: roleName,
    description: oneLiner ?? `人格卡：${roleName}`,
    persona,
    source: folder,
  }
  if (persona.length < 200) return undefined
  return card
}

mkdirSync(output, { recursive: true })
const cards = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => parseCard(entry.name))
  .filter((card) => card !== undefined)
  .sort((left, right) => left.id.localeCompare(right.id))

for (const card of cards) {
  writeFileSync(join(output, `${card.id}.json`), `${JSON.stringify(card, null, 2)}\n`)
}
console.log(`wrote ${cards.length} card(s) to ${output}`)
for (const card of cards) {
  console.log(`- ${card.id} ${card.name}: persona ${card.persona.length} chars | ${card.description.slice(0, 40)}`)
}
