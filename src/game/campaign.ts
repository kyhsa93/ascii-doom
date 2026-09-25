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
  const def = LEVELS[index]
  if (!def) throw new Error(`no level ${index}; the campaign has ${LEVELS.length}`)
  carrier.keys.clear()
  return loadLevel(def)
}
