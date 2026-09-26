/**
 * What stands where a map from a file says something stood.
 *
 * A WAD gives a position and a number. The number is a fact about the format --
 * every map editor ever written agrees on them -- but what it *means* is a
 * fact about a game, which is why this lives here and not in the parser.
 *
 * The mapping is a grouping by weight rather than a re-creation: the file says
 * "something of about this size was here", and one of three creatures written
 * for this game stands there instead, with that creature's behaviour. What it
 * looks like is Freedoom's picture for that number -- baked in, or read out of
 * the file if the one you opened has its own. Nothing of a commercial game's is
 * reproduced, and no behaviour is copied from anywhere.
 *
 * A whitelist, deliberately. There are a hundred and twenty-one distinct thing
 * types across the maps this was built against, and most of them are supplies,
 * scenery, and markers for things this game has no notion of. Anything not
 * named here simply does not appear, which is the right failure: a map missing
 * a lamp is a map, and a map with a lamp standing in it swinging at you is not.
 */

import type { ActorKind } from './ai.ts'
import {
  BARREL_KIND,
  CRAWLER_KIND,
  DRIFTER_KIND,
  EMBER_KIND,
  FLOATER_KIND,
  GUNMAN_KIND,
  SENTRY_KIND,
  SHOOTER_KIND,
} from './things.ts'

/**
 * The commonest small ones -- the things a map puts in the way rather than in
 * your path. Fast, weak, and there are a lot of them.
 */
const LIGHT: number[] = []

/**
 * The ones that do not touch the ground.
 *
 * Seven hundred and forty-three of the bodies a normal game meets, and every
 * one of them used to stand on the floor: the big floating one filed with the
 * things that throw, the charging skull with the things that scuttle. They are
 * the same fights at a different height, which is most of what made them
 * memorable -- a skull comes at your face and a cacodemon looks over what a
 * walking creature would hide behind.
 */
const FLOATERS = [
  3005, // the big one that throws
  71, // the one that spawns them, which floats the same way
]
const CHARGERS = [3006]

/**
 * The ones that carry a rifle.
 *
 * 3004 is the commonest humanoid in both files at two thousand four hundred
 * placements, and it was arriving as something that charges you. Counting what
 * these files hold settled it: ten thousand of the bodies attack at a distance
 * and fewer than fifteen hundred only bite, and four thousand eight hundred of
 * those are hitscanners.
 */
const RIFLES = [
  3004,
  65, // the one that fires a stream in the original; a rifle here
  7, // and the largest of them, which this game has no boss for
]

/** And the one with a shotgun, which is two thousand more. */
const SHOTGUNS = [9]

/**
 * The ones that do not have to reach you. This game has exactly one creature
 * that throws, so everything that fought at a distance becomes it.
 */
const THROWERS = [
  3001, // the commonest of all, at three and a half thousand placements
  65,
  66,
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
 * there in the art baked into the game, so a file with no pictures in it looks
 * exactly like the campaign does.
 */
const PICTURE = new Map<number, string>([
  [2035, 'BAR1'],
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

/**
 * The barrel, which is a body rather than a creature.
 *
 * Five hundred and ninety-seven across the two files on thirty-eight maps, and
 * half of those stand within three metres of another -- the chain is what the
 * maps are built around rather than a flourish. It arrives through the creature
 * table because a barrel is a body with health as far as everything here is
 * concerned; what makes it a barrel is that it goes off when it dies.
 */
const BARRELS = [2035]

const BY_TYPE = new Map<number, ActorKind>([
  ...BARRELS.map((type) => [type, BARREL_KIND] as const),
  ...LIGHT.map((type) => [type, CRAWLER_KIND] as const),
  ...FLOATERS.map((type) => [type, FLOATER_KIND] as const),
  ...CHARGERS.map((type) => [type, EMBER_KIND] as const),
  ...RIFLES.map((type) => [type, SHOOTER_KIND] as const),
  ...SHOTGUNS.map((type) => [type, GUNMAN_KIND] as const),
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
