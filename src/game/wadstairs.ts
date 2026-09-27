/**
 * Lines that build a staircase out of a run of rooms.
 *
 * Fifteen lines on eight maps, and the only machine a map describes that is not
 * one room doing one thing: the tagged room rises by a step, the room next door
 * that shares its floor rises by two, the one after that by three, and so on
 * until the chain runs out. What it makes is a way up out of a floor that was
 * flat -- so a line unread here is not a door that stays shut, it is a pit with
 * no way out of it.
 *
 * The chain is followed the way the original follows it: from each room in turn,
 * across each of its lines, to the room on the far side, and only if that room's
 * floor is made of the same thing. That last condition is what stops a staircase
 * from swallowing the hall it climbs out of -- without it the flood reaches every
 * room in the map and raises all of them, which is what the first version of
 * this did on MAP12 before the material test went in.
 */

import type { Level, Line } from '../columns/level.ts'
import type { LineSpecial } from '../columns/wad.ts'
import { makeMover, type Mover } from './movers.ts'
import { UNITS_PER_METRE } from '../columns/wad.ts'

/**
 * How high each step is, and how fast it climbs.
 *
 * Eight map units and sixteen are the original's two sizes, which at this game's
 * scale are a shallow step and a steep one. Read off the original rather than
 * chosen, because a staircase is one of the few things in a map where the number
 * is load-bearing: too tall and the steps are a wall, too short and they are a
 * ramp you cannot see.
 */
const RISES = new Map<number, { rise: number; fast: boolean; pressed: boolean }>([
  [7, { rise: 8, fast: false, pressed: true }],
  [8, { rise: 8, fast: false, pressed: false }],
  [127, { rise: 16, fast: true, pressed: true }],
  // One line on one map, and the same staircase crossed rather than pressed.
  [100, { rise: 16, fast: true, pressed: false }],
])

/** Every special this importer builds stairs from, for checks to count against. */
export function stairSpecials(): number[] {
  return [...RISES.keys()]
}

const SPEED = 1.1
const FAST_SPEED = 3.3

export interface Stairs {
  /** One mover per step, in the order the chain was followed. */
  readonly movers: Mover[]
  /** Lines that build them when pressed. */
  readonly pressed: Map<Line, readonly Mover[]>
  /** And lines that build them when crossed. */
  readonly crossed: Map<Line, readonly Mover[]>
}

/**
 * The staircases a map's lines describe.
 *
 * `owned` is every sector another machine already has. A room being dragged by
 * two machines at once is dragged in turn by both, which looks like a floor
 * shaking; the staircase yields, because a lift or a floor special names one room
 * deliberately and a staircase reaches this one by following a chain.
 */
export function stairsFrom(
  level: Level,
  specials: readonly LineSpecial[],
  tagged: ReadonlyMap<number, readonly number[]>,
  owned: ReadonlySet<number>,
): Stairs {
  const movers: Mover[] = []
  const pressed = new Map<Line, readonly Mover[]>()
  const crossed = new Map<Line, readonly Mover[]>()
  const claimed = new Set<number>(owned)

  for (const entry of specials) {
    const kind = RISES.get(entry.special)
    if (kind === undefined || entry.tag === 0) continue

    const built: Mover[] = []
    for (const first of tagged.get(entry.tag) ?? []) {
      if (claimed.has(first)) continue
      const run = chainFrom(level, first, claimed)
      const rise = kind.rise / UNITS_PER_METRE
      for (let step = 0; step < run.length; step++) {
        const sector = run[step]!
        const room = level.sectors[sector]
        if (room === undefined) continue
        claimed.add(sector)
        built.push(
          makeMover(sector, {
            surface: 'floor',
            shut: room.floor,
            // Each step in the chain rises one more than the one before it, which
            // is what turns a run of flat rooms into stairs rather than into a
            // single raised slab.
            open: room.floor + rise * (step + 1),
            speed: kind.fast ? FAST_SPEED : SPEED,
            wait: 0,
          }),
        )
      }
    }
    if (built.length === 0) continue
    movers.push(...built)
    const into = kind.pressed ? pressed : crossed
    into.set(entry.line, [...(into.get(entry.line) ?? []), ...built])
  }

  return { movers, pressed, crossed }
}

/**
 * The run of rooms a staircase climbs through, starting at this one.
 *
 * Followed one room at a time rather than all at once: the original takes the
 * *first* line of the room it is standing in whose far side matches, moves there
 * and starts again, so a room with two matching neighbours builds one staircase
 * and not two. Breadth-first would fan out into both and raise a floor twice.
 */
function chainFrom(level: Level, first: number, claimed: ReadonlySet<number>): number[] {
  const run = [first]
  const seen = new Set<number>([first])
  let at = first

  // Bounded by the rooms in the map, because a chain that comes back on itself
  // would otherwise be a loop rather than a staircase. `seen` makes that
  // impossible, and this is the belt to its braces.
  for (let step = 0; step < level.sectors.length; step++) {
    const here = level.sectors[at]
    if (here === undefined) break
    let next: number | null = null
    for (const line of level.lines) {
      if (line.back === null) continue
      const other = line.front === at ? line.back : line.back === at ? line.front : null
      if (other === null || other === at) continue
      if (seen.has(other) || claimed.has(other)) continue
      const room = level.sectors[other]
      if (room === undefined) continue
      if (room.floorMaterial !== here.floorMaterial) continue
      next = other
      break
    }
    if (next === null) break
    run.push(next)
    seen.add(next)
    at = next
  }
  return run
}
