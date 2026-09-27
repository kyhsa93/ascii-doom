/**
 * The furniture, and how big each piece of it is.
 *
 * Three thousand nine hundred things across the sixty-eight maps this game can
 * open, and none of them was anything: lamps, pillars, trees, torches, corpses
 * and the bodies that hang from ceilings all came through the importer as
 * numbers it had no answer for, so a room the map had furnished came out bare.
 *
 * Which number is which picture, whether you can walk through it and whether it
 * hangs are read out of the original's own table rather than recalled --
 * `doomednum`, the spawn state's sprite, `MF_SOLID` and `MF_SPAWNCEILING`. That
 * is the one thing in this file that is not a judgement.
 *
 * The sizes are a judgement, and worth being plain about. Every picture in this
 * project was given its height by eye, and those choices amount to anywhere
 * between twenty-two and seventy-six pixels of artwork per metre of world -- a
 * factor of three, measured. There is no existing scale to match. So these are
 * sized by one rule at the median of it, which makes them right about each other
 * even where they are not right about a trooper: a candle comes out at knee
 * height, a floor lamp at chest height, a tree at three metres, and the corpses
 * land within a hand's breadth of the heights given to the creatures they are
 * corpses of.
 */

import { atHeight, atWidth } from '../columns/bakedart.ts'
import type { Sprite } from '../columns/sprite.ts'
import {
  BIG_TREE,
  BLOOD_POOL,
  BLOOD_POOL_WIDE,
  BLUE_TORCH,
  BRAIN_POOL,
  BURNING_BARREL,
  BURNT_TREE,
  CANDELABRA,
  CANDLE,
  EVIL_EYE,
  FLESH_POOL,
  FLOATER,
  FLOATER_DOWN,
  FLOATING_SKULL,
  FLOOR_LAMP,
  GREEN_TORCH,
  GUNNER,
  GUNNER_DOWN,
  HANGING_ARMS_OUT,
  HANGING_BODY,
  HANGING_GUTTED,
  HANGING_GUTTED_OPEN,
  HANGING_LEG,
  HANGING_ONE_LEG,
  HANGING_TORSO,
  HANGING_TORSO_DOWN,
  HANGING_TORSO_OPEN,
  HANGING_TORSO_SPLIT,
  HANGING_TWITCHING,
  HEART_PILLAR,
  HOUND,
  HOUND_DOWN,
  IMP,
  IMPALED_BODY,
  IMP_DOWN,
  MARINE,
  MARINE_DOWN,
  RED_TORCH,
  SHORT_BLUE_TORCH,
  SHORT_GREEN_PILLAR,
  SHORT_GREEN_TORCH,
  SHORT_LAMP,
  SHORT_RED_PILLAR,
  SHORT_RED_TORCH,
  SKULL_KEBAB,
  SKULL_ON_POLE,
  SKULL_PILE,
  SKULL_PILLAR,
  STALAGMITE,
  TALL_GREEN_PILLAR,
  TALL_LAMP,
  TALL_RED_PILLAR,
  TECHNO_COLUMN,
  TROOPER,
  TROOPER_DOWN,
  TWITCHING_BODY,
} from './freedoomart.ts'

/**
 * Pixels of artwork per metre of world, for the things sized by this file.
 *
 * The median of what this game's supplies already amount to. A constant rather
 * than fifty numbers chosen one at a time, because fifty choices by eye is fifty
 * chances to make a candle taller than a pillar.
 */
export const PIXELS_PER_METRE = 42

/** One piece of furniture, ready to be drawn where a map puts it. */
export interface Decor {
  readonly x: number
  readonly y: number
  /** Where the bottom of the picture sits, in world height. */
  readonly z: number
  readonly light: number
  readonly sprite: Sprite
  /**
   * How far out it pushes a body, or zero for something you walk through.
   *
   * Taken from how wide the picture is drawn rather than from the original's
   * collision box. That box is sixteen or twenty map units whatever the thing
   * looks like, and those units are not this game's -- a pillar carrying its
   * original radius would stop you a stride short of a pillar half that wide.
   * Half the drawn width means you stop where it looks like you should.
   */
  readonly radius: number
}

interface DecorKind {
  readonly sprite: Sprite
  readonly solid: boolean
  /** Hung from the ceiling rather than stood on the floor. */
  readonly hangs: boolean
}

function kind(art: Sprite, pixels: number, solid: boolean, hangs: boolean): DecorKind {
  return { sprite: atHeight(art, pixels / PIXELS_PER_METRE), solid, hangs }
}

/**
 * A corpse, which is a creature's own fallen frame at the width it stood at.
 *
 * Fitted to a width rather than a height for the reason the importer fits the
 * creatures' corpses that way: the fallen picture is flatter, so the same height
 * across a shorter picture is a narrower one, and a body that gets thinner as it
 * hits the floor reads as one walking away. None of these is solid -- you walk
 * over a body in the original too -- so no radius question arises.
 */
function fallen(standing: Sprite, down: Sprite, pixels: number): DecorKind {
  return { sprite: atWidth(down, atHeight(standing, pixels / PIXELS_PER_METRE).width), solid: false, hangs: false }
}

/*
 * Every number, with what the maps place of it.
 *
 * Kept in placement order, commonest first, so the counts say what each row is
 * worth: the floor lamp alone is five hundred of them and the last rows are one
 * or two each.
 *
 * Five of the corpses cost nothing at all -- a dead trooper is the trooper's own
 * fallen frame, which has been baked since creatures arrived.
 */
const DECOR = new Map<number, DecorKind>([
  [2028, kind(FLOOR_LAMP, 48, true, false)], // COLU, 505 of them
  [15, fallen(MARINE, MARINE_DOWN, 56)], // PLAY, 300 of them
  [47, kind(STALAGMITE, 69, true, false)], // SMIT, 299 of them
  [43, kind(BURNT_TREE, 70, true, false)], // TRE1, 265 of them
  [34, kind(CANDLE, 19, false, false)], // CAND, 253 of them
  [54, kind(BIG_TREE, 124, true, false)], // TRE2, 224 of them
  [48, kind(TECHNO_COLUMN, 128, true, false)], // ELEC, 219 of them
  [10, fallen(MARINE, MARINE_DOWN, 56)], // PLAY, 120 of them
  [57, kind(SHORT_RED_TORCH, 66, true, false)], // SMRT, 117 of them
  [24, kind(FLESH_POOL, 10, false, false)], // POL5, 113 of them
  [35, kind(CANDELABRA, 61, true, false)], // CBRA, 97 of them
  [46, kind(RED_TORCH, 90, true, false)], // TRED, 87 of them
  [86, kind(SHORT_LAMP, 57, true, false)], // TLP2, 81 of them
  [18, fallen(TROOPER, TROOPER_DOWN, 57)], // POSS, 79 of them
  [80, kind(BLOOD_POOL_WIDE, 3, false, false)], // POB2, 76 of them
  [45, kind(GREEN_TORCH, 99, true, false)], // TGRN, 72 of them
  [20, fallen(IMP, IMP_DOWN, 60)], // TROO, 64 of them
  [12, fallen(MARINE, MARINE_DOWN, 56)], // PLAY, 58 of them
  [21, fallen(HOUND, HOUND_DOWN, 59)], // SARG, 49 of them
  [19, fallen(GUNNER, GUNNER_DOWN, 55)], // SPOS, 46 of them
  [42, kind(FLOATING_SKULL, 39, true, false)], // FSKU, 45 of them
  [60, kind(HANGING_ONE_LEG, 48, false, true)], // GOR4, 41 of them
  [29, kind(SKULL_PILE, 48, true, false)], // POL3, 41 of them
  [26, kind(TWITCHING_BODY, 66, true, false)], // POL6, 40 of them
  [79, kind(BLOOD_POOL, 10, false, false)], // POB1, 33 of them
  [41, kind(EVIL_EYE, 43, true, false)], // CEYE, 32 of them
  [63, kind(HANGING_TWITCHING, 70, false, true)], // GOR1, 31 of them
  [85, kind(TALL_LAMP, 80, true, false)], // TLMP, 31 of them
  [32, kind(TALL_RED_PILLAR, 55, true, false)], // COL3, 30 of them
  [33, kind(SHORT_RED_PILLAR, 43, true, false)], // COL4, 30 of them
  [25, kind(IMPALED_BODY, 66, true, false)], // POL1, 30 of them
  [28, kind(SKULL_KEBAB, 67, true, false)], // POL2, 29 of them
  [27, kind(SKULL_ON_POLE, 56, true, false)], // POL4, 29 of them
  [56, kind(SHORT_GREEN_TORCH, 75, true, false)], // SMGT, 26 of them
  [59, kind(HANGING_ARMS_OUT, 55, false, true)], // GOR2, 26 of them
  [70, kind(BURNING_BARREL, 63, true, false)], // FCAN, 26 of them
  [44, kind(BLUE_TORCH, 94, true, false)], // TBLU, 25 of them
  [62, kind(HANGING_LEG, 72, false, true)], // GOR5, 25 of them
  [22, fallen(FLOATER, FLOATER_DOWN, 66)], // HEAD, 24 of them
  [36, kind(HEART_PILLAR, 49, true, false)], // COL5, 22 of them
  [55, kind(SHORT_BLUE_TORCH, 70, true, false)], // SMBT, 20 of them
  [81, kind(BRAIN_POOL, 10, false, false)], // BRS1, 20 of them
  [30, kind(TALL_GREEN_PILLAR, 56, true, false)], // COL1, 14 of them
  [37, kind(SKULL_PILLAR, 55, true, false)], // COL6, 14 of them
  [31, kind(SHORT_GREEN_PILLAR, 41, true, false)], // COL2, 13 of them
  [76, fallen(HANGING_TORSO, HANGING_TORSO_DOWN, 64)], // HDB4, 12 of them
  [61, kind(HANGING_BODY, 51, false, true)], // GOR3, 11 of them
  [73, kind(HANGING_GUTTED, 88, true, true)], // HDB1, 10 of them
  [74, kind(HANGING_GUTTED_OPEN, 85, true, true)], // HDB2, 9 of them
  [77, kind(HANGING_TORSO_OPEN, 57, true, true)], // HDB5, 9 of them
  [51, kind(HANGING_BODY, 51, true, true)], // GOR3, 8 of them
  [78, kind(HANGING_TORSO_SPLIT, 61, true, true)], // HDB6, 7 of them
  [53, kind(HANGING_LEG, 72, true, true)], // GOR5, 5 of them
  [75, kind(HANGING_TORSO, 64, true, true)], // HDB3, 4 of them
  [49, kind(HANGING_TWITCHING, 70, true, true)], // GOR1, 2 of them
  [50, kind(HANGING_ARMS_OUT, 55, true, true)], // GOR2, 1 of them
  [52, kind(HANGING_ONE_LEG, 48, true, true)], // GOR4, 1 of them
])

/** What stands where a map puts a thing of this type, or null for one to ignore. */
export function decorFor(type: number): DecorKind | null {
  return DECOR.get(type) ?? null
}

/**
 * Puts one piece where the map says, given the room it is in.
 *
 * The ceiling is needed because a third of these hang from it, and a hung body
 * whose height is measured from the floor is a body lying on the floor.
 */
export function placeDecor(
  found: DecorKind,
  x: number,
  y: number,
  floor: number,
  ceiling: number,
  light: number,
): Decor {
  const z = found.hangs ? ceiling - found.sprite.height : floor
  return { x, y, z, light, sprite: found.sprite, radius: found.solid ? found.sprite.width / 2 : 0 }
}

/** Every thing type that leaves furniture behind, for checks to count against. */
export function decorTypes(): number[] {
  return [...DECOR.keys()]
}
