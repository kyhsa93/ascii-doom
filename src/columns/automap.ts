/**
 * The automap.
 *
 * A wireframe of the lines you have been able to see, drawn north-up in place
 * of the view. A character grid suits it about as well as it suits the game:
 * a map line is a run of cells, and walking one with Bresenham is the column
 * walk with the axes swapped.
 *
 * Which lines are known is not decided here. The renderer marks one the moment
 * a column arrives at it, which costs nothing because those rays were cast to
 * draw the frame anyway — and means the map shows what has been on screen
 * rather than what happened to be nearby.
 *
 * Everything in this file except the drawing is arithmetic with a right
 * answer, which is why it is a module rather than a corner of the page.
 */

import type { Framebuffer } from '../../vendor/ascii-engine/src/core/framebuffer.ts'
import { drawText } from '../../vendor/ascii-engine/src/core/overlay.ts'
import { vec3 } from '../../vendor/ascii-engine/src/core/vec3.ts'
import type { Level, Line } from './level.ts'

/** Where the map is centred, and how much ground it covers. */
export interface MapView {
  readonly cx: number
  readonly cy: number
  /** Map units spanned by one grid row. Smaller is closer in. */
  readonly scale: number
}

export interface Cell {
  readonly col: number
  readonly row: number
}

/**
 * A map point as a grid cell, north up.
 *
 * A cell is taller than it is wide, so a column must cover less ground than a
 * row or the map comes out stretched — the same correction the view makes, for
 * the same reason. Rows count downward and north is up, which is why the y term
 * is subtracted where the x term is added.
 */
export function mapToCell(
  view: MapView,
  cellAspect: number,
  width: number,
  height: number,
  x: number,
  y: number,
): Cell {
  return {
    col: Math.round(width / 2 + (x - view.cx) / (view.scale * cellAspect)),
    row: Math.round(height / 2 - (y - view.cy) / view.scale),
  }
}

/**
 * The cells a segment passes through.
 *
 * Bresenham, with the step count worked out in advance rather than trusting the
 * loop to land exactly on its end: a line whose endpoints are far off the grid
 * would otherwise be a very long walk.
 */
export function plotLine(a: Cell, b: Cell, out: Cell[] = []): Cell[] {
  out.length = 0
  let col = a.col
  let row = a.row
  const dx = Math.abs(b.col - col)
  const dy = -Math.abs(b.row - row)
  const stepX = col < b.col ? 1 : -1
  const stepY = row < b.row ? 1 : -1
  let error = dx + dy

  const steps = Math.max(dx, -dy)
  for (let i = 0; i <= steps; i++) {
    out.push({ col, row })
    if (col === b.col && row === b.row) break
    const twice = 2 * error
    if (twice >= dy) {
      error += dy
      col += stepX
    }
    if (twice <= dx) {
      error += dx
      row += stepY
    }
  }
  return out
}

/**
 * Which way the player is pointing, to a quarter turn.
 *
 * Angle zero is +x, which is east, which is right on a north-up map. A quarter
 * turn is as much as four glyphs can honestly say, and a marker that claims
 * more precision than it has is worse than one that does not.
 */
export function markerFor(angle: number): string {
  const quarter = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4
  return ['>', '^', '<', 'v'][quarter]!
}

/** Whether a segment is wholly off one side of the grid, and so not worth walking. */
function offGrid(a: Cell, b: Cell, width: number, height: number): boolean {
  return (
    (a.col < 0 && b.col < 0) ||
    (a.col >= width && b.col >= width) ||
    (a.row < 0 && b.row < 0) ||
    (a.row >= height && b.row >= height)
  )
}

/** Solid wall, and something you can walk through. */
const WALL_GLYPH = '#'
const THRESHOLD_GLYPH = ':'

export function drawAutomap(
  fb: Framebuffer,
  level: Level,
  seen: ReadonlySet<Line>,
  view: MapView,
  player: { readonly x: number; readonly y: number; readonly angle: number },
  cellAspect: number,
): void {
  const width = fb.width
  const height = fb.height
  const cells: Cell[] = []

  for (const line of level.lines) {
    if (!seen.has(line)) continue

    // A boundary between two sectors at the same height is not a feature of the
    // place, it is a seam in how the place was authored — floors get cut into
    // several sectors for lighting and for lifts, and drawing every seam turns
    // the map into a mesh. The original leaves them out, which is why its map
    // reads as rooms. A step or a lower ceiling is something you can see, so
    // that stays: a shut door qualifies, since its ceiling has been driven to
    // its floor, and it drops off the map once opened — by then it is a way
    // through rather than a door.
    if (line.back !== null) {
      const front = level.sectors[line.front]
      const back = level.sectors[line.back]
      if (front && back && front.floor === back.floor && front.ceiling === back.ceiling) continue
    }

    const a = mapToCell(view, cellAspect, width, height, line.ax, line.ay)
    const b = mapToCell(view, cellAspect, width, height, line.bx, line.by)
    if (offGrid(a, b, width, height)) continue

    // One side is a wall you cannot pass; two is a threshold. The original drew
    // that difference, and the map data already knows it, so nothing has to be
    // authored to get it.
    const solid = line.back === null
    const color = solid ? vec3(0.95, 0.85, 0.5) : vec3(0.35, 0.4, 0.55)
    const glyph = solid ? WALL_GLYPH : THRESHOLD_GLYPH

    for (const cell of plotLine(a, b, cells)) {
      if (cell.col < 0 || cell.col >= width || cell.row < 0 || cell.row >= height) continue
      drawText(fb, cell.col, cell.row, glyph, { color })
    }
  }

  const here = mapToCell(view, cellAspect, width, height, player.x, player.y)
  if (here.col >= 0 && here.col < width && here.row >= 0 && here.row < height) {
    drawText(fb, here.col, here.row, markerFor(player.angle), { color: vec3(1.3, 0.5, 0.4) })
  }
}
