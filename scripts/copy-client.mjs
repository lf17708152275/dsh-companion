/** Copy the hand-written browser half next to the compiled host half. */
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = import.meta.dirname
copyFileSync(resolve(here, '..', 'client', 'index.js'), resolve(here, '..', 'lib', 'client.js'))
console.log('[dsh-companion] wrote lib/client.js')
