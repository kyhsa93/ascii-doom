/**
 * The first map. Original geometry, written for this project.
 *
 * Small on purpose: a room, a corridor with a lower ceiling, a hall, and a
 * raised platform in the middle of it. Between them those four cover every
 * case the column renderer has to get right — a solid wall, a portal whose far
 * ceiling is lower (an upper step), a portal whose far floor is higher (a
 * lower step), and a sector you can see across but not immediately walk onto.
 *
 * A note for anyone adding to this. Sectors are polygons, and two sectors
 * share a wall only when they share an edge *endpoint for endpoint*. Where a
 * long wall meets several rooms it has to carry a vertex at each junction —
 * the hall's south strip below runs (14,-2) to (26,2) but its north edge is
 * written in three pieces, one per neighbour. Miss one and the wall silently
 * becomes solid, because nothing claimed the other side of it.
 *
 * On the light values. A material contributes hue and nothing else, so the
 * number below is the whole of how bright a surface can be, before distance
 * takes its share. Near 1 is an ordinary lit room; the corridor is deliberately
 * low so that walking into it feels like walking into the dark. Setting these
 * much below 0.5 puts the room in the bottom third of the character ramp,
 * where every surface picks the same two or three glyphs and the geometry
 * stops being legible — which is exactly what the first version of this file
 * did.
 */

import { buildLevel, type Level, type SectorDef } from '../columns/level.ts'
import type { MoverKind } from './movers.ts'

const WALL_HEIGHT = 3.2
const HALL_HEIGHT = 4.5

const SECTORS: SectorDef[] = [
  {
    // The room you start in.
    polygon: [
      [0, 0],
      [8, 0],
      [8, 2],
      [8, 4],
      [8, 6],
      [0, 6],
    ],
    floor: 0,
    ceiling: WALL_HEIGHT,
    light: 0.95,
    tag: 'start',
  },
  {
    // A corridor with the ceiling brought down and the light with it, so the
    // opening into it reads as a way out of the room rather than as a change
    // of wall colour.
    polygon: [
      [8, 2],
      [14, 2],
      [14, 4],
      [8, 4],
    ],
    floor: 0,
    ceiling: 2.3,
    light: 0.55,
    tag: 'corridor',
  },
  {
    // The hall, in four strips around the platform. A sector cannot have a
    // hole in it, so a room with something in the middle is a ring of rooms.
    polygon: [
      [14, -2],
      [26, -2],
      [26, 2],
      [22, 2],
      [18, 2],
      [14, 2],
    ],
    floor: 0,
    ceiling: HALL_HEIGHT,
    light: 1,
    tag: 'hall-s',
  },
  {
    // The north edge carries two extra vertices so the door beyond it has
    // something to share. A wall meeting a neighbour needs a vertex at each
    // junction, and without them this edge would silently stay solid.
    polygon: [
      [14, 6],
      [18, 6],
      [22, 6],
      [26, 6],
      [26, 10],
      [20, 10],
      [18, 10],
      [14, 10],
    ],
    floor: 0,
    ceiling: HALL_HEIGHT,
    light: 1,
    tag: 'hall-n',
  },
  {
    polygon: [
      [14, 2],
      [18, 2],
      [18, 6],
      [14, 6],
      [14, 4],
    ],
    floor: 0,
    ceiling: HALL_HEIGHT,
    light: 0.9,
    tag: 'hall-w',
  },
  {
    polygon: [
      [22, 2],
      [26, 2],
      [26, 6],
      [22, 6],
    ],
    floor: 0,
    ceiling: HALL_HEIGHT,
    light: 0.9,
    tag: 'hall-e',
  },
  {
    // The platform. Standing on it you can see across the hall; from the hall
    // floor its edge is a step you walk up.
    polygon: [
      [18, 2],
      [22, 2],
      [22, 6],
      [18, 6],
    ],
    // Low enough to walk up. The step a player can climb is a fraction of
    // their height in the original — about 43% of eye level — and this repeats
    // that, so anything taller than 0.7 here would need stairs or a lift to
    // reach rather than a walk.
    floor: 0.6,
    ceiling: HALL_HEIGHT,
    light: 1,
    tag: 'platform',
  },
  {
    // A door in the hall's north wall. Shut means its ceiling is on its floor:
    // no opening at all, which is what makes it opaque and impassable without
    // anything anywhere knowing that doors exist.
    polygon: [
      [18, 10],
      [20, 10],
      [20, 12],
      [18, 12],
    ],
    floor: 0,
    ceiling: 0,
    light: 0.5,
    tag: 'door-north',
  },
  {
    // The chamber past the door. Its north edge is split for the lift.
    polygon: [
      [16, 12],
      [18, 12],
      [20, 12],
      [24, 12],
      [24, 17],
      [22, 17],
      [18, 17],
      [16, 17],
    ],
    floor: 0,
    ceiling: 4,
    light: 0.72,
    tag: 'chamber',
  },
  {
    // The lift. Its floor rises to meet the ledge beyond, which is the only
    // way up: 1.5 is more than twice the height a body can step.
    polygon: [
      [18, 17],
      [22, 17],
      [22, 20],
      [18, 20],
    ],
    floor: 0,
    ceiling: 5,
    light: 0.9,
    tag: 'lift',
  },
  {
    polygon: [
      [18, 20],
      [22, 20],
      [22, 23],
      [18, 23],
    ],
    floor: 1.5,
    ceiling: 5,
    light: 1,
    tag: 'ledge',
  },
  {
    // The way out, past the ledge. Reaching it is the whole loop of the level:
    // the key lies in the hall, the key opens the north door, the door leads to
    // the chamber, the lift is the only way up to the ledge, and the ledge
    // opens onto this. Its south edge repeats the ledge's north edge exactly,
    // because two sectors share a wall only when they share an edge endpoint
    // for endpoint.
    polygon: [
      [18, 23],
      [22, 23],
      [22, 26],
      [18, 26],
    ],
    floor: 1.5,
    ceiling: 4,
    light: 1,
    tag: 'exit',
  },
]

export const LEVEL_1: Level = buildLevel(SECTORS)

export const SPAWN = { x: 2, y: 3, angle: 0 }

/**
 * Which sectors move, and how.
 *
 * Named by tag rather than by index, because the index is wherever a sector
 * happens to sit in the list above and inserting a room would quietly repoint
 * every door in the level.
 */
export const LEVEL_1_MOVERS: { readonly tag: string; readonly kind: MoverKind }[] = [
  {
    // A door: its ceiling sits on its floor until something opens it, then
    // lifts clear and settles back after a few seconds.
    tag: 'door-north',
    kind: { surface: 'ceiling', shut: 0, open: 2.6, speed: 2.4, wait: 4, requiresKey: 'amber' },
  },
  {
    // A lift: the same machine with the floor moving instead, and no wait, so
    // it stays where it was last sent.
    tag: 'lift',
    kind: { surface: 'floor', shut: 0, open: 1.5, speed: 1.4, wait: 0 },
  },
]

/** The index of a tagged sector, or -1. */
export function sectorIndexByTag(level: Level, tag: string): number {
  return level.sectors.findIndex((sector) => sector.tag === tag)
}
