/**
 * Things in the world that are not walls: creatures, items, anything that
 * turns to face you.
 *
 * A billboard is drawn from the same projection the walls use, which is why
 * `projectionOf` is shared rather than repeated. Two copies of that arithmetic
 * disagree in precisely the way a creature standing beside a doorway makes
 * obvious — it floats, or its feet sink into the floor, and neither is visible
 * in a static screenshot of an empty room.
 *
 * Occlusion is free. The wall renderer writes `1 / distance` into every cell it
 * paints, so a sprite cell is hidden by asking whether the world in that cell
 * is nearer. No second depth structure, and a creature half behind a pillar is
 * clipped per cell rather than per sprite.
 *
 * The art decides the glyph. Shading a creature from a ramp the way a wall is
 * shaded would make it a slightly different shade of the surface behind it; a
 * creature has to read as a *shape*, so its own characters are written and only
 * its colour is dimmed with distance.
 */

import type { Framebuffer } from '../../vendor/ascii-engine/src/core/framebuffer.ts'
import { columnOfCamX, lightAt, projectionOf, rowOfHeight, type View } from './render.ts'

/** Art for one thing, as rows of characters. */
export interface Sprite {
  /**
   * Rows top-first, all the same length. A space is transparent — it is the
   * one character a drawing is guaranteed to want for "nothing here", and
   * writing a space instead would punch a hole in the wall behind.
   */
  readonly rows: readonly string[]
  /**
   * One colour for the whole drawing.
   *
   * What a sprite written by hand wants: the art carries the shape in its
   * glyphs and the colour says what kind of thing it is. A picture decoded out
   * of a file has a colour per pixel instead, and brings `colors` below.
   */
  readonly tint: readonly [number, number, number]
  /**
   * A colour per cell, laid out exactly like `rows`, or absent.
   *
   * Absent is the normal case and costs nothing: without it every cell takes
   * `tint`, which is what every sprite drawn for this game does. With it, the
   * shape comes from the glyphs and the colour from the picture the glyphs were
   * sampled out of -- which is the whole difference between a silhouette and a
   * thing you recognise.
   */
  readonly colors?: readonly (readonly (readonly [number, number, number])[])[]
  /** How wide the art is in world units. */
  readonly width: number
  /** How tall the art is in world units, measured up from the thing's feet. */
  readonly height: number
}

/**
 * Draws a sprite straight onto the grid, at cells rather than in the world.
 *
 * Everything else here puts art into a scene: projected for distance, shaded by
 * the light where it stands, and hidden behind whatever the renderer already
 * put in front of it. A title screen has none of those -- there is no world
 * behind it and nothing to be in front of -- so this is the plain version, and
 * separating them is what keeps the projection out of a picture that has no
 * business being projected.
 *
 * `col` and `row` are the top-left corner, and the art is drawn at whatever
 * size it already is: one art cell to one screen cell. Anything falling off an
 * edge is clipped rather than wrapped.
 */
/**
 * The sprite with columns dropped until it is no wider than `cols`.
 *
 * For the title on a narrow grid. Nothing else needs it: a billboard is sized
 * in the world and a status panel is laid out in text, so this is the one place
 * where a fixed lump of baked characters meets a grid that may be smaller than
 * it was baked for.
 *
 * Columns that carry a glyph are kept in preference to blank ones, because the
 * blanks between letters are the cheapest thing to lose. That buys less than it
 * sounds: the logo is 92 columns and only two of them are empty top to bottom,
 * so fitting 80 spends the blanks and then thins ten inked columns as well.
 * What survives is thinner letters rather than broken ones, but that is a claim
 * about this one picture, judged by looking at it, not something the code can
 * promise for another.
 */
export function squeezed(sprite: Sprite, cols: number): Sprite {
  const wide = Math.max(...sprite.rows.map((row) => row.length))
  if (wide <= cols) return sprite

  const ink: number[] = []
  const blank: number[] = []
  for (let x = 0; x < wide; x++) {
    ;(sprite.rows.some((row) => (row[x] ?? ' ') !== ' ') ? ink : blank).push(x)
  }
  // Thin whichever pile has to give: blanks first, and only then ink, spread
  // evenly rather than taken off one side.
  const keep = new Set<number>()
  const thin = (from: number[], wanted: number) => {
    if (wanted >= from.length) {
      for (const x of from) keep.add(x)
      return
    }
    for (let i = 0; i < wanted; i++) keep.add(from[Math.floor((i * from.length) / wanted)]!)
  }
  thin(ink, Math.min(ink.length, cols))
  thin(blank, cols - Math.min(ink.length, cols))

  const kept = [...keep].sort((a, b) => a - b)
  const rows = sprite.rows.map((row) => kept.map((x) => row[x] ?? ' ').join(''))
  // Spread rather than handed `colors: undefined`: a sprite that carries no
  // colours has no such property, and giving it one holding undefined is a
  // different thing that the tint fallback in the blitter would not survive.
  const colors = sprite.colors
  return colors === undefined
    ? { ...sprite, rows }
    : { ...sprite, rows, colors: colors.map((line) => kept.map((x) => line[x] ?? ([0, 0, 0] as const))) }
}

export function drawSprite(fb: Framebuffer, sprite: Sprite, col: number, row: number, bright = 1): void {
  const cols = fb.width
  for (let y = 0; y < sprite.rows.length; y++) {
    const screenRow = row + y
    if (screenRow < 0 || screenRow >= fb.height) continue
    const line = sprite.rows[y]!
    const hues = sprite.colors?.[y]
    for (let x = 0; x < line.length; x++) {
      const glyph = line[x]!
      if (glyph === ' ') continue
      const screenCol = col + x
      if (screenCol < 0 || screenCol >= cols) continue

      const index = screenRow * cols + screenCol
      const own = hues?.[x] ?? sprite.tint
      fb.chars[index] = glyph.charCodeAt(0)
      const c = index * 3
      fb.color[c] = own[0] * bright
      fb.color[c + 1] = own[1] * bright
      fb.color[c + 2] = own[2] * bright
      // Nothing is behind a title, so nothing may hide it: the depth is set as
      // near as it goes rather than left for the world to overwrite.
      fb.depth[index] = Infinity
    }
  }
}

/** A sprite placed in the world. */
export interface Billboard {
  x: number
  y: number
  /** Height of the floor it stands on; the art rises from here. */
  z: number
  /** Light where it stands, before distance is taken into account. */
  light: number
  sprite: Sprite
}

export interface BillboardOptions {
  maxDistance?: number
  horizonShift?: number
  /** Nothing nearer than this is drawn, so a creature in your face is not a wall of glyphs. */
  nearDistance?: number
}

/**
 * Draws every billboard that is in front of the camera, furthest first.
 *
 * Sorting matters even with a depth test, because two sprites overlapping each
 * other are settled by draw order rather than by the wall depth they are both
 * in front of.
 */
export function drawBillboards(
  fb: Framebuffer,
  view: View,
  cellAspect: number,
  things: readonly Billboard[],
  options: BillboardOptions = {},
): void {
  const cols = fb.width
  const rows = fb.height
  const maxDistance = options.maxDistance ?? 64
  const nearDistance = options.nearDistance ?? 0.3
  const { projScale, planeHalf, horizon } = projectionOf(
    cols,
    rows,
    cellAspect,
    view.fovY,
    options.horizonShift ?? 0,
  )

  const fx = Math.cos(view.angle)
  const fy = Math.sin(view.angle)
  const rx = fy
  const ry = -fx

  // Depth first, so a far creature cannot paint over a near one.
  const order = things
    .map((thing) => {
      const dx = thing.x - view.x
      const dy = thing.y - view.y
      return { thing, depth: dx * fx + dy * fy, side: dx * rx + dy * ry }
    })
    .filter((entry) => entry.depth > nearDistance && entry.depth <= maxDistance)
    .sort((a, b) => b.depth - a.depth)

  for (const { thing, depth, side } of order) {
    const sprite = thing.sprite
    const art = sprite.rows
    if (art.length === 0) continue

    // Where the centre of the thing lands.
    const camX = side / depth
    const centre = columnOfCamX(camX, planeHalf, cols)
    const halfCols = (sprite.width / 2 / (depth * planeHalf)) * (cols / 2)

    const topRow = rowOfHeight(thing.z + sprite.height, depth, view.z, projScale, horizon)
    const bottomRow = rowOfHeight(thing.z, depth, view.z, projScale, horizon)
    const spanRows = bottomRow - topRow
    if (spanRows <= 0 || halfCols <= 0) continue

    const firstCol = Math.max(0, Math.ceil(centre - halfCols - 0.5))
    const lastCol = Math.min(cols - 1, Math.ceil(centre + halfCols - 0.5) - 1)
    const firstRow = Math.max(0, Math.ceil(topRow - 0.5))
    const lastRow = Math.min(rows - 1, Math.ceil(bottomRow - 0.5) - 1)
    if (firstCol > lastCol || firstRow > lastRow) continue

    const invW = 1 / depth
    const shade = lightAt(thing.light, depth)
    const tint = sprite.tint
    const painted = sprite.colors

    for (let row = firstRow; row <= lastRow; row++) {
      // Nearest-sample the art. A creature is a handful of cells tall at any
      // useful distance, so filtering it would only turn a face into a smudge.
      const v = (row + 0.5 - topRow) / spanRows
      const line = art[Math.min(art.length - 1, Math.max(0, Math.floor(v * art.length)))]!
      // The same row of colours as of glyphs, when there is one. Sampled with
      // the same index rather than with the same arithmetic written twice.
      const hues = painted?.[Math.min(painted.length - 1, Math.max(0, Math.floor(v * art.length)))]
      for (let col = firstCol; col <= lastCol; col++) {
        const u = (col + 0.5 - (centre - halfCols)) / (halfCols * 2)
        const at = Math.min(line.length - 1, Math.max(0, Math.floor(u * line.length)))
        const glyph = line[at]
        if (glyph === undefined || glyph === ' ') continue

        const index = row * cols + col
        // Larger depth is nearer, so the world wins when it is in front.
        if (fb.depth[index]! > invW) continue

        const own = hues?.[at] ?? tint
        fb.chars[index] = glyph.charCodeAt(0)
        const c = index * 3
        fb.color[c] = own[0] * shade
        fb.color[c + 1] = own[1] * shade
        fb.color[c + 2] = own[2] * shade
        fb.depth[index] = invW
      }
    }
  }
}
