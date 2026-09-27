/**
 * The machinery on the last map, which is the only thing a map file places that
 * this importer had no answer for.
 *
 * Nineteen things across three maps, and the smallest count in the whole file --
 * which is exactly why they were last and why they are worth doing: they are the
 * end of the second campaign, and a map whose ending is unread is a map you
 * cannot finish.
 *
 * Four numbers, and the original's own table says what each is. Two can be shot
 * and two cannot be seen:
 *
 *   88 is a brain, solid and shootable with two hundred and fifty health.
 *   72 is the hanging thing that counts as a kill, a hundred health.
 *   89 is where the cubes are spat from, invisible.
 *   87 is where they land, invisible, and a map scatters ten of them.
 *
 * What it amounts to in play: something you cannot reach keeps throwing monsters
 * into the room at the marked spots, and the way out opens when every shootable
 * one of these is dead. The original dresses that up with a cube you can watch
 * fly; this spawns at the spot, because a cube is a projectile whose only job is
 * to be looked at and the room is already full of things to look at.
 */

import type { ActorKind } from './ai.ts'
import { BOSS_BRAIN, HANGING_KEEN } from './freedoomart.ts'
import { atHeight } from '../columns/bakedart.ts'
import type { WadThing } from '../columns/wad.ts'
import { PIXELS_PER_METRE } from './waddecor.ts'
import { PIXEL_HEIGHT } from './freedoomart.ts'

/**
 * The tag the original opens when the last of these is dead.
 *
 * Six hundred and sixty-six, which is a number in the format rather than a joke:
 * a mapper who wants a wall to fall when the boss dies gives the room that tag.
 */
export const BOSS_TAG = 666

/**
 * The brain, which is a creature that cannot move and does not want to.
 *
 * Health and the fact that it can be shot are the original's; everything else is
 * chosen to make it a target rather than a fight -- no reach, no gun, no speed.
 * It is the thing in the room that the room is about.
 */
export const BOSS_BRAIN_KIND: ActorKind = {
  name: 'brain',
  sprite: atHeight(BOSS_BRAIN, PIXEL_HEIGHT.BOSS_BRAIN! / PIXELS_PER_METRE),
  corpse: atHeight(BOSS_BRAIN, PIXEL_HEIGHT.BOSS_BRAIN! / PIXELS_PER_METRE),
  radius: 0.62,
  height: PIXEL_HEIGHT.BOSS_BRAIN! / PIXELS_PER_METRE,
  eye: 0.6,
  health: 250,
  speed: 0,
  sightRange: 0,
  reach: 0,
  damage: 0,
  windUp: 0,
  recovery: 1,
  painTime: 0.1,
  painChance: 0,
  deathTime: 1.2,
}

/** The hanging one, which is the same idea at a hundred health. */
export const HANGING_TARGET_KIND: ActorKind = {
  name: 'hanging target',
  sprite: atHeight(HANGING_KEEN, PIXEL_HEIGHT.HANGING_KEEN! / PIXELS_PER_METRE),
  corpse: atHeight(HANGING_KEEN, PIXEL_HEIGHT.HANGING_KEEN! / PIXELS_PER_METRE),
  radius: 0.62,
  height: PIXEL_HEIGHT.HANGING_KEEN! / PIXELS_PER_METRE,
  eye: 0.6,
  health: 100,
  speed: 0,
  sightRange: 0,
  reach: 0,
  damage: 0,
  windUp: 0,
  recovery: 1,
  painTime: 0.1,
  painChance: 255 / 255,
  deathTime: 1.2,
}

/** The two thing numbers that arrive as something you can shoot. */
export function bossKindFor(type: number): ActorKind | null {
  if (type === 88) return BOSS_BRAIN_KIND
  if (type === 72) return HANGING_TARGET_KIND
  return null
}

/** Whether this creature is one whose death opens the way out. */
export function isBossTarget(kind: ActorKind): boolean {
  return kind === BOSS_BRAIN_KIND || kind === HANGING_TARGET_KIND
}

export interface BossRoom {
  /**
   * Where a spawn lands, in map units. Empty on every map but the last.
   *
   * Invisible in the original and invisible here: the thing is a marker, and a
   * marker you can see is a marker in the way.
   */
  readonly spots: readonly { readonly x: number; readonly y: number; readonly sector: number }[]
  /** Whether the map has something throwing them, which is what starts the clock. */
  readonly spits: boolean
}

/**
 * The boss room a map's things describe.
 *
 * Both halves are needed or neither is: spots with nothing spitting at them are
 * ten invisible markers, and a spitter with nowhere to aim has nothing to do.
 */
export function bossRoomFrom(things: readonly WadThing[]): BossRoom {
  const spots = things
    .filter((thing) => thing.type === 87 && thing.sector >= 0)
    .map((thing) => ({ x: thing.x, y: thing.y, sector: thing.sector }))
  const spits = things.some((thing) => thing.type === 89)
  return { spots, spits }
}
