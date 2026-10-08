// Module hooks for tests/support/jsx.mjs: a .jsx file is read and handed to
// Vite's transformWithOxc (automatic runtime, so it imports react/jsx-runtime
// like the real build); everything else loads as usual.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

let transformWithOxc = null

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.jsx')) return nextLoad(url, context)
  transformWithOxc ??= (await import('vite')).transformWithOxc
  const filename = fileURLToPath(url)
  const source = await readFile(filename, 'utf8')
  const out = await transformWithOxc(source, filename, { lang: 'jsx', jsx: { runtime: 'automatic' } })
  return { format: 'module', source: out.code, shortCircuit: true }
}
