/**
 * Freedoom's maps, cut down to what this engine reads.
 *
 * GENERATED OUTPUT -- run `npx tsx scripts/bakemaps.ts <freedoom1.wad> <freedoom2.wad>`
 * and it writes `web/public/maps/`. Rerunning it against the same files gives
 * the same bytes back.
 *
 * The maps are Freedoom's, used under the three-clause BSD licence it is
 * released under; the notice that has to travel with them is
 * `web/public/COPYING.txt`, served next to the page. Nothing here is from a
 * commercial game.
 *
 * Each map comes out as a WAD of its own rather than as some format invented
 * here, and that is the whole point of the exercise. A format of my own would
 * need a second importer beside the one that already reads files people open,
 * and two importers for one job is how the two of them drift. What is dropped
 * is what this renderer never looks at: SEGS, SSECTORS, NODES, REJECT and
 * BLOCKMAP are a BSP tree and a visibility matrix, and this walks portals.
 * That is nine tenths of a map file's weight.
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** The five lumps `readMap` asks for, and nothing else. */
const KEEP = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SECTORS']

interface Lump {
  readonly name: string
  readonly at: number
  readonly size: number
}

function nameAt(bytes: Uint8Array, at: number): string {
  let text = ''
  for (let i = 0; i < 8; i++) {
    const code = bytes[at + i]
    if (code === undefined || code === 0) break
    text += String.fromCharCode(code)
  }
  return text.toUpperCase()
}

function directoryOf(bytes: Uint8Array): Lump[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(4, true)
  const at = view.getUint32(8, true)
  const lumps: Lump[] = []
  for (let i = 0; i < count; i++) {
    const entry = at + i * 16
    lumps.push({
      at: view.getUint32(entry, true),
      size: view.getUint32(entry + 4, true),
      name: nameAt(bytes, entry + 8),
    })
  }
  return lumps
}

/** A WAD holding one map: the marker, then the lumps that matter. */
function oneMap(source: Uint8Array, marker: string, lumps: readonly Lump[]): Uint8Array {
  const entries: { name: string; data: Uint8Array }[] = [
    { name: marker, data: new Uint8Array(0) },
    ...lumps.map((lump) => ({ name: lump.name, data: source.subarray(lump.at, lump.at + lump.size) })),
  ]
  const payload = entries.reduce((total, entry) => total + entry.data.length, 0)
  const out = new Uint8Array(12 + payload + entries.length * 16)
  const view = new DataView(out.buffer)
  // "PWAD" rather than "IWAD": this is an addition to a game rather than one.
  for (const [i, code] of [...'PWAD'].entries()) view.setUint8(i, code.charCodeAt(0))
  view.setUint32(4, entries.length, true)
  view.setUint32(8, 12 + payload, true)

  let at = 12
  let entry = 12 + payload
  for (const { name, data } of entries) {
    out.set(data, at)
    view.setUint32(entry, at, true)
    view.setUint32(entry + 4, data.length, true)
    for (let i = 0; i < 8; i++) view.setUint8(entry + 8 + i, i < name.length ? name.charCodeAt(i) : 0)
    at += data.length
    entry += 16
  }
  return out
}

const sources = process.argv.slice(2)
if (sources.length === 0) {
  console.error('give me the WAD files to read, at a desk, once')
  process.exit(1)
}

const OUT = join('web', 'public', 'maps')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const listed: { name: string; file: string; bytes: number }[] = []
for (const source of sources) {
  const bytes = new Uint8Array(readFileSync(source))
  const lumps = directoryOf(bytes)
  for (const [i, lump] of lumps.entries()) {
    if (!/^(MAP\d\d|E\dM\d)$/.test(lump.name)) continue
    // A map's own lumps are the ones that follow it, up to the next marker.
    const own: Lump[] = []
    for (const next of lumps.slice(i + 1, i + 12)) {
      if (/^(MAP\d\d|E\dM\d)$/.test(next.name)) break
      if (KEEP.includes(next.name)) own.push(next)
    }
    if (own.length !== KEEP.length) {
      console.error(`${lump.name} is missing ${KEEP.filter((k) => !own.some((o) => o.name === k)).join(', ')}`)
      continue
    }
    const baked = oneMap(bytes, lump.name, own)
    const file = `${lump.name}.wad`
    writeFileSync(join(OUT, file), baked)
    listed.push({ name: lump.name, file, bytes: baked.length })
  }
}

// One list, so the page knows what there is without asking for anything twice.
writeFileSync(join(OUT, 'maps.json'), `${JSON.stringify(listed, null, 0)}\n`)
const total = listed.reduce((sum, entry) => sum + entry.bytes, 0)
console.error(`${listed.length} maps, ${(total / 1024 / 1024).toFixed(2)} MB raw`)
