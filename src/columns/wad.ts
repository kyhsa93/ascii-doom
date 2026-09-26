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

/**
 * Something the map places, as the file describes it.
 *
 * Reported rather than interpreted. What a type number means is a question
 * about a game, not about a file format, so the decision about what -- if
 * anything -- stands here is made a layer up.
 */
export interface WadThing {
  /** The editor number. Every map format shares these; what they mean is not. */
  readonly type: number
  readonly x: number
  readonly y: number
  readonly angle: number
  /** Which sector it stands in, or -1 for one placed outside the map. */
  readonly sector: number
  /**
   * Which skills this thing appears on: bit 0 the two easy ones, bit 1 the
   * middle one, bit 2 the two hard ones.
   *
   * Reported rather than applied, like everything else here. Which skill is
   * being played is a question about a game, and a thing that stands on one
   * skill and not another is a fact about the file.
   */
  readonly skills: number
}

/**
 * A line that does something, as the file describes it.
 *
 * Raw on purpose. Which specials are doors, which of those wait and close
 * again, and which sector a tagged one is even talking about are all questions
 * about a game; the file only says that this line carries this number. The
 * same separation the things go through.
 *
 * `back` is null for a one-sided line, which for most door specials means a
 * line that cannot be what it claims -- but saying so is not this layer's job
 * either.
 */
export interface LineSpecial {
  readonly special: number
  /** Zero means the line acts on what is behind it rather than on a tagged sector. */
  readonly tag: number
  readonly front: number
  readonly back: number | null
  /**
   * The line itself, as the renderer and the ray caster know it.
   *
   * Carried because not every special can be reduced to a sector. A door is
   * the room behind its line and an exit you walk over is the room across it,
   * but a switch is the line -- you face that piece of wall and press it, and
   * there may be nothing behind it at all.
   */
  readonly line: Line
}

/**
 * The pictures in a file, and the colours they are drawn in.
 *
 * File-wide rather than per-map: a WAD keeps its art in one run of lumps
 * between markers and every map in the file draws from the same run. Offsets
 * only -- what a picture *is* is arithmetic on bytes, and that belongs with the
 * decoder rather than here.
 */
export interface WadArt {
  /**
   * Two hundred and fifty-six colours, three bytes each.
   *
   * The first of the fourteen a file carries. The other thirteen are the
   * flashes -- taking damage, picking something up -- which this game says with
   * its own means and does not need a whole palette for.
   */
  readonly palette: Uint8Array
  /** Picture name to the byte it starts at. */
  readonly sprites: ReadonlyMap<string, number>
}

/**
 * The sprite run and the palette, or null for a file that has neither.
 *
 * Null rather than an exception: a map is perfectly readable out of a file with
 * no pictures in it, and the fixtures the checks are written against are
 * exactly that. What a caller does without art is keep its own.
 */
export function readArt(bytes: Uint8Array): WadArt | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lumps = directory(view)
  const palette = lumps.find((lump) => lump.name === 'PLAYPAL')
  if (!palette || palette.size < 768) return null

  const start = lumps.findIndex((lump) => lump.name === 'S_START')
  const end = lumps.findIndex((lump) => lump.name === 'S_END')
  if (start < 0 || end < start) return null

  const sprites = new Map<string, number>()
  for (const lump of lumps.slice(start + 1, end)) {
    // A marker has no bytes. The run also carries them, to divide it up.
    if (lump.size > 0) sprites.set(lump.name, lump.at)
  }
  if (sprites.size === 0) return null

  return { palette: bytes.subarray(palette.at, palette.at + 768), sprites }
}

export interface WadMap {
  readonly name: string
  readonly level: Level
  /** Where the first player starts, or null if the map has no start at all. */
  readonly spawn: Spawn | null
  /**
   * Everything the file places except two kinds: the player starts, and the
   * things marked for deathmatch only.
   *
   * Both exclusions are facts about the format rather than about any game. A
   * start is consumed above; bit four of a thing's flags means "multiplayer
   * only", and there are some nine hundred of those across the maps this was
   * built against. What the rest of the numbers mean is decided a layer up.
   */
  readonly things: readonly WadThing[]
  /**
   * Every line carrying a special, in the order the file lists them.
   *
   * Kept out of `Line` deliberately. Putting a special on the shared type would
   * make every level written by hand carry a field that only a file can fill,
   * for the sake of one importer.
   */
  readonly specials: readonly LineSpecial[]
  /**
   * Which sectors carry each tag.
   *
   * A tag is how the format says "somewhere else": a line names a number and
   * the rooms wearing that number are what it acts on. Doors did not need this
   * because a manual door special is untagged by definition, but nothing else
   * in the format can be reduced that way -- every lift line in these files
   * carries a tag, and eighty-three of them name more than one room.
   *
   * Zero is deliberately absent. It is what the format writes on an ordinary
   * sector, so a table containing it would answer "which rooms are tagged
   * nothing" with "most of them", and one stray zero on a line would turn a
   * whole map into machinery.
   */
  readonly tagged: ReadonlyMap<number, readonly number[]>
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
  const tagged = new Map<number, number[]>()
  for (let i = 0; i < sectorLump.size / 26; i++) {
    const at = sectorLump.at + i * 26
    const special = view.getInt16(at + 22, true)
    // Zero means untagged, and is dropped here rather than by every caller.
    const wadTag = view.getInt16(at + 24, true)
    if (wadTag !== 0) {
      const sharing = tagged.get(wadTag)
      if (sharing) sharing.push(i)
      else tagged.set(wadTag, [i])
    }
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
  const specials: LineSpecial[] = []
  for (let i = 0; i < linedefs.size / 14; i++) {
    const at = linedefs.at + i * 14
    const [ax, ay] = vertex(view.getUint16(at, true))
    const [bx, by] = vertex(view.getUint16(at + 2, true))
    const flags = view.getUint16(at + 4, true)
    const special = view.getUint16(at + 6, true)
    const tag = view.getUint16(at + 8, true)
    const right = view.getUint16(at + 10, true)
    const left = view.getUint16(at + 12, true)
    // 0xffff is how a WAD says "no side here". A line with no right side is
    // malformed rather than one-sided, and is skipped rather than guessed at.
    if (right === 0xffff) continue

    const front = sideSector(right)
    const back = left === 0xffff ? null : sideSector(left)
    const line: Line = {
      ax,
      ay,
      bx,
      by,
      front,
      back,
      material: 'wall',
      // Bit 0 is Doom's "blocks players and monsters".
      blocking: (flags & 1) !== 0,
    }
    lines.push(line)
    // The same object the renderer and the ray caster will see, so a special
    // that is about a piece of wall rather than about a room can be found by
    // what the player is facing.
    if (special !== 0) specials.push({ special, tag, front, back, line })
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
  const placed: WadThing[] = []
  for (let i = 0; i < things.size / 10; i++) {
    const at = things.at + i * 10
    const type = view.getUint16(at + 6, true)
    const flags = view.getUint16(at + 8, true)
    const x = view.getInt16(at, true) / UNITS_PER_METRE
    const y = view.getInt16(at + 2, true) / UNITS_PER_METRE
    // Doom's angles are degrees counter-clockwise from east, and so are this
    // engine's, so the only conversion is to radians.
    const angle = (view.getInt16(at + 4, true) * Math.PI) / 180

    // Thing type 1 is where the first player starts. The first one wins, and
    // the rest are skipped rather than reported: a map may carry several, and a
    // list that called itself "everything else" while holding player starts
    // would be a small lie waiting for somebody to count on it.
    if (type === 1) {
      spawn ??= { x, y, angle, sector: sectorAt(level, x, y) }
      continue
    }
    // Bit four is "this exists only in a deathmatch".
    if ((flags & 0x10) !== 0) continue
    // Bits 0 to 2 are the skills this thing shows up on. Kept raw: the mapping
    // from a skill setting to these bits belongs a layer up, with everything
    // else that decides what a number means.
    placed.push({ type, x, y, angle, sector: sectorAt(level, x, y), skills: flags & 0x07 })
  }

  return { name, level, spawn, things: placed, specials, tagged }
}
