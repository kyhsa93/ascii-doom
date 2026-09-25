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
import type { LevelDef } from './levels.ts'

export const LEVELS: readonly LevelDef[] = [LEVEL_1_DEF, LEVEL_2_DEF]
