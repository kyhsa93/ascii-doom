/**
 * The levels, in order.
 *
 * A module of its own because of which way the imports have to point. A level
 * definition needs the `LevelDef` type from `levels.ts`, so `levels.ts` cannot
 * turn round and import the levels to list them without making a cycle — and a
 * cycle between modules that export constants is not a compile error, it is an
 * `undefined` at import time that shows up as an empty map.
 *
 * So the list lives downstream of both: it knows about the levels and the
 * levels know nothing about it.
 */

import { LEVEL_1_DEF } from './level1.ts'
import { LEVEL_2_DEF } from './level2.ts'
import { loadLevel, type LevelDef, type LevelState } from './levels.ts'
import type { Carrier } from './pickups.ts'

export const LEVELS: readonly LevelDef[] = [LEVEL_1_DEF, LEVEL_2_DEF]

/** The level after this one, or null at the end of the campaign. */
export function nextLevel(index: number): number | null {
  return index + 1 < LEVELS.length ? index + 1 : null
}

/**
 * Starts a level, and decides what the player brings into it.
 *
 * Here rather than in the page for the reason the status line and the summary
 * layout are: a rule that lives inside the frame loop is a rule nothing can
 * check. This one had been a single line in `main.ts`, which is also the
 * newest and least examined code in the project.
 *
 * Health and ammunition carry over; keys do not. Each level hides the key to
 * its own doors, and one brought forward would open something it was never
 * meant to — which would also quietly falsify the check that every lock has a
 * key in the same level, since that check assumes you arrive with none.
 */
export function startLevel(index: number, carrier: Carrier): LevelState {
  carrier.keys.clear()
  return loadLevel(levelOrThrow(index))
}

/**
 * What a run begins with.
 *
 * Here rather than written out in the page because death gives it back, so two
 * places need to agree about what "a full kit" is. A loadout that lives in the
 * frame loop is also a loadout nothing can check.
 */
export const STARTING_HEALTH = 100
export const STARTING_AMMO: readonly number[] = [60, 24, 8]
export const AMMO_CAPACITY: readonly number[] = [120, 48, 24]

export function freshCarrier(): Carrier {
  return {
    health: STARTING_HEALTH,
    maxHealth: STARTING_HEALTH,
    // Copied: the carrier spends its ammunition, and spending it out of the
    // constant would leave the next run starting on whatever the last one had.
    ammo: [...STARTING_AMMO],
    ammoMax: AMMO_CAPACITY,
    keys: new Set<string>(),
  }
}

/**
 * Whether the run is over.
 *
 * A function rather than `health <= 0` written wherever it is needed, because
 * it was needed in three places the moment dying existed at all: the step that
 * stops, the frame that draws the panel, and the check that asks.
 */
export function isDead(carrier: Carrier): boolean {
  return carrier.health <= 0
}

/**
 * Starts the level over, after dying in it.
 *
 * The opposite of `startLevel` in what it does to the carrier. Moving on is a
 * reward and keeps what you earned; dying is not, and hands back the kit you
 * began with. Both clear the keys, for the same reason: the level hides its
 * own, and the copy you are holding came from a map that no longer exists.
 *
 * The index is the level you died in, not the start of the campaign. Losing an
 * hour of progress to one bad room is the version of this rule nobody enjoys.
 */
export function restartLevel(index: number, carrier: Carrier): LevelState {
  const def = levelOrThrow(index)
  carrier.health = STARTING_HEALTH
  carrier.ammo = [...STARTING_AMMO]
  carrier.keys.clear()
  return loadLevel(def)
}

function levelOrThrow(index: number): LevelDef {
  const def = LEVELS[index]
  if (!def) throw new Error(`no level ${index}; the campaign has ${LEVELS.length}`)
  return def
}
