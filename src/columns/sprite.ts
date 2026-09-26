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
