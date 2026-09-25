/**
 * The second map. Original geometry, written for this project.
 *
 * Shaped to ask different questions from the first. That one is a corridor that
 * opens out; this one is a hub you keep coming back to, with the way on sunk
 * below the floor you arrive at. The drop into the pit is deliberately just
 * inside what a body can climb — a sector you can enter and not leave is a
 * level that has to be restarted, and the step limit is the only thing
 * standing between the two.
 *
 * The same warning as the first map applies to anyone adding to it. Two sectors
 * share a wall only when they share an edge endpoint for endpoint, so a long
 * wall meeting several rooms carries a vertex at each junction. The hub's west
 * edge is written in three pieces for that reason, and its north and south
 * edges likewise. Miss one and the wall silently becomes solid.
 */

import type { SectorDef } from '../columns/level.ts'
import type { LevelDef } from './levels.ts'
import {
  CANISTER,
  CRAWLER_KIND,
  DRIFTER_KIND,
  KEY_TOKEN,
  KIT,
  SENTRY_KIND,
  SHELL_BOX,
  SLUG_CRATE,
} from './things.ts'

const SECTORS: SectorDef[] = [
  {
    // Where you arrive. Lit, low, and with one way out.
    polygon: [
      [0, 0],
      [6, 0],
      [6, 2],
      [6, 4],
      [6, 6],
      [0, 6],
    ],
    floor: 0,
    ceiling: 3.2,
    light: 0.92,
    tag: 'entry',
  },
  {
    // A plain door, unlocked: something to open before anything is at stake.
    polygon: [
      [6, 2],
      [8, 2],
      [8, 4],
      [6, 4],
    ],
    floor: 0,
    ceiling: 0,
    light: 0.5,
    tag: 'gate',
  },
  {
    // The hub. Everything else opens off it, so it is crossed more than once.
    polygon: [
      [8, 0],
      [16, 0],
      [16, 6],
      [14, 6],
      [10, 6],
      [8, 6],
      [8, 4],
      [8, 2],
    ],
    floor: 0,
    ceiling: 4.2,
    light: 0.88,
    tag: 'hub',
  },
  {
    // The side room, bright, holding what the vault asks for.
    polygon: [
      [10, 6],
      [14, 6],
      [14, 10],
      [10, 10],
    ],
    floor: 0,
    ceiling: 3.6,
    light: 1,
    tag: 'store',
  },
  {
    // Sunk half a step below the hub: far enough to feel like a drop, near
    // enough to climb back out of. Anything deeper needs a lift.
    polygon: [
      [8, -6],
      [11, -6],
      [13, -6],
      [16, -6],
      [16, 0],
      [8, 0],
    ],
    floor: -0.6,
    ceiling: 3,
    light: 0.42,
    tag: 'pit',
  },
  {
    // The locked one. Its floor matches the room beyond rather than the pit,
    // so crossing it is the same half step back up.
    polygon: [
      [11, -8],
      [13, -8],
      [13, -6],
      [11, -6],
    ],
    floor: 0,
    ceiling: 0,
    light: 0.55,
    tag: 'vault',
  },
  {
    polygon: [
      [9, -14],
      [15, -14],
      [15, -8],
      [13, -8],
      [11, -8],
      [9, -8],
    ],
    floor: 0,
    ceiling: 3.5,
    light: 1,
    tag: 'exit',
  },
]

export const LEVEL_2_DEF: LevelDef = {
  name: 'the cistern',
  sectors: SECTORS,
  spawn: { x: 3, y: 3, angle: 0 },
  movers: [
    { tag: 'gate', kind: { surface: 'ceiling', shut: 0, open: 2.6, speed: 2.4, wait: 4 } },
    {
      tag: 'vault',
      kind: { surface: 'ceiling', shut: 0, open: 2.6, speed: 2, wait: 5, requiresKey: 'cobalt' },
    },
  ],
  actors: [
    // Waiting in the hub, facing the door you come through.
    { kind: CRAWLER_KIND, x: 12, y: 2, angle: Math.PI },
    // In the store with the key, facing the way in.
    { kind: DRIFTER_KIND, x: 12, y: 8.5, angle: -Math.PI / 2 },
    // Down in the dark, facing away: the pit is worth entering carefully.
    { kind: SENTRY_KIND, x: 10, y: -3, angle: Math.PI / 2 },
    { kind: CRAWLER_KIND, x: 14, y: -4, angle: Math.PI / 2 },
  ],
  pickups: [
    { x: 2, y: 5, z: 0, light: 0.92, sprite: KIT, grant: { kind: 'health', amount: 25 }, radius: 0.4, taken: false },
    {
      x: 14.5,
      y: 1.5,
      z: 0,
      light: 0.88,
      sprite: CANISTER,
      grant: { kind: 'ammo', weapon: 0, amount: 20 },
      radius: 0.4,
      taken: false,
    },
    {
      x: 11,
      y: 9,
      z: 0,
      light: 1,
      sprite: SHELL_BOX,
      grant: { kind: 'ammo', weapon: 1, amount: 10 },
      radius: 0.4,
      taken: false,
    },
    {
      // The key, in the store and past whatever is guarding it.
      x: 13,
      y: 9,
      z: 0,
      light: 1,
      sprite: KEY_TOKEN,
      grant: { kind: 'key', key: 'cobalt' },
      radius: 0.5,
      taken: false,
    },
    {
      // Slugs in the pit, which is where they are wanted.
      x: 9.5,
      y: -5,
      z: -0.6,
      light: 0.42,
      sprite: SLUG_CRATE,
      grant: { kind: 'ammo', weapon: 2, amount: 8 },
      radius: 0.4,
      taken: false,
    },
  ],
  exitTag: 'exit',
}
