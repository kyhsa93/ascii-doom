/**
 * What stands in the level besides walls. Original designs, drawn for this
 * project.
 *
 * Art here rather than in `src/columns/`, because a sprite's shape is a thing
 * you judge by looking at it and the renderer beneath it is a thing you check
 * with arithmetic. Same split as everywhere else in this repository.
 *
 * A note on drawing at this size. A creature four cells tall has sixteen or so
 * cells to work with, which is closer to a logogram than to a picture: what
 * survives is the silhouette and one or two features. So each of these is
 * built around a single recognisable idea — a stooped four-limbed thing, a
 * hovering lamp, an upright post with a head — and the detail is spent on the
 * outline rather than the interior.
 */

import type { Billboard, Sprite } from '../columns/sprite.ts'

/**
 * A crawler: low, wide, weight forward on two long arms.
 *
 * Reads as a hunched quadruped. The widest row is the shoulders, which is what
 * separates it at a glance from the upright sentry below.
 */
export const CRAWLER: Sprite = {
  rows: [
    '  /oo\\  ',
    ' /~~~~\\ ',
    '/  vv  \\',
    'L______J',
  ],
  tint: [1.25, 0.72, 0.55],
  width: 1.5,
  height: 1.3,
}

/**
 * A drifting lamp: a floating body with a bright core and trailing filaments.
 *
 * Narrow and tall-ish, so it cannot be mistaken for the crawler even when both
 * are a few cells across.
 */
export const DRIFTER: Sprite = {
  rows: [
    ' .--. ',
    '(  @ )',
    " '-|-'",
    '  | | ',
    '  . . ',
  ],
  tint: [0.75, 0.95, 1.35],
  width: 1.0,
  height: 1.6,
}

/**
 * A sentry: upright, thin, with a heavy head. The tallest silhouette in the
 * level so far, which is the point of it.
 */
export const SENTRY: Sprite = {
  rows: [
    ' [==] ',
    ' |••| ',
    '/|__|\\',
    ' |  | ',
    ' |  | ',
    ' /  \\ ',
  ],
  tint: [0.95, 0.9, 0.8],
  width: 0.9,
  height: 2.1,
}

/** A canister of charge. Small, bright, unmistakably not a creature. */
export const CANISTER: Sprite = {
  rows: [
    ' ,-. ',
    '|:::|',
    "'---'",
  ],
  tint: [1.1, 1.25, 0.6],
  width: 0.5,
  height: 0.6,
}

/** A field kit. A plain box with a bar across it. */
export const KIT: Sprite = {
  rows: [
    '.-----.',
    '|  =  |',
    "'-----'",
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
