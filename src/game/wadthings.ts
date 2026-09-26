/**
 * What stands where a map from a file says something stood.
 *
 * A WAD gives a position and a number. The number is a fact about the format --
 * every map editor ever written agrees on them -- but what it *means* is a
 * fact about a game, which is why this lives here and not in the parser.
 *
 * Nothing of the original's is reproduced. The creatures that appear are this
 * project's own, with this project's own art, and the mapping below is a
 * grouping by weight rather than a re-creation: the file says "something of
 * about this size was here", and one of three creatures written for this game
 * stands there instead. There is no attempt to match a name, a look, or a
 * behaviour beyond how heavy the thing was.
 *
 * A whitelist, deliberately. There are a hundred and twenty-one distinct thing
 * types across the maps this was built against, and most of them are supplies,
 * scenery, and markers for things this game has no notion of. Anything not
 * named here simply does not appear, which is the right failure: a map missing
 * a lamp is a map, and a map with a lamp standing in it swinging at you is not.
 */

import type { ActorKind } from './ai.ts'
import { CRAWLER_KIND, DRIFTER_KIND, SENTRY_KIND } from './things.ts'

/**
 * The commonest small ones -- the things a map puts in the way rather than in
 * your path. Fast, weak, and there are a lot of them.
 */
const LIGHT = [
  3004, // by far the commonest humanoid in both files
  3006, // the small flying one
  9, // the slightly tougher humanoid
]

/**
 * The ones that do not have to reach you. This game has exactly one creature
 * that throws, so everything that fought at a distance becomes it.
 */
const THROWERS = [
  3001, // the commonest of all, at three and a half thousand placements
  3005, // the large floating one
  65,
  66,
  71,
  64,
]

/** The heavy ones, which in this game means slow, tough, and hits hard. */
const HEAVY = [
  3002,
  58, // the same shape, drawn differently in the original
  69,
  3003,
  67,
  68,
  16,
  7,
]

/**
 * What the file calls each one's picture.
 *
 * Four letters, which is how every sprite lump in the format is named. This is
 * the second place in the importers to rest on knowledge about a game rather
 * than on something in the file -- and unlike the key colours, it was checked
 * against the files themselves rather than trusted: all seventeen resolve, and
 * the seven at the end resolve only in the second file, because they are the
 * later game's and the first one never had them.
 *
 * A name that resolves to nothing costs nothing. The creature still stands
 * there in this project's own art, which is what every creature did before any
 * of this, so a file with no pictures in it plays exactly as it used to.
 */
const PICTURE = new Map<number, string>([
  [3004, 'POSS'],
  [3006, 'SKUL'],
  [9, 'SPOS'],
  [3001, 'TROO'],
  [3005, 'HEAD'],
  [3002, 'SARG'],
  [58, 'SARG'],
  [3003, 'BOSS'],
  [16, 'CYBR'],
  [7, 'SPID'],
  // Only in the second file.
  [65, 'CPOS'],
  [66, 'SKEL'],
  [71, 'PAIN'],
  [64, 'VILE'],
  [69, 'BOS2'],
  [67, 'FATT'],
  [68, 'BSPI'],
])

/** What this thing's picture is called in a file, or null if nothing is known. */
export function creaturePictureFor(type: number): string | null {
  return PICTURE.get(type) ?? null
}

const BY_TYPE = new Map<number, ActorKind>([
  ...LIGHT.map((type) => [type, CRAWLER_KIND] as const),
  ...THROWERS.map((type) => [type, DRIFTER_KIND] as const),
  ...HEAVY.map((type) => [type, SENTRY_KIND] as const),
])

/** Which creature stands here, or null for a number this game has no answer for. */
export function creatureFor(type: number): ActorKind | null {
  return BY_TYPE.get(type) ?? null
}

/** Every thing type that puts a creature on the map, for checks to count against. */
export function creatureTypes(): number[] {
  return [...BY_TYPE.keys()]
}
