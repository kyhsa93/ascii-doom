/**
 * Lines that change how bright a room is.
 *
 * Sixteen lines across eleven maps, and the smallest of the machines a map file
 * describes: no surface moves, nothing opens, and a room you have already walked
 * through is lit differently when you come back. Worth reading anyway, because
 * two of the three turn a light *on* -- a corridor a mapper left dark on purpose
 * until you crossed the line that lit it is a corridor you otherwise cross
 * blind, and this game has no torch.
 *
 * Not movers, which is why they are their own table. A mover owns a sector's
 * surface and steps it every frame toward somewhere; this happens once, to a
 * number nothing else is looking at.
 */

import type { Level, Line } from '../columns/level.ts'
import type { LineSpecial } from '../columns/wad.ts'

/**
 * What each special sets the light to.
 *
 * `brightest` means the brightest of the room's neighbours, which is the
 * original's way of saying "as lit as next door" -- it is how a mapper joins a
 * dark room to a lit one without having to name a number. The two numbers are
 * the original's own: full, and the thirty-five out of two hundred and fifty-five
 * it calls very dark.
 */
const LIGHTS = new Map<number, { to: 'brightest' | number; pressed: boolean }>([
  [12, { to: 'brightest', pressed: false }],
  [13, { to: 1, pressed: false }],
  [35, { to: 35 / 255, pressed: false }],
  // One line on one map, and the only one of these worked by pressing a wall.
  [138, { to: 1, pressed: true }],
])

/** Every special this importer reads as a light change, for checks to count against. */
export function lightSpecials(): number[] {
  return [...LIGHTS.keys()]
}

export interface LightChange {
  /** The rooms it acts on. */
  readonly sectors: readonly number[]
  /** What each is set to, worked out at import rather than when it fires. */
  readonly to: readonly number[]
  /** Whether the line is a wall you press rather than one you walk across. */
  readonly pressed: boolean
}

/**
 * Which line lights which rooms, and to what.
 *
 * The brightness is resolved here rather than when the line is crossed, because
 * "as bright as next door" has to be measured against the map as built -- once
 * another of these lines has fired, next door is no longer what the mapper meant.
 *
 * The same tag-zero lock the rest of the importer carries: zero is what the
 * format writes on an ordinary room, so one stray zero would light the whole map.
 */
export function lightsFrom(
  level: Level,
  specials: readonly LineSpecial[],
  tagged: ReadonlyMap<number, readonly number[]>,
): Map<Line, LightChange> {
  const found = new Map<Line, LightChange>()

  for (const entry of specials) {
    const found_kind = LIGHTS.get(entry.special)
    if (found_kind === undefined || entry.tag === 0) continue
    const want = found_kind.to
    const rooms = tagged.get(entry.tag)
    if (rooms === undefined || rooms.length === 0) continue

    const sectors: number[] = []
    const to: number[] = []
    for (const sector of rooms) {
      const room = level.sectors[sector]
      if (room === undefined) continue
      const value = want === 'brightest' ? brightestNeighbour(level, sector) : want
      // A change that changes nothing is not a machine, the same rule every
      // other table here applies to a door that would not move.
      if (value === null || Math.abs(value - room.light) < 1e-9) continue
      sectors.push(sector)
      to.push(value)
    }
    if (sectors.length === 0) continue
    found.set(entry.line, { sectors, to, pressed: found_kind.pressed })
  }
  return found
}

/** The brightest room sharing a line with this one, or null if it has no neighbour. */
function brightestNeighbour(level: Level, sector: number): number | null {
  let found: number | null = null
  for (const line of level.lines) {
    if (line.back === null) continue
    const other = line.front === sector ? line.back : line.back === sector ? line.front : null
    if (other === null || other === sector) continue
    const room = level.sectors[other]
    if (room === undefined) continue
    found = found === null ? room.light : Math.max(found, room.light)
  }
  return found
}
