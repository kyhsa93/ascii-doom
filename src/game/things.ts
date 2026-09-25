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
export const LEVEL_1_THINGS: Billboard[] = [
  // In the start room, where you cannot miss them.
  { x: 5.5, y: 1.5, z: 0, light: 0.95, sprite: CANISTER },
  { x: 5.5, y: 4.5, z: 0, light: 0.95, sprite: KIT },

  // Down the corridor, half-lit: the first thing you see moving.
  { x: 12, y: 3, z: 0, light: 0.55, sprite: CRAWLER },

  // In the hall, spread so that turning a corner reveals them one at a time.
  { x: 16, y: 0, z: 0, light: 1, sprite: SENTRY },
  { x: 24, y: 8, z: 0, light: 1, sprite: CRAWLER },
  { x: 20, y: 9, z: 0, light: 1, sprite: DRIFTER },

  // On the platform, so something is visibly standing above you.
  { x: 20, y: 4, z: 0.6, light: 1, sprite: SENTRY },
]

/** Every sprite the game ships, for checks that want to hold them all to a rule. */
export const ALL_SPRITES: Record<string, Sprite> = { CRAWLER, SENTRY, DRIFTER, CANISTER, KIT }
