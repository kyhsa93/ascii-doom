/**
 * What stands in the level besides walls. Original designs, drawn for this
 * project.
 *
 * Art here rather than in `src/columns/`, because a sprite's shape is a thing
 * you judge by looking at it and the renderer beneath it is a thing you check
 * with arithmetic. Same split as everywhere else in this repository.
 *
 * On the size of these. The first set was drawn at four rows tall, on the
 * theory that a character grid wants tiny art. Measured, that art only reached
 * one character per cell at ten to twelve units away, and a creature is
 * usually met between one and eight — so almost every time one was on screen
 * it was being magnified three to twelve times, and a magnified character grid
 * does not blur, it repeats. Rows came out as LLLL and vvvvvv.
 *
 * So these are drawn about three times larger, sized to land at roughly one
 * art cell per screen cell at four units, which is where a creature is when it
 * matters. Past that they shrink, and shrinking a grid of characters drops
 * detail gracefully rather than smearing it. The check in `scripts/check.ts`
 * holds them to it.
 */

import type { Billboard, Sprite } from '../columns/sprite.ts'
import type { ActorKind } from './ai.ts'

/**
 * A crawler: low and wide, weight forward on two heavy forelimbs.
 *
 * The widest row is the shoulders, which is what separates it at a glance from
 * the upright sentry even when both are a dozen cells across.
 */
export const CRAWLER: Sprite = {
  rows: [
    '        .-~~~~-.        ',
    "      .'  o  o  '.      ",
    '     /   \\____/   \\     ',
    "    |  .-'    '-.  |    ",
    '    \\_/  ______  \\_/    ',
    '     |  /      \\  |     ',
    '    /| |        | |\\    ',
    '   / | |        | | \\   ',
    '  /  |_|        |_|  \\  ',
    ' /__/  \\        /  \\__\\ ',
    '|__|    \\______/    |__|',
    " ``       ''''       `` ",
  ],
  tint: [1.25, 0.72, 0.55],
  width: 1.5,
  height: 1.3,
}

/**
 * A sentry: upright and narrow, with a heavy head and a braced middle.
 *
 * The tallest silhouette in the level, which is the point of it — at distance
 * the only thing left of any of these is the outline.
 */
export const SENTRY: Sprite = {
  rows: [
    '     .------.     ',
    '    /  ____  \\    ',
    '   |  /    \\  |   ',
    '   | | (oo) | |   ',
    '   |  \\____/  |   ',
    '    \\________/    ',
    '     |      |     ',
    '  .--+------+--.  ',
    ' /   |      |   \\ ',
    '|    |      |    |',
    '|    |      |    |',
    ' \\   |      |   / ',
    "  '--+------+--'  ",
    '     |      |     ',
    '     |      |     ',
    '     |      |     ',
    '    _|      |_    ',
    '   / |      | \\   ',
    '  /__|      |__\\  ',
    " '''          ''' ",
  ],
  tint: [0.95, 0.9, 0.8],
  width: 0.9,
  height: 2.1,
}

/** A drifting lamp: a hovering shell around a bright core, trailing filaments. */
export const DRIFTER: Sprite = {
  rows: [
    '      .----.      ',
    "    .'      '.    ",
    '   /   .--.   \\   ',
    '  |   / @@ \\   |  ',
    '  |  |  @@  |  |  ',
    '  |   \\ __ /   |  ',
    "   \\   '--'   /   ",
    "    '.      .'    ",
    "      '-..-'      ",
    '     /  ||  \\     ',
    '    |   ||   |    ',
    '    :   ||   :    ',
    "     .  ''  .     ",
    '     :      :     ',
    '      .    .      ',
  ],
  tint: [0.75, 0.95, 1.35],
  width: 1.0,
  height: 1.6,
}

/** A canister of charge. Small and bright, unmistakably not a creature. */
export const CANISTER: Sprite = {
  rows: [
    ' .----. ',
    '| :::: |',
    '| :::: |',
    '| ---- |',
    " '----' ",
  ],
  tint: [1.1, 1.25, 0.6],
  width: 0.5,
  height: 0.6,
}

/** A field kit. A plain box with a bar across it. */
export const KIT: Sprite = {
  rows: [
    '.--------.',
    '|        |',
    '|  ====  |',
    '|        |',
    "'--------'",
  ],
  tint: [0.7, 1.3, 0.85],
  width: 0.7,
  height: 0.5,
}

/**
 * Where everything stands in the first level.
 *
 * `light` repeats the sector's brightness rather than looking it up, because a
 * thing carries its own lighting in the original too — it is lit by the sector
 * it stands in, and reading that here keeps the renderer from needing the map.
 */
/**
 * Things that sit still and wait to be picked up.
 *
 * Creatures are not here any more: they move, so they are actors and are drawn
 * from their own positions each frame. Leaving them in both lists would draw
 * each one twice, once where it started and once where it is.
 */
export const LEVEL_1_PICKUPS: Billboard[] = [
  { x: 5.5, y: 1.5, z: 0, light: 0.95, sprite: CANISTER },
  { x: 5.5, y: 4.5, z: 0, light: 0.95, sprite: KIT },
]

/**
 * What is left behind. A corpse is wide and low where the living shape was
 * tall, so the silhouette alone says the fight there is over.
 */
export const CRAWLER_DOWN: Sprite = {
  rows: [
    '      ..--~~~~--..      ',
    "  .-'  o        o  '-.  ",
    ' /__.____________.__\\   ',
    "  ``     ''''''     ``  ",
  ],
  tint: [0.85, 0.5, 0.4],
  width: 1.6,
  height: 0.4,
}

export const SENTRY_DOWN: Sprite = {
  rows: [
    '     .-------------.    ',
    "  .-'  (oo)         '-. ",
    ' /_______________ ___\\  ',
    "  '''             '''   ",
  ],
  tint: [0.7, 0.68, 0.62],
  width: 1.8,
  height: 0.4,
}

export const DRIFTER_DOWN: Sprite = {
  rows: [
    '       .-~~~~~-.        ',
    "    .-'   ....   '-.    ",
    "   '--..._______...--'  ",
    '        ` ` ` `         ',
  ],
  tint: [0.5, 0.62, 0.85],
  width: 1.4,
  height: 0.35,
}

/**
 * The cast, as the rules see them.
 *
 * Numbers chosen to give the three different problems rather than three
 * difficulties. The crawler is fast and weak and comes straight at you; the
 * sentry is slow, tough and hits hard, so it is a thing to walk around; the
 * drifter is quick to notice and quick to swing but dies to almost anything.
 */
export const CRAWLER_KIND: ActorKind = {
  name: 'crawler',
  sprite: CRAWLER,
  corpse: CRAWLER_DOWN,
  radius: 0.45,
  height: 1.3,
  eye: 0.9,
  health: 24,
  speed: 2.6,
  sightRange: 22,
  reach: 0.7,
  damage: 7,
  windUp: 0.35,
  recovery: 0.6,
  painTime: 0.3,
  painChance: 0.6,
  deathTime: 0.5,
}

export const SENTRY_KIND: ActorKind = {
  name: 'sentry',
  sprite: SENTRY,
  corpse: SENTRY_DOWN,
  radius: 0.4,
  height: 2.1,
  eye: 1.7,
  health: 60,
  speed: 1.5,
  sightRange: 26,
  reach: 0.9,
  damage: 16,
  windUp: 0.6,
  recovery: 1.1,
  painTime: 0.25,
  painChance: 0.25,
  deathTime: 0.8,
}

export const DRIFTER_KIND: ActorKind = {
  name: 'drifter',
  sprite: DRIFTER,
  corpse: DRIFTER_DOWN,
  radius: 0.35,
  height: 1.6,
  eye: 1.2,
  health: 14,
  speed: 2.2,
  sightRange: 30,
  reach: 0.8,
  damage: 5,
  windUp: 0.2,
  recovery: 0.45,
  painTime: 0.35,
  painChance: 0.8,
  deathTime: 0.4,
}

/** Where the creatures start, before anything has noticed you. */
export interface ActorPlacement {
  readonly kind: ActorKind
  readonly x: number
  readonly y: number
  /** Which way it faces while asleep, which decides whether it sees you first. */
  readonly angle: number
}

export const LEVEL_1_ACTORS: ActorPlacement[] = [
  // Down the corridor, facing you: the first thing that moves.
  { kind: CRAWLER_KIND, x: 12, y: 3, angle: Math.PI },
  // In the hall, facing away, so walking in quietly is rewarded.
  { kind: SENTRY_KIND, x: 16, y: 0, angle: Math.PI / 2 },
  { kind: CRAWLER_KIND, x: 24, y: 8, angle: Math.PI },
  { kind: DRIFTER_KIND, x: 20, y: 9, angle: -Math.PI / 2 },
  // On the platform, looking down at the way in.
  { kind: SENTRY_KIND, x: 20, y: 4, angle: Math.PI },
]

/** Every sprite the game ships, for checks that want to hold them all to a rule. */
export const ALL_SPRITES: Record<string, Sprite> = {
  CRAWLER,
  SENTRY,
  DRIFTER,
  CANISTER,
  KIT,
  CRAWLER_DOWN,
  SENTRY_DOWN,
  DRIFTER_DOWN,
}
