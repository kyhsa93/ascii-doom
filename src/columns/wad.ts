/**
 * Reading a map out of a WAD.
 *
 * A WAD is the file format the 1993 engine shipped its data in, and the one
 * Freedoom -- a freely licensed set of Doom-compatible content -- still uses.
 * This turns one map inside such a file into the `Level` this renderer walks.
 *
 * The two models meet more easily than they look. A sector here is its
 * boundary, and a WAD describes exactly that: lines, and which sector sits on
 * each side of each one. What a WAD does *not* have is an ordered outline per
 * sector, which is why nothing in this engine decides anything from one any
 * more -- a room with a pillar in it is several rings, and a fifth to a quarter
 * of the sectors in a real map are that shape.
 *
 * Deliberately no NODES, SEGS or SSECTORS. A WAD carries a prebuilt tree and
 * the obvious way to find which sector a point is in is to descend it, but this
 * engine already answers that question with `sectorAt`, and using its own rule
 * means one fewer format to get right and one fewer thing that can disagree.
 *
 * `DataView` rather than `Buffer`: this has to run in the page, where a player
 * opens a file, as well as in a check.
 */

import { sectorAt, type Level, type Line, type Sector } from './level.ts'

/**
 * Map units to metres.
 *
 * Doom measures in units where a player's eye is 41 up. Dividing by this puts
 * that at about 1.58, which is what this engine calls eye height -- and, more
 * to the point, makes distances mean the same thing they mean in the levels
 * written here, so the light falloff is tuned for the right scale.
 */
export const UNITS_PER_METRE = 26

/** Doom's damaging floor specials, which this engine already has an answer for. */
const DAMAGING = new Set([4, 5, 7, 16])
/** The flat that means "this room is outdoors; draw no ceiling here". */
const SKY_FLAT = 'F_SKY1'
/** What standing in one costs a bite, matching the hazard the levels here use. */
const DAMAGE = 5

interface Lump {
  readonly name: string
  readonly at: number
  readonly size: number
}

/** The lumps that belong to a map, so a map marker can be told from any other lump. */
const MAP_LUMPS = new Set([
  'THINGS',
  'LINEDEFS',
  'SIDEDEFS',
  'VERTEXES',
  'SEGS',
  'SSECTORS',
  'NODES',
  'SECTORS',
  'REJECT',
  'BLOCKMAP',
  'BEHAVIOR',
])

function directory(view: DataView): Lump[] {
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'IWAD' && magic !== 'PWAD') throw new Error(`not a WAD: the file begins "${magic}"`)

  const count = view.getInt32(4, true)
  const at = view.getInt32(8, true)
  const lumps: Lump[] = []
  for (let i = 0; i < count; i++) {
    const entry = at + i * 16
    let name = ''
    for (let c = 0; c < 8; c++) {
      const code = view.getUint8(entry + 8 + c)
      if (code === 0) break
      name += String.fromCharCode(code)
    }
    lumps.push({ name, at: view.getInt32(entry, true), size: view.getInt32(entry + 4, true) })
  }
  return lumps
}

/**
 * The maps in the file, in the order they appear.
 *
 * A map is a marker lump with nothing in it followed by the lumps that make it
 * up, so the marker is recognised by what comes after it rather than by its
 * name -- which is how a file can call its maps E1M1 or MAP01 or anything else
 * without this having to know the convention.
 */
export function mapNames(bytes: Uint8Array): string[] {
  const lumps = directory(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const names: string[] = []
  for (let i = 0; i < lumps.length - 1; i++) {
    const here = lumps[i]!
    if (lumps[i + 1]!.name === 'THINGS' && !MAP_LUMPS.has(here.name)) names.push(here.name)
  }
  return names
}

export interface Spawn {
  readonly x: number
  readonly y: number
  readonly angle: number
  /** Which sector the body starts in, or -1 if the start is outside the map. */
  readonly sector: number
}

export interface WadMap {
  readonly name: string
  readonly level: Level
  /** Where the first player starts, or null if the map has no start at all. */
  readonly spawn: Spawn | null
}

export function readMap(bytes: Uint8Array, name: string): WadMap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lumps = directory(view)
  const start = lumps.findIndex((lump) => lump.name === name)
  if (start < 0) throw new Error(`no map called ${name} in this file`)

  const find = (want: string): Lump => {
    // Within the map's own run of lumps, not the whole file: every map has a
    // lump called SECTORS and taking the first one in the file would read some
    // other map's.
    const found = lumps.slice(start + 1, start + 12).find((lump) => lump.name === want)
    if (!found) throw new Error(`${name} has no ${want}`)
    return found
  }

  const vertexes = find('VERTEXES')
  const linedefs = find('LINEDEFS')
  const sidedefs = find('SIDEDEFS')
  const sectorLump = find('SECTORS')
  const things = find('THINGS')

  const vertex = (index: number): readonly [number, number] => [
    view.getInt16(vertexes.at + index * 4, true) / UNITS_PER_METRE,
    view.getInt16(vertexes.at + index * 4 + 2, true) / UNITS_PER_METRE,
  ]
  const sideSector = (index: number): number => view.getInt16(sidedefs.at + index * 30 + 28, true)
  /** An eight-byte, NUL-padded name, as the format stores every flat and texture. */
  const flatName = (at: number): string => {
    let name = ''
    for (let i = 0; i < 8; i++) {
      const code = view.getUint8(at + i)
      if (code === 0) break
      name += String.fromCharCode(code)
    }
    return name
  }

  // Sectors first, without their edges: the edges come from the lines, and the
  // lines name sectors, so one of the two has to be built incomplete.
  const edges: (readonly [number, number, number, number])[][] = []
  const sectors: Sector[] = []
  for (let i = 0; i < sectorLump.size / 26; i++) {
    const at = sectorLump.at + i * 26
    const special = view.getInt16(at + 22, true)
    const hurt = DAMAGING.has(special) ? DAMAGE : 0
    edges.push([])
    sectors.push({
      // A file has no outlines to offer; the boundary below is the whole of
      // what "inside" means here.
      polygon: [],
      edges: [],
      floor: view.getInt16(at, true) / UNITS_PER_METRE,
      ceiling: view.getInt16(at + 2, true) / UNITS_PER_METRE,
      // Doom stores light 0-255. The floor keeps a dark room from going black,
      // which this renderer reads as a hole rather than as a dark room.
      light: Math.max(0.12, view.getInt16(at + 20, true) / 255),
      floorMaterial: hurt > 0 ? 'sludge' : 'floor',
      ceilingMaterial: 'ceiling',
      hurt,
      // The flat named above an outdoor room is a marker rather than a texture.
      // Every map in the original uses the same name for it.
      sky: flatName(at + 12) === SKY_FLAT,
      tag: null,
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    })
  }

  const lines: Line[] = []
  for (let i = 0; i < linedefs.size / 14; i++) {
    const at = linedefs.at + i * 14
    const [ax, ay] = vertex(view.getUint16(at, true))
    const [bx, by] = vertex(view.getUint16(at + 2, true))
    const flags = view.getUint16(at + 4, true)
    const right = view.getUint16(at + 10, true)
    const left = view.getUint16(at + 12, true)
    // 0xffff is how a WAD says "no side here". A line with no right side is
    // malformed rather than one-sided, and is skipped rather than guessed at.
    if (right === 0xffff) continue

    const front = sideSector(right)
    const back = left === 0xffff ? null : sideSector(left)
    lines.push({
      ax,
      ay,
      bx,
      by,
      front,
      back,
      material: 'wall',
      // Bit 0 is Doom's "blocks players and monsters".
      blocking: (flags & 1) !== 0,
    })
    for (const side of [front, back]) {
      if (side === null || side < 0 || side >= sectors.length) continue
      edges[side]!.push([ax, ay, bx, by])
    }
  }

  // Now the sectors can be finished: their boundary, and the box that lets a
  // point test reject most of them immediately.
  const built: Sector[] = sectors.map((sector, i) => {
    const own = edges[i]!
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [ax, ay, bx, by] of own) {
      minX = Math.min(minX, ax, bx)
      maxX = Math.max(maxX, ax, bx)
      minY = Math.min(minY, ay, by)
      maxY = Math.max(maxY, ay, by)
    }
    return { ...sector, edges: own, minX, minY, maxX, maxY }
  })

  const level: Level = { sectors: built, lines }

  let spawn: Spawn | null = null
  for (let i = 0; i < things.size / 10; i++) {
    const at = things.at + i * 10
    // Thing type 1 is where the first player starts.
    if (view.getUint16(at + 6, true) !== 1) continue
    const x = view.getInt16(at, true) / UNITS_PER_METRE
    const y = view.getInt16(at + 2, true) / UNITS_PER_METRE
    spawn = {
      x,
      y,
      // Doom's angles are degrees counter-clockwise from east, and so are this
      // engine's, so the only conversion is to radians.
      angle: (view.getInt16(at + 4, true) * Math.PI) / 180,
      sector: sectorAt(level, x, y),
    }
    break
  }

  return { name, level, spawn }
}
