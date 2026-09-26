/**
 * The view, drawn one screen column at a time.
 *
 * A character grid is a grid of columns, and the 1993 renderer is a column
 * renderer, so the two fit without persuasion. Every wall in this world is
 * vertical, which means a column crosses it at exactly one distance — so a
 * whole column of wall shares one distance, one brightness and one run of
 * glyphs. Floors and ceilings are horizontal, so a screen *row* of them shares
 * one distance instead. Between them, a frame is a few hundred runs rather
 * than several thousand independently shaded cells.
 *
 * There is no BSP tree. For each column the ray is intersected with every line
 * in the map, the crossings are sorted, and the renderer walks them outward
 * through portals until it meets a solid wall or the view closes up. At this
 * resolution that is cheap — 163 columns against a level's few hundred lines —
 * and it buys back all the code a tree would need, including the part where
 * the tree has to be rebuilt whenever a door moves.
 */

import type { Framebuffer } from '../../vendor/ascii-engine/src/core/framebuffer.ts'
import { luminance, rampChar } from '../../vendor/ascii-engine/src/core/ramp.ts'
import { acrossFrom, castRay, type Level, type Line, type RayHit } from './level.ts'

/** Where the eye is and which way it looks. */
export interface View {
  x: number
  y: number
  /** Height of the eye above the world's zero plane, not above the floor. */
  z: number
  /** Yaw in radians; 0 looks along +x. */
  angle: number
  /** The sector the eye is in. The caller maintains this as it moves. */
  sector: number
  /** Vertical field of view in radians. */
  fovY: number
}

export interface RenderOptions {
  /** Perpendicular distance past which nothing is drawn. */
  maxDistance?: number
  /**
   * Looking up and down, as a shear of the horizon in rows.
   *
   * Not a real pitch. Rotating the camera would tilt the walls, and a tilted
   * wall is no longer one distance per column — the column renderer would stop
   * being correct. Shearing moves what is on screen without moving the
   * geometry, which is the same bargain the original struck.
   */
  horizonShift?: number
  /**
   * Collects the lines this frame actually reached, for the automap.
   *
   * Filled here because the rays have already been cast: knowing what you have
   * seen costs nothing on top of drawing it, where asking the question
   * separately would mean casting the same rays twice. A line goes in when the
   * column walk arrives at it, not when a ray crosses it — the walk stops at a
   * solid wall, so nothing behind one is ever marked and the map cannot show
   * you a room you have not been able to see into.
   */
  seen?: Set<Line>
}

/** What a surface is made of, as far as a character grid is concerned. */
export interface Material {
  /**
   * Hue only. Normalised so its luminance is exactly 1, which leaves the light
   * as the sole owner of how bright a cell ends up.
   */
  readonly tint: readonly [number, number, number]
  /**
   * The glyphs this surface is drawn with, darkest first.
   *
   * A grid of characters has two channels, and using only one of them was the
   * second thing this renderer got wrong. With brightness owned entirely by
   * the light — which is what makes the colour honest — every surface at the
   * same distance under the same lamp resolves to the *same* glyph, so a floor,
   * a wall and a ceiling meeting at a corner came out identical. Measured, all
   * five materials picked one character at every distance tried.
   *
   * Giving each class its own family fixes that without giving brightness back
   * to the material: the family says what the surface is, and the light still
   * says which step of the family it lands on.
   */
  readonly ramp: string
}

/**
 * Normalises a colour to unit luminance, keeping its hue.
 *
 * This exists because of a measured failure rather than a preference. The
 * materials were first written as albedos — around 0.7 luminance — and the
 * sector lights as another sub-unity factor, so the two multiplied to a
 * ceiling of 0.44 before distance was even applied. A rendered frame used
 * ramp indices 1 to 3 out of 10 and nothing else: the top six glyphs were
 * unreachable in principle, and the whole level came out as a dark smudge.
 *
 * Splitting the roles fixes it and makes the result checkable. Material
 * decides colour, light decides brightness, and a cell's luminance is exactly
 * the light reaching it — so the glyph the ramp picks is a direct function of
 * `lightAt`, which the checks can hold it to.
 *
 * A channel can exceed 1 after normalising (a warm tint has more red than its
 * luminance). The presenter clamps, so a surface at full light shifts very
 * slightly toward neutral. That is a better trade than losing the top of the
 * ramp.
 */
function tint(r: number, g: number, b: number): readonly [number, number, number] {
  const l = luminance(r, g, b)
  return [r / l, g / l, b / l]
}

/**
 * Surface colours.
 *
 * Colour carries the material and the glyph carries the light: the renderer
 * writes colour and leaves the glyph on auto, so `Framebuffer.resolve` picks it
 * from luminance the way it does for everything else the engine draws. The
 * alternative — forcing a glyph per material and letting colour carry the
 * light — reads better on a terminal with few colours and is worth trying if
 * measurement says the classes do not separate.
 */
export const MATERIALS: Record<string, Material> = {
  // Solid and dense: the thing you cannot walk through.
  wall: { tint: tint(0.80, 0.70, 0.56), ramp: ' .:#%@' },
  // Above an opening, where a far ceiling is lower than the near one.
  upper: { tint: tint(0.62, 0.58, 0.60), ramp: ' ;+*&' },
  // The face of a step up, which is the edge of a platform seen from below.
  lower: { tint: tint(0.74, 0.66, 0.48), ramp: ' _oO8' },
  // Horizontal strokes, so the ground reads as ground.
  floor: { tint: tint(0.56, 0.52, 0.46), ramp: ' ,-=~' },
  // Sparse marks overhead.
  ceiling: { tint: tint(0.42, 0.46, 0.58), ramp: ' \'"^' },
  // Ground that is not safe to stand on. Its own family of glyphs rather than a
  // tint on the floor's, because glyph carries class here and light carries
  // brightness -- a colour alone would say "this floor is lit oddly" where the
  // point is "this is not the same kind of thing".
  sludge: { tint: tint(0.55, 0.78, 0.40), ramp: ' `!$' },
}

/**
 * How fast light falls off with distance.
 *
 * The original dimmed by subtracting a multiple of the distance from the
 * sector's light level, which is linear and reaches black at a fixed range.
 * This is the reciprocal form instead: it never quite reaches zero, so a
 * distant wall stays legible as *something* rather than dropping to a space,
 * and `maxDistance` is what ends the view.
 */
const FALLOFF = 0.085

const DEFAULT_MAX_DISTANCE = 64

/**
 * The vertical field of view the game is played at.
 *
 * Shared rather than written down twice, because the checks render the level
 * themselves and a check that frames the world differently from the game is
 * describing a picture nobody sees. That is not hypothetical: the readability
 * threshold here was derived from a probe at this angle and then applied to a
 * check running at a narrower one, and the same corridor measured 39% and 59%
 * of one glyph depending on which was asked.
 */
export const DEFAULT_FOV_Y = Math.PI / 2.6

/** Brightness of a surface of a given sector light at a given distance. */
export function lightAt(sectorLight: number, distance: number): number {
  return sectorLight / (1 + distance * FALLOFF)
}

/**
 * The screen row a world height projects to, as a fractional row.
 *
 * Three things fall out of this that the checks lean on: something exactly at
 * eye height lands on the horizon at every distance, doubling the distance
 * halves the offset from the horizon, and the top of the frustum lands on row
 * zero.
 */
export function rowOfHeight(height: number, distance: number, eyeZ: number, projScale: number, horizon: number): number {
  return horizon - ((height - eyeZ) * projScale) / distance
}

/**
 * The distance to a horizontal plane seen at a given fractional row.
 *
 * The inverse of `rowOfHeight`, and the reason a floor costs one division per
 * row rather than a ray per cell.
 */
export function distanceOfRow(height: number, row: number, eyeZ: number, projScale: number, horizon: number): number {
  return ((eyeZ - height) * projScale) / (row - horizon)
}

/** Rows whose centre falls inside a fractional span. Cell i is sampled at i+0.5. */
function firstRow(top: number): number {
  return Math.ceil(top - 0.5)
}

/** Everything about the projection that depends on the grid rather than the world. */
export interface Projection {
  /** Screen rows per world unit of height, at one unit of distance. */
  readonly projScale: number
  /** Half the width of the camera plane at one unit of distance, in world units. */
  readonly planeHalf: number
  /** The row a surface at eye height projects to. */
  readonly horizon: number
}

/**
 * The projection constants for a grid.
 *
 * A character cell is about twice as tall as it is wide, so the horizontal
 * field of view is much wider than the vertical one for the same grid. Getting
 * that correction wrong makes every corridor the wrong shape rather than
 * slightly off.
 *
 * Shared by everything that puts world geometry on this screen — walls here,
 * sprites elsewhere — because two things drawn with two copies of this
 * arithmetic will disagree in exactly the way a creature standing beside a
 * wall makes obvious.
 */
export function projectionOf(
  cols: number,
  rows: number,
  cellAspect: number,
  fovY: number,
  horizonShift = 0,
): Projection {
  const tanHalfV = Math.tan(fovY / 2)
  return {
    projScale: rows / 2 / tanHalfV,
    planeHalf: tanHalfV * ((cols * cellAspect) / rows),
    horizon: rows / 2 + horizonShift,
  }
}

export function renderView(
  fb: Framebuffer,
  level: Level,
  view: View,
  cellAspect: number,
  options: RenderOptions = {},
): void {
  if (view.sector < 0) return

  const cols = fb.width
  const rows = fb.height
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE
  const { projScale, planeHalf, horizon } = projectionOf(
    cols,
    rows,
    cellAspect,
    view.fovY,
    options.horizonShift ?? 0,
  )

  const fx = Math.cos(view.angle)
  const fy = Math.sin(view.angle)
  // Screen-right, which is forward turned a quarter turn clockwise.
  const rx = fy
  const ry = -fx

  const hits: RayHit[] = []

  for (let col = 0; col < cols; col++) {
    const camX = ((2 * (col + 0.5)) / cols - 1) * planeHalf
    let dx = fx + rx * camX
    let dy = fy + ry * camX
    const len = Math.hypot(dx, dy)
    dx /= len
    dy /= len

    // Distance along the ray is not distance into the screen. Shading and
    // projection both want the component along the view axis, or the walls
    // bend away at the edges of the frame -- the same `t * cos(a)` bridge the
    // engine's raymarcher needs to agree with its rasterizer.
    const cosA = dx * fx + dy * fy
    castRay(level, view.x, view.y, dx, dy, maxDistance / cosA, hits)

    drawColumn(fb, level, view, col, hits, cosA, projScale, horizon, maxDistance, options.seen)
  }
}

function drawColumn(
  fb: Framebuffer,
  level: Level,
  view: View,
  col: number,
  hits: readonly RayHit[],
  cosA: number,
  projScale: number,
  horizon: number,
  maxDistance: number,
  seen: Set<Line> | undefined,
): void {
  const rows = fb.height
  let current = view.sector
  // The part of the column still unpainted. Everything nearer has already
  // claimed its rows, so a portal further away can only draw inside what is
  // left -- which is what makes a doorway show the room beyond it and nothing
  // else.
  let top = 0
  let bottom = rows - 1

  for (const hit of hits) {
    if (top > bottom) return
    const sector = level.sectors[current]
    if (!sector) return

    // Reached, not merely crossed. Both guards above are returns, so a column
    // that has met a wall or closed up never gets here for anything further
    // along the ray.
    seen?.add(hit.line)

    const distance = hit.t * cosA
    const ceilingRow = rowOfHeight(sector.ceiling, distance, view.z, projScale, horizon)
    const floorRow = rowOfHeight(sector.floor, distance, view.z, projScale, horizon)

    // Ceiling and floor of the sector the ray is crossing, out to this wall.
    // The sector's own surfaces, not the defaults. These were literals until a
    // detour through someone else's map showed that a floor asking to be drawn
    // as sludge was drawn as ordinary ground -- the fields had been stored on
    // every sector since they were introduced and read by nothing.
    // An open sky is claimed but not painted: the rows still belong to this
    // sector, so everything nearer keeps clipping against them, and they are
    // left as they were cleared -- which is the same nothing the renderer shows
    // where a ray leaves the map altogether.
    top = paintPlane(fb, col, top, Math.min(bottom, firstRow(ceilingRow) - 1), sector.ceiling, sector.light, view.z, projScale, horizon, sector.ceilingMaterial, maxDistance, false, !sector.sky)
    bottom = paintPlane(fb, col, Math.max(top, firstRow(floorRow)), bottom, sector.floor, sector.light, view.z, projScale, horizon, sector.floorMaterial, maxDistance, true)

    const next = acrossFrom(hit.line, current)
    if (next < 0) {
      paintWall(fb, col, top, bottom, distance, sector.light, 'wall')
      return
    }

    const beyond = level.sectors[next]
    if (!beyond) return

    // A step up on the far side hides the bottom of the opening, a lower
    // ceiling hides the top. A closed door is the extreme of both at once, and
    // needs no flag of its own: its far ceiling has been driven down to its
    // floor, the two steps meet, and the column closes.
    if (beyond.ceiling < sector.ceiling) {
      const edge = rowOfHeight(beyond.ceiling, distance, view.z, projScale, horizon)
      const to = Math.min(bottom, firstRow(edge) - 1)
      paintWall(fb, col, top, to, distance, sector.light, 'upper')
      top = Math.max(top, to + 1)
    }
    if (beyond.floor > sector.floor) {
      const edge = rowOfHeight(beyond.floor, distance, view.z, projScale, horizon)
      const from = Math.max(top, firstRow(edge))
      paintWall(fb, col, from, bottom, distance, sector.light, 'lower')
      bottom = Math.min(bottom, from - 1)
    }

    current = next
  }

  // The ray left the map without meeting a wall. Nothing to draw: the cells
  // keep whatever the frame was cleared to, which reads as void.
}

/**
 * Fills a run of rows with a horizontal surface, shading each row by its own
 * distance. Returns the first row still unpainted on that side.
 */
function paintPlane(
  fb: Framebuffer,
  col: number,
  from: number,
  to: number,
  height: number,
  sectorLight: number,
  eyeZ: number,
  projScale: number,
  horizon: number,
  material: string,
  maxDistance: number,
  fromBelow = false,
  /**
   * False to take the rows without drawing on them, for a ceiling that is sky.
   *
   * The skip lives here rather than at the call site so that the bound stays
   * worked out in one place: the caller would otherwise need its own copy of
   * the arithmetic to know what to advance past.
   */
  draw = true,
): number {
  if (from > to) return fromBelow ? to + 1 : from
  if (!draw) return fromBelow ? from - 1 : to + 1
  const surface = MATERIALS[material]!
  for (let row = from; row <= to; row++) {
    const distance = distanceOfRow(height, row + 0.5, eyeZ, projScale, horizon)
    if (!(distance > 0) || distance > maxDistance) continue
    const shade = lightAt(sectorLight, distance)
    paint(fb, col, row, surface, shade, distance)
  }
  return fromBelow ? from - 1 : to + 1
}

/** Fills a run of rows with a vertical surface, which has one distance. */
function paintWall(
  fb: Framebuffer,
  col: number,
  from: number,
  to: number,
  distance: number,
  sectorLight: number,
  material: string,
): void {
  if (from > to) return
  const surface = MATERIALS[material]!
  const shade = lightAt(sectorLight, distance)
  for (let row = from; row <= to; row++) paint(fb, col, row, surface, shade, distance)
}

function paint(
  fb: Framebuffer,
  col: number,
  row: number,
  surface: Material,
  shade: number,
  distance: number,
): void {
  if (row < 0 || row >= fb.height) return
  const index = row * fb.width + col
  const c = index * 3
  const tintColor = surface.tint
  fb.color[c] = tintColor[0] * shade
  fb.color[c + 1] = tintColor[1] * shade
  fb.color[c + 2] = tintColor[2] * shade
  // The glyph is chosen here rather than left for `Framebuffer.resolve`,
  // because the material picks the family and only the light picks the step
  // within it. Leaving it on auto would send every surface through one ramp
  // and the classes would stop separating.
  fb.chars[index] = rampChar(surface.ramp, shade)
  // The engine's convention, so anything drawn afterwards -- a sprite, a
  // weapon, an overlay -- can depth-test against the world without knowing how
  // the world was drawn.
  fb.depth[index] = 1 / distance
}
