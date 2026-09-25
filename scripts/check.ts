/**
 * The parts with an answer, checked against arithmetic that does not come from
 * the code being checked.
 *
 *   npm run check
 *
 * The rule this file tries to keep: a ground truth derived the same way as the
 * thing under test is not a ground truth. So the projection is checked against
 * invariants of a perspective view — something at eye height is on the horizon
 * at every distance, doubling the distance halves the offset from it, the edge
 * of the field of view lands on the edge of the screen — rather than against a
 * second copy of the projection formula.
 */

import { Framebuffer } from '../vendor/ascii-engine/src/core/framebuffer.ts'
import { luminance, rampChar } from '../vendor/ascii-engine/src/core/ramp.ts'
import { acrossFrom, buildLevel, castRay, sectorAt, type SectorDef } from '../src/columns/level.ts'
import { DEFAULT_FOV_Y, MATERIALS, lightAt, renderView, rowOfHeight, type View } from '../src/columns/render.ts'
import { LEVEL_1, SPAWN } from '../src/game/level1.ts'

let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failed++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${(error as Error).message}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function close(actual: number, expected: number, tolerance: number, what: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected} within ${tolerance}, got ${actual}`,
  )
}

// A two-room map: a 4x4 room, a 4x4 room east of it, sharing the wall at x=4.
const TWO_ROOMS: SectorDef[] = [
  {
    polygon: [
      [0, 0],
      [4, 0],
      [4, 1],
      [4, 3],
      [4, 4],
      [0, 4],
    ],
    floor: 0,
    ceiling: 3,
    light: 1,
  },
  {
    polygon: [
      [4, 1],
      [8, 1],
      [8, 3],
      [4, 3],
    ],
    floor: 0,
    ceiling: 3,
    light: 1,
  },
]

console.log('\nlevel geometry')

test('an edge two sectors share becomes a portal, and the rest stay solid', () => {
  const level = buildLevel(TWO_ROOMS)
  const portals = level.lines.filter((l) => l.back !== null)
  const solid = level.lines.filter((l) => l.back === null)
  assert(portals.length === 1, `expected exactly one shared edge, got ${portals.length}`)
  // Six edges on the first room, four on the second, one of which is shared:
  // nine distinct edges, one of them two-sided.
  assert(solid.length === 8, `expected 8 solid walls, got ${solid.length}`)
  const portal = portals[0]!
  close(Math.min(portal.ay, portal.by), 1, 1e-9, 'the shared edge runs from y=1')
  close(Math.max(portal.ay, portal.by), 3, 1e-9, 'the shared edge runs to y=3')
})

test('an edge three sectors claim is rejected rather than guessed at', () => {
  // Not a pedantic case: it is what a mistyped coordinate looks like, and a
  // renderer that silently picked two of the three would draw a room that does
  // not match the one you walk through.
  const square: SectorDef = {
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    floor: 0,
    ceiling: 2,
    light: 1,
  }
  let threw = false
  try {
    buildLevel([square, square, square])
  } catch {
    threw = true
  }
  assert(threw, 'three sectors sharing an edge was accepted')
})

test('a point lands in the sector that contains it, and outside the map in none', () => {
  const level = buildLevel(TWO_ROOMS)
  assert(sectorAt(level, 2, 2) === 0, 'a point in the first room')
  assert(sectorAt(level, 6, 2) === 1, 'a point in the second room')
  assert(sectorAt(level, 6, 3.5) === -1, 'a point beyond the second room is outside the map')
  assert(sectorAt(level, -1, 2) === -1, 'a point west of everything is outside the map')
})

test('a ray reports its crossings nearest first, and none behind it', () => {
  const level = buildLevel(TWO_ROOMS)
  // From the middle of the first room, due east: the shared wall at x=4, then
  // the far wall at x=8. The west wall at x=0 is behind and must not appear.
  const hits = castRay(level, 2, 2, 1, 0)
  assert(hits.length === 2, `expected two crossings ahead, got ${hits.length}`)
  close(hits[0]!.t, 2, 1e-9, 'the shared wall is two units east')
  close(hits[1]!.t, 6, 1e-9, 'the far wall is six units east')
  assert(hits[0]!.t < hits[1]!.t, 'crossings are not sorted')
})

test('walking through a portal lands in the other sector, and a wall in none', () => {
  const level = buildLevel(TWO_ROOMS)
  const hits = castRay(level, 2, 2, 1, 0)
  assert(acrossFrom(hits[0]!.line, 0) === 1, 'crossing the shared wall should reach the second room')
  assert(acrossFrom(hits[1]!.line, 1) === -1, 'the far wall has nothing behind it')
})

console.log('\nprojection')

test('a surface at eye height sits on the horizon, however far away it is', () => {
  // The invariant that pins the horizon without restating the projection: the
  // eye looks along a level line, so anything on that line is on it.
  const horizon = 25
  for (const distance of [0.5, 2, 9, 40, 400]) {
    const row = rowOfHeight(1.6, distance, 1.6, 120, horizon)
    close(row, horizon, 1e-9, `eye-height surface at ${distance} units`)
  }
})

test('twice as far is half as far from the horizon', () => {
  // Perspective in one line, and it holds for anything above or below the eye.
  const horizon = 25
  for (const height of [3.2, 0, -2]) {
    const near = rowOfHeight(height, 4, 1.6, 120, horizon) - horizon
    const far = rowOfHeight(height, 8, 1.6, 120, horizon) - horizon
    close(far, near / 2, 1e-9, `height ${height}`)
  }
})

test('the top of the field of view lands on the top of the screen', () => {
  // `projScale` is derived from the vertical field of view, so the check comes
  // at it the other way: whatever sits exactly on the upper frustum edge has
  // to land on row zero. A point at distance d on that edge is d*tan(fovY/2)
  // above the eye, and that is trigonometry rather than a copy of the code.
  const rows = 50
  const fovY = Math.PI / 3
  const projScale = rows / 2 / Math.tan(fovY / 2)
  const horizon = rows / 2
  const distance = 7
  const height = 1.6 + distance * Math.tan(fovY / 2)
  close(rowOfHeight(height, distance, 1.6, projScale, horizon), 0, 1e-9, 'the frustum edge')
})

test('light falls off with distance and never turns negative', () => {
  let previous = Infinity
  for (const distance of [0.5, 1, 2, 4, 8, 16, 32, 64]) {
    const value = lightAt(0.7, distance)
    assert(value > 0, `light at ${distance} units is ${value}`)
    assert(value < previous, `light did not fall from the previous step at ${distance} units`)
    previous = value
  }
  assert(lightAt(0.7, 0) === 0.7, 'light at zero distance should be the sector light itself')
})

console.log('\nthe view')

/** Renders the first level from a given spot and hands back the framebuffer. */
function shoot(x: number, y: number, angle: number, cols = 80, rows = 40): Framebuffer {
  const fb = new Framebuffer(cols, rows)
  fb.clear(0, 0, 0, 0)
  // The angle the game is actually played at. Rendering the checks through a
  // narrower view measures a picture that is never on anyone's screen, and the
  // readability threshold below was set from a measurement that made exactly
  // that mistake.
  const view: View = { x, y, z: 1.6, angle, sector: sectorAt(LEVEL_1, x, y), fovY: DEFAULT_FOV_Y }
  assert(view.sector >= 0, `the camera at (${x}, ${y}) is outside the map`)
  renderView(fb, LEVEL_1, view, 0.5, {})
  return fb
}

/** The rows of one column that were drawn, as a list of indices. */
function drawnRows(fb: Framebuffer, col: number): number[] {
  const out: number[] = []
  for (let row = 0; row < fb.height; row++) {
    if (fb.depth[row * fb.width + col]! > 0) out.push(row)
  }
  return out
}

test('every column of a closed room is drawn from top to bottom', () => {
  // A sealed map has no gaps in it. An undrawn cell in the middle of the view
  // means the portal walk stopped early, which is the failure this renderer is
  // most prone to and the one that is least visible in a screenshot.
  const fb = shoot(SPAWN.x, SPAWN.y, SPAWN.angle)
  const gaps: string[] = []
  for (let col = 0; col < fb.width; col++) {
    const rows = drawnRows(fb, col)
    if (rows.length !== fb.height) gaps.push(`column ${col} drew ${rows.length} of ${fb.height} rows`)
  }
  assert(gaps.length === 0, gaps.slice(0, 3).join('; '))
})

/**
 * The distance to whatever a column shows at eye level.
 *
 * The horizon row, specifically, and not the nearest thing in the column. The
 * nearest thing in any column is the floor at the bottom of the frame, a
 * couple of paces from the camera — which is what the first version of these
 * two checks actually measured, reporting 2.84 where the wall was at 12. A
 * horizontal plane recedes to infinity at the horizon, so it is never drawn
 * there; whatever occupies that row is vertical, and straight ahead.
 */
function depthAtEyeLevel(fb: Framebuffer, col: number): number {
  const row = Math.floor(fb.height / 2)
  const depth = fb.depth[row * fb.width + col]!
  assert(depth > 0, `column ${col} drew nothing at eye level`)
  return 1 / depth
}

test('a straight line of sight walks every portal on the way to the far wall', () => {
  // Looking east from the spawn, nothing solid is in the way until x=26. The
  // ray leaves the start room at x=8, crosses the corridor, enters the hall at
  // x=14, passes over the raised platform at x=18 and x=22 — the step is below
  // eye level, so at the horizon it is seen across rather than into — and only
  // then meets the hall's east wall. Twenty-four units, from the map.
  //
  // My first version of this expected 12, on the theory that x=14 was a wall.
  // It is a doorway in the level I wrote. Worth keeping the corrected number
  // rather than shortening the sight line: four portal crossings in one column
  // is the thing most likely to break, and this is what notices.
  const fb = shoot(2, 3, 0)
  close(depthAtEyeLevel(fb, Math.floor(fb.width / 2)), 24, 0.25, 'distance to the hall east wall')
})

test('a doorway shows the room beyond it and not the wall it is cut into', () => {
  // The whole point of walking portals. The corridor mouth is a hole in the
  // room's east wall, so the column through the hole sees much further than a
  // column aimed to the side, which stops at the room's own wall.
  const fb = shoot(2, 3, 0)
  const throughHole = depthAtEyeLevel(fb, Math.floor(fb.width / 2))
  const beside = depthAtEyeLevel(fb, 2)
  assert(
    throughHole > beside + 4,
    `the view through the doorway (${throughHole.toFixed(2)}) is not deeper than the wall beside it (${beside.toFixed(2)})`,
  )
})

test('a nearer surface is brighter than the same surface further away', () => {
  const fb = shoot(2, 3, 0)
  const middle = Math.floor(fb.width / 2)
  // Two floor rows: one just below the horizon, one at the bottom of the
  // frame. The lower row is nearer, so it must be brighter.
  const horizonRow = Math.floor(fb.height / 2)
  const near = fb.height - 1
  const far = horizonRow + 2
  const luminance = (row: number) => {
    const c = (row * fb.width + middle) * 3
    return fb.color[c]! + fb.color[c + 1]! + fb.color[c + 2]!
  }
  assert(
    luminance(near) > luminance(far),
    `the near floor (${luminance(near).toFixed(3)}) is not brighter than the far floor (${luminance(far).toFixed(3)})`,
  )
})

console.log('\nreadability')

test('a material contributes hue and nothing else', () => {
  // The invariant that keeps brightness in one place. If a material's own
  // luminance is not 1, it multiplies into every surface made of it and the
  // light stops being the whole story.
  for (const [name, material] of Object.entries(MATERIALS)) {
    const [r, g, b] = material.tint
    close(luminance(r, g, b), 1, 1e-9, `material ${name}`)
  }
})

test('surface classes are drawn with different glyphs', () => {
  // Exactly checkable, and the thing the first two attempts at lighting both
  // failed. A floor, a wall and a ceiling under the same lamp at the same
  // distance receive the same amount of light — so if the glyph comes from
  // light alone they are indistinguishable, whatever the colour does. Each
  // class gets its own family of characters instead, and the families must not
  // overlap or the separation is decorative.
  //
  // The space is shared: every family starts at "nothing here".
  const families = Object.entries(MATERIALS).map(
    ([name, material]) => [name, new Set([...material.ramp].filter((c) => c !== ' '))] as const,
  )
  const clashes: string[] = []
  for (let i = 0; i < families.length; i++) {
    for (let j = i + 1; j < families.length; j++) {
      const [aName, a] = families[i]!
      const [bName, b] = families[j]!
      const shared = [...a].filter((c) => b.has(c))
      if (shared.length > 0) clashes.push(`${aName} and ${bName} share ${JSON.stringify(shared.join(''))}`)
    }
  }
  assert(clashes.length === 0, clashes.join('; '))
})

test('within one class, distance shows as a change of glyph', () => {
  // The other half of the same idea. Separating the classes is worth nothing
  // if a wall two paces away and a wall twenty paces away look identical, so
  // the family has to be wide enough that the light actually moves through it.
  const thin: string[] = []
  for (const [name, material] of Object.entries(MATERIALS)) {
    const seen = new Set<number>()
    for (const distance of [1, 2, 4, 8, 16, 32]) {
      seen.add(rampChar(material.ramp, lightAt(1, distance)))
    }
    if (seen.size < 3) thin.push(`${name} shows ${seen.size} glyph(s) across the whole view distance`)
  }
  assert(thin.length === 0, thin.join('; '))
})

test('no single glyph is allowed to swallow the frame', () => {
  // The check this project most needed, arrived at on the third attempt.
  //
  // The first two builds of the lighting both failed in the picture and passed
  // in Node. One rendered the whole level into the bottom three levels of the
  // ramp — the top six were unreachable in principle, and the screen was a
  // dark smudge. The fix overshot and piled everything into the top instead.
  // The assertion in between them, "the view uses five levels and reaches
  // level six", was true of both, which is the definition of a check that
  // cannot fail.
  //
  // What separates a readable frame from either failure is not the extremes
  // but the *shape*: how much of the screen one character owns. Measured
  // across the viewpoints below, the busiest glyph holds 30% to 44%; the
  // too-bright build held 70% and the too-dark one 60%. The bar sits at 55%,
  // above what a healthy frame does and below both recorded failures.
  //
  // It counts the characters on screen rather than deriving them from colour.
  // Since each material forces its own glyph family, colour no longer decides
  // the glyph, and a check that recomputed one from luminance would be
  // measuring something the viewer never sees.
  const views: [string, number, number, number][] = [
    ['spawn', SPAWN.x, SPAWN.y, SPAWN.angle],
    ['corridor', 10, 3, 0],
    ['hall', 20, 8, -1.4],
  ]
  const crowded: string[] = []
  const bland: string[] = []

  for (const [name, x, y, angle] of views) {
    const fb = shoot(x, y, angle, 163, 50)
    const counts = new Map<number, number>()
    let drawn = 0
    for (let i = 0; i < fb.depth.length; i++) {
      if (fb.depth[i]! <= 0) continue
      drawn++
      counts.set(fb.chars[i]!, (counts.get(fb.chars[i]!) ?? 0) + 1)
    }
    assert(drawn > 0, `${name} drew nothing at all`)
    let busiest = 0
    let busiestChar = 0
    for (const [ch, count] of counts) {
      if (count > busiest) {
        busiest = count
        busiestChar = ch
      }
    }
    const share = busiest / drawn
    if (share > 0.55) {
      crowded.push(`${name}: ${JSON.stringify(String.fromCharCode(busiestChar))} holds ${(share * 100).toFixed(0)}%`)
    }
    if (counts.size < 4) bland.push(`${name}: only ${counts.size} distinct glyphs`)
  }

  assert(crowded.length === 0, `one glyph dominates the view — ${crowded.join('; ')}`)
  assert(bland.length === 0, `too little variety to read the geometry — ${bland.join('; ')}`)
})

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
