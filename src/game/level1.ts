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
    polygon: [
      [14, 6],
      [18, 6],
      [22, 6],
      [26, 6],
      [26, 10],
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
]

export const LEVEL_1: Level = buildLevel(SECTORS)

export const SPAWN = { x: 2, y: 3, angle: 0 }
