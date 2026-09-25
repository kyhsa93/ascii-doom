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
import { acrossFrom, buildLevel, castRay, lineOfSight, sectorAt, type SectorDef } from '../src/columns/level.ts'
import {
  DEFAULT_FOV_Y,
  MATERIALS,
  lightAt,
  projectionOf,
  renderView,
  rowOfHeight,
  type View,
} from '../src/columns/render.ts'
import { traceShot, type ShotBody } from '../src/columns/hitscan.ts'
import { drawBillboards, type Billboard, type Sprite } from '../src/columns/sprite.ts'
import { LAUNCHER, SCATTERGUN, SIDEARM, fire } from '../src/game/weapons.ts'
import { makeGoal, reachExit, summaryLayout, summaryLines } from '../src/game/exit.ts'
import { layoutHud, type HudSegment } from '../src/game/hud.ts'
import {
  activate,
  makeMover,
  moverInFront,
  updateMovers,
  type Mover,
  type MoverKind,
} from '../src/game/movers.ts'
import { LEVEL_1, LEVEL_1_MOVERS, SPAWN, sectorIndexByTag } from '../src/game/level1.ts'
import {
  damageActor,
  spawnActor,
  updateActors,
  type Actor,
  type ActorKind,
  provoke,
  type ActorState,
} from '../src/game/ai.ts'
import { collect, isUseful, type Carrier, type Pickup } from '../src/game/pickups.ts'
import {
  spawnProjectile,
  sweep,
  updateProjectiles,
  type Projectile,
  type ProjectileKind,
} from '../src/game/projectiles.ts'
import { PLAYER_RADIUS, moveBody, spawnPlayer, type Body } from '../src/game/player.ts'
import { ALL_SPRITES, LEVEL_1_PICKUPS } from '../src/game/things.ts'

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

/**
 * A creature built for the checks rather than for the game.
 *
 * Testing the machinery against the shipped cast would mean every tuning change
 * breaks a check about state transitions, and a check that has to be edited
 * whenever a number moves stops being read.
 *
 * It sits above every section that uses it, and that placement is load-bearing.
 * Function declarations are hoisted and a `const` is not, so a section further
 * up the file reaching for one further down throws at the moment it runs — even
 * indirectly, as the default argument of a helper it calls. That has now
 * happened twice in this file, once by borrowing another section's light and
 * once by borrowing this. Shared fixtures go above their users; sections do not
 * reach downward.
 */
const DUMMY_ART: Sprite = { rows: ['XX', 'XX'], tint: [1, 1, 1], width: 1, height: 1 }
const DUMMY: ActorKind = {
  name: 'dummy',
  sprite: DUMMY_ART,
  corpse: DUMMY_ART,
  radius: 0.4,
  height: 1.5,
  eye: 1.1,
  health: 20,
  speed: 2,
  sightRange: 20,
  reach: 0.8,
  damage: 10,
  windUp: 0.3,
  recovery: 0.5,
  painTime: 0.3,
  painChance: 0.5,
  deathTime: 0.5,
}

console.log('\nshooting')

/** A shooter standing somewhere, facing a given way. */
function shooterAt(x: number, y: number, angle: number): Body & { angle: number } {
  return { ...bodyAt(x, y), angle }
}

test('a shot down an empty corridor stops where the map says the wall is', () => {
  // Same sight line the renderer walks: from the spawn, nothing solid until
  // the hall's east wall at x=26. Twenty-four units, from the map rather than
  // from the tracer.
  const shot = traceShot(LEVEL_1, sectorAt(LEVEL_1, 2, 3), 2, 3, 1.6, 0, 40, [])
  close(shot.distance, 24, 0.05, 'distance to the hall east wall')
  assert(shot.hit === null, 'an empty corridor reported a hit')
})

test('a creature in front of a wall is hit and the wall behind it is not reached', () => {
  const target: ShotBody = { x: 12, y: 3, radius: 0.45 }
  const shot = traceShot(LEVEL_1, sectorAt(LEVEL_1, 2, 3), 2, 3, 1.6, 0, 40, [target])
  assert(shot.hit !== null, 'a creature standing in the corridor was not hit')
  close(shot.distance, 10, 0.5, 'distance to the creature')
})

test('a creature behind a wall is not hit, however well lined up', () => {
  // Directly in line and within range, but on the other side of the hall's far
  // wall. A nearest-body search that forgot to find the wall first would hit it.
  const behind: ShotBody = { x: 28, y: 3, radius: 0.45 }
  const shot = traceShot(LEVEL_1, sectorAt(LEVEL_1, 2, 3), 2, 3, 1.6, 0, 40, [behind])
  assert(shot.hit === null, 'a shot went through the wall')
  close(shot.distance, 24, 0.05, 'the shot still stops at the wall')
})

test('a shot that passes wide of a creature misses it', () => {
  // Half a metre off the line, against a radius of 0.45: the edge case that
  // separates a cylinder test from "roughly in that direction".
  const beside: ShotBody = { x: 12, y: 3.6, radius: 0.45 }
  const shot = traceShot(LEVEL_1, sectorAt(LEVEL_1, 2, 3), 2, 3, 1.6, 0, 40, [beside])
  assert(shot.hit === null, 'a shot 0.6 units off centre hit a 0.45 radius body')

  const clipped: ShotBody = { x: 12, y: 3.3, radius: 0.45 }
  const grazing = traceShot(LEVEL_1, sectorAt(LEVEL_1, 2, 3), 2, 3, 1.6, 0, 40, [clipped])
  assert(grazing.hit !== null, 'a shot inside the radius missed')
})

test('the nearest of two creatures in line is the one hit', () => {
  const near: ShotBody = { x: 10, y: 3, radius: 0.45 }
  const far: ShotBody = { x: 16, y: 3, radius: 0.45 }
  const shot = traceShot(LEVEL_1, sectorAt(LEVEL_1, 2, 3), 2, 3, 1.6, 0, 40, [far, near])
  assert(shot.hit !== null, 'neither creature was hit')
  assert(shot.hit.index === 1, 'the far creature was hit through the near one')
})

test('a dead creature does not stop a shot', () => {
  const bodies: ShotBody[] = [
    { x: 10, y: 3, radius: 0.45 },
    { x: 16, y: 3, radius: 0.45 },
  ]
  const shot = traceShot(LEVEL_1, sectorAt(LEVEL_1, 2, 3), 2, 3, 1.6, 0, 40, bodies, (i) => i !== 0)
  assert(shot.hit !== null && shot.hit.index === 1, 'the shot did not pass through the dead one')
})

test('firing damages what it hits, and a cone spreads', () => {
  const shooter = shooterAt(2, 3, 0)
  const victim = actorAt(10, 3, Math.PI)
  const before = victim.health
  // Randomness pinned to the middle: no spread, no pain roll surprises.
  const result = fire(LEVEL_1, shooter, SIDEARM, [victim], 1.6, -1, () => 0.5)
  assert(result.shots.length === 0, 'an instant weapon put something in flight')
  assert(result.hits === 1, `expected one pellet to connect, got ${result.hits}`)
  assert(victim.health === before - SIDEARM.damage, `health went ${before} to ${victim.health}`)

  // The scattergun throws its pellets across a cone, so with the random source
  // walking from one edge to the other the ends must not all be the same place.
  const wide = shooterAt(2, 3, 0)
  let roll = 0
  const spread = fire(LEVEL_1, wide, SCATTERGUN, [], 1.6, -1, () => (roll++ % 2 === 0 ? 0 : 1))
  const ys = new Set(spread.ends.map((end) => end.y.toFixed(2)))
  assert(ys.size > 1, 'every pellet of a spread weapon landed in the same place')
})

test('a thrown weapon resolves nothing at the muzzle', () => {
  // The difference between the launcher and everything else. An instant weapon
  // has already hit or missed by the time `fire` returns; this one has only
  // put something in the air, and the flight decides later.
  const shooter = shooterAt(2, 3, 0)
  const victim = actorAt(10, 3, Math.PI)
  const before = victim.health

  const result = fire(LEVEL_1, shooter, LAUNCHER, [victim], 1.6, 7, () => 0.5)

  assert(result.hits === 0, `a thrown weapon reported ${result.hits} immediate hits`)
  assert(result.shots.length === 1, `expected one slug in flight, got ${result.shots.length}`)
  assert(victim.health === before, 'the target was damaged before the slug had gone anywhere')
  assert(result.shots[0]!.owner === 7, `the slug was fired by ${result.shots[0]!.owner} rather than its shooter`)
})

console.log('\nthings in flight')

const BOLT: ProjectileKind = { sprite: DUMMY_ART, speed: 12, damage: 6, life: 4 }

/**
 * Reads a length without letting the compiler narrow it.
 *
 * Third time in this file. Asserting `list.length === 2` narrows that
 * expression to the literal 2, so a later comparison against any other number
 * is reported as impossible — even though the call in between changes it.
 */
function countOf(list: readonly unknown[]): number {
  return list.length
}

/** Runs a flight for a while and hands back everything it hit. */
function fly(projectiles: Projectile[], bodies: ShotBody[], seconds: number): ReturnType<typeof updateProjectiles> {
  const dt = 1 / 60
  const all: ReturnType<typeof updateProjectiles> = []
  for (let t = 0; t < seconds; t += dt) {
    for (const impact of updateProjectiles(LEVEL_1, projectiles, bodies, dt)) all.push(impact)
  }
  return all
}

test('a bolt stops at the wall the map says is there', () => {
  // The same twenty-four units the sight line and the hitscan both find, now
  // travelled over time. Reusing the traced step rather than writing a second
  // collision path is what makes that agreement automatic.
  const bolt = spawnProjectile(BOLT, 2, 3, 1.6, 0, sectorAt(LEVEL_1, 2, 3), -1)
  const impacts = fly([bolt], [], 5)
  assert(impacts.length === 1, `expected one impact, got ${impacts.length}`)
  assert(impacts[0]!.body === -1, 'the bolt reported hitting a body in an empty corridor')
  close(impacts[0]!.x, 26, 0.2, 'where the bolt stopped')
  assert(!bolt.alive, 'the bolt survived hitting a wall')
})

test('a bolt does not hit whoever fired it', () => {
  // Creatures stand inside their own radius at the moment they shoot, so
  // without this every ranged attack detonates on its author.
  const shooter: ShotBody = { x: 2, y: 3, radius: 0.45 }
  const bolt = spawnProjectile(BOLT, 2, 3, 1.6, 0, sectorAt(LEVEL_1, 2, 3), 0)
  const impacts = fly([bolt], [shooter], 5)
  assert(impacts.length === 1 && impacts[0]!.body === -1, 'the bolt hit its own shooter')
})

test('a bolt hits the nearest thing in its way', () => {
  const near: ShotBody = { x: 10, y: 3, radius: 0.45 }
  const far: ShotBody = { x: 16, y: 3, radius: 0.45 }
  const bolt = spawnProjectile(BOLT, 2, 3, 1.6, 0, sectorAt(LEVEL_1, 2, 3), -1)
  const impacts = fly([bolt], [far, near], 5)
  assert(impacts.length === 1, `expected one impact, got ${impacts.length}`)
  assert(impacts[0]!.body === 1, 'the bolt passed through the near body to reach the far one')
})

test('a bolt that hits nothing gives up rather than flying forever', () => {
  // Without a life, a projectile aimed down a long open sector keeps costing a
  // trace every frame for as long as the level is loaded.
  const brief: ProjectileKind = { ...BOLT, life: 0.2, speed: 2 }
  const bolt = spawnProjectile(brief, 16, 8, 1.6, Math.PI / 2, sectorAt(LEVEL_1, 16, 8), -1)
  const impacts = fly([bolt], [], 1)
  assert(impacts.length === 0, 'a bolt that ran out of time reported an impact')
  assert(!bolt.alive, 'the bolt is still in flight after its life ran out')
})

test('a bolt that misses you can still hit whoever it was fired past', () => {
  // The claim the last commit made and nothing checked: a projectile hits
  // anything that is not its owner, so a creature's shot going wide lands on
  // another creature. Worth its own check because it is the one piece of
  // behaviour that exists only as an absence — there is no code anywhere saying
  // creatures may hurt each other, and an innocent-looking tightening of the
  // predicate would remove it silently.
  //
  // Named for what it actually does. The struck creature takes the damage; it
  // does not turn on its attacker, because nothing retargets yet and calling
  // this infighting would be describing a thing that is not here.
  const hallSector = sectorAt(LEVEL_1, 16, 0)
  assert(hallSector >= 0, 'the test spot is outside the map')

  const shooter = spawnActor(DUMMY, 16, 0, hallSector, LEVEL_1.sectors[hallSector]!.floor)
  const bystander = spawnActor(DUMMY, 20, 0, sectorAt(LEVEL_1, 20, 0), LEVEL_1.sectors[hallSector]!.floor)
  const crowd = [shooter, bystander]

  const bolt = spawnProjectile(BOLT, shooter.x, shooter.y, 1.6, 0, hallSector, 0)
  const impacts = fly([bolt], crowd, 3)

  assert(impacts.length === 1, `expected one impact, got ${impacts.length}`)
  assert(impacts[0]!.body === 1, `the bolt hit body ${impacts[0]!.body} rather than the one in its way`)

  // And the damage is the caller's to apply, which is what the page does.
  const before = bystander.health
  damageActor(bystander, bolt.kind.damage, () => 0.99)
  assert(bystander.health === before - BOLT.damage, `health went ${before} to ${bystander.health}`)
  assert(bystander.awake, 'being shot did not wake it')
})

test('spent bolts are swept, and only when asked', () => {
  // They are left in the array while flying so that drawing them can iterate
  // the same list without entries vanishing underneath it.
  const bolts = [
    spawnProjectile(BOLT, 2, 3, 1.6, 0, sectorAt(LEVEL_1, 2, 3), -1),
    spawnProjectile(BOLT, 2, 3, 1.6, 0, sectorAt(LEVEL_1, 2, 3), -1),
  ]
  fly(bolts, [], 5)
  assert(countOf(bolts) === 2, 'the update removed entries while they were being iterated')
  sweep(bolts)
  assert(countOf(bolts) === 0, `sweeping left ${bolts.length} spent bolts behind`)
})

console.log('\ncreatures')

/** A player-shaped body standing somewhere in the first level. */
function bodyAt(x: number, y: number): Body {
  const sector = sectorAt(LEVEL_1, x, y)
  assert(sector >= 0, `(${x}, ${y}) is outside the map`)
  return { x, y, sector, floor: LEVEL_1.sectors[sector]!.floor, radius: 0.35, height: 1.75 }
}

function actorAt(x: number, y: number, angle: number, kind: ActorKind = DUMMY): Actor {
  const sector = sectorAt(LEVEL_1, x, y)
  assert(sector >= 0, `(${x}, ${y}) is outside the map`)
  const actor = spawnActor(kind, x, y, sector, LEVEL_1.sectors[sector]!.floor)
  actor.angle = angle
  return actor
}

/**
 * Reads a creature's state without letting the compiler narrow it.
 *
 * Assigning `actor.state = 'chasing'` narrows the property to that one literal,
 * and TypeScript has no way to know that passing the actor to `updateActors`
 * can change it — so a later comparison against any other state is reported as
 * impossible. Reading through a function typed to return the whole union says
 * what is actually true: the state is whatever the simulation left there.
 */
function stateOf(actor: Actor): ActorState {
  return actor.state
}

/** Runs the simulation for a while at a fixed step, and totals the damage. */
function simulate(actors: Actor[], target: Body, seconds: number, random = () => 0.5): number {
  let damage = 0
  const step = 1 / 60
  for (let t = 0; t < seconds; t += step) {
    damage += updateActors(LEVEL_1, actors, target, 1.6, step, { random }).damage
  }
  return damage
}

test('a creature facing away does not notice you, and one facing you does', () => {
  // The difference between walking into a room and being seen walking into it.
  // Both creatures have identical sight lines; only the facing differs.
  const player = bodyAt(16, 4)
  const away = actorAt(20, 4, 0)
  const toward = actorAt(20, 4, Math.PI)

  simulate([away], player, 0.5)
  assert(away.state === 'dormant', `a creature facing away woke anyway (${away.state})`)

  simulate([toward], player, 0.5)
  assert(toward.state !== 'dormant', 'a creature facing you stayed asleep')
})

test('a wall keeps a creature asleep however close you stand', () => {
  // The start room and the hall are nowhere near each other in a straight line.
  const player = bodyAt(2, 3)
  const actor = actorAt(20, 8, Math.PI)
  simulate([actor], player, 1)
  assert(actor.state === 'dormant', `a creature two rooms away woke (${actor.state})`)
})

test('a woken creature closes the distance', () => {
  const player = bodyAt(16, 4)
  const actor = actorAt(24, 4, Math.PI)
  const before = Math.hypot(actor.x - player.x, actor.y - player.y)
  simulate([actor], player, 1.5)
  const after = Math.hypot(actor.x - player.x, actor.y - player.y)
  assert(after < before - 1, `distance went from ${before.toFixed(2)} to ${after.toFixed(2)}`)
})

test('standing still in reach gets you hit; backing off during the wind-up does not', () => {
  // The whole of how a melee creature is played around, and the reason the blow
  // is resolved when it lands rather than when it is decided.
  const standing = bodyAt(16, 4)
  const attacker = actorAt(16.9, 4, Math.PI)
  attacker.state = 'chasing'
  const taken = simulate([attacker], standing, 2)
  assert(taken > 0, 'a creature stood next to you for two seconds without landing a blow')

  const dodger = bodyAt(16, 4)
  const other = actorAt(16.9, 4, Math.PI)
  other.state = 'chasing'
  let dodged = 0
  const step = 1 / 60
  for (let t = 0; t < 2; t += step) {
    dodged += updateActors(LEVEL_1, [other], dodger, 1.6, step, { random: () => 0.5 }).damage
    // Step away the moment it commits, and keep going.
    if (stateOf(other) === 'winding') dodger.x -= 0.12
  }
  assert(dodged < taken, `backing away took ${dodged} against ${taken} for standing still`)
})

test('pain chance decides whether a hit interrupts, and death always does', () => {
  // Pinned randomness, because "sometimes flinches" is untestable and the
  // reason the chance exists — a creature that always flinches can be held in
  // place forever by the weakest weapon.
  const never = actorAt(20, 4, 0, { ...DUMMY, painChance: 0 })
  never.state = 'chasing'
  damageActor(never, 1, () => 0)
  assert(stateOf(never) === 'chasing', `a creature with no pain chance flinched (${never.state})`)

  const always = actorAt(20, 4, 0, { ...DUMMY, painChance: 1 })
  always.state = 'chasing'
  damageActor(always, 1, () => 0)
  assert(stateOf(always) === 'hurt', `a creature that always flinches did not (${always.state})`)

  const dying = actorAt(20, 4, 0)
  const killed = damageActor(dying, DUMMY.health, () => 0.99)
  assert(killed, 'the killing blow was not reported as one')
  assert(dying.state === 'dying', `a creature at zero health is ${dying.state}`)
})

test('a creature turned on another one goes for it instead of you', () => {
  // The thing the README said was missing. Everything needed was already
  // there — the impact knows who fired, the damage knows who was hit — so this
  // is a grudge on the creature and a target resolved through it, not a second
  // kind of enemy.
  const player = bodyAt(16, 4)
  const angry = actorAt(20, 4, Math.PI)
  const victim = actorAt(24, 4, Math.PI)
  angry.state = 'chasing'

  const toPlayer = Math.hypot(angry.x - player.x, angry.y - player.y)
  const toVictim = Math.hypot(angry.x - victim.x, angry.y - victim.y)

  provoke(angry, 1)
  simulate([angry, victim], player, 1.2)

  const nowPlayer = Math.hypot(angry.x - player.x, angry.y - player.y)
  const nowVictim = Math.hypot(angry.x - victim.x, angry.y - victim.y)
  assert(nowVictim < toVictim - 0.5, `it did not close on the creature it was provoked by (${toVictim.toFixed(2)} to ${nowVictim.toFixed(2)})`)
  assert(nowPlayer > toPlayer, 'it walked toward the player while holding a grudge against something else')
})

test('a grudge lapses when the thing it is against dies', () => {
  // Otherwise a creature stands over a corpse indefinitely while you shoot it
  // in the back, which is worse than it sounds: the level stops fighting you.
  const player = bodyAt(16, 4)
  const angry = actorAt(20, 4, Math.PI)
  const victim = actorAt(24, 4, Math.PI)
  angry.state = 'chasing'

  provoke(angry, 1)
  damageActor(victim, 9999, () => 0.99)
  simulate([angry, victim], player, 2)

  assert(angry.grudge === -1, `the grudge survived its object, still pointing at ${angry.grudge}`)
})

test('hurting the player creates no grudge', () => {
  // The default is the player and stays the player. A creature that could be
  // provoked by the person it is already hunting would forget what it was
  // doing every time it landed a blow.
  const angry = actorAt(20, 4, Math.PI)
  assert(angry.grudge === -1, 'a creature spawned already angry at something')
  damageActor(angry, 1, () => 0.99)
  assert(angry.grudge === -1, 'being hurt set a grudge by itself')
})

test('the dead stop acting', () => {
  const player = bodyAt(16, 4)
  const actor = actorAt(16.9, 4, Math.PI)
  damageActor(actor, 999, () => 0.99)
  const damage = simulate([actor], player, 3)
  assert(damage === 0, `a dead creature dealt ${damage} damage`)
  assert(actor.state === 'dead', `after three seconds it is ${actor.state}`)
})

console.log('\nsight')

/** Eye height above a floor, matching the player's. */
const EYE = 1.6

test('two points in the same room can see each other', () => {
  const a = sectorAt(LEVEL_1, 2, 2)
  assert(lineOfSight(LEVEL_1, a, 2, 2, EYE, 6, 5, EYE), 'across the start room')
})

test('a solid wall blocks sight', () => {
  // The start room's south wall is at y=0; a point past it is outside the map
  // entirely, which is the strongest form of "not visible".
  const a = sectorAt(LEVEL_1, 2, 3)
  assert(!lineOfSight(LEVEL_1, a, 2, 3, EYE, 2, -4, EYE), 'through the south wall')
})

test('a doorway is see-through and the wall beside it is not', () => {
  // The corridor mouth spans y=2 to y=4 in the room's east wall. Same origin,
  // two targets a metre apart: one through the hole, one into the wall.
  const a = sectorAt(LEVEL_1, 2, 3)
  assert(lineOfSight(LEVEL_1, a, 2, 3, EYE, 13, 3, EYE), 'along the corridor')
  assert(!lineOfSight(LEVEL_1, a, 2, 3, EYE, 13, 5.5, EYE), 'into the wall beside the corridor mouth')
})

test('sight is symmetric', () => {
  // A property rather than a restatement of the walk, and the one that catches
  // a bug in how the sector chain is followed: if A can see B, then B can see
  // A, whichever end the crossings are enumerated from.
  const pairs: [number, number, number, number][] = [
    [2, 3, 13, 3],
    [2, 2, 6, 5],
    [2, 3, 20, 4],
    [16, 0, 24, 8],
    [20, 4, 2, 3],
  ]
  const wrong: string[] = []
  for (const [ax, ay, bx, by] of pairs) {
    const sa = sectorAt(LEVEL_1, ax, ay)
    const sb = sectorAt(LEVEL_1, bx, by)
    if (sa < 0 || sb < 0) continue
    const forward = lineOfSight(LEVEL_1, sa, ax, ay, EYE, bx, by, EYE)
    const back = lineOfSight(LEVEL_1, sb, bx, by, EYE, ax, ay, EYE)
    if (forward !== back) wrong.push(`(${ax},${ay})->(${bx},${by}) is ${forward} but the reverse is ${back}`)
  }
  assert(wrong.length === 0, wrong.join('; '))
})

test('a step blocks a low sight line and not a standing one', () => {
  // The platform floor is at 0.6. Looking across the hall at ankle height the
  // step is in the way; at eye height it is not. No flag decides this — the
  // opening between the two floors does, which is the same arithmetic that
  // makes a shut door opaque.
  const a = sectorAt(LEVEL_1, 16, 4)
  const b = sectorAt(LEVEL_1, 24, 4)
  assert(a >= 0 && b >= 0, 'both ends of the hall should be inside sectors')
  assert(lineOfSight(LEVEL_1, a, 16, 4, 1.6, 24, 4, 1.6), 'standing, across the platform')
  assert(!lineOfSight(LEVEL_1, a, 16, 4, 0.3, 24, 4, 0.3), 'at ankle height, through the step')
})

console.log('\nsprites')

/**
 * A test sprite made of one character no material uses.
 *
 * Counting cells is then unambiguous: an X on screen came from the billboard
 * and nothing else. Reusing a wall glyph would make "was it drawn" depend on
 * what the room behind it happens to look like.
 */
const MARKER: Sprite = {
  rows: ['XXXX', 'XXXX', 'XXXX', 'XXXX'],
  tint: [1, 1, 1],
  width: 1,
  height: 1,
}

/** The cells a billboard actually painted, as a bounding box. */
function markerBox(fb: Framebuffer): { count: number; minX: number; maxX: number; minY: number; maxY: number } {
  let count = 0
  let minX = Infinity
  let maxX = -1
  let minY = Infinity
  let maxY = -1
  for (let row = 0; row < fb.height; row++) {
    for (let col = 0; col < fb.width; col++) {
      if (fb.chars[row * fb.width + col] !== 88) continue
      count++
      minX = Math.min(minX, col)
      maxX = Math.max(maxX, col)
      minY = Math.min(minY, row)
      maxY = Math.max(maxY, row)
    }
  }
  return { count, minX, maxX, minY, maxY }
}

/** Renders the level from the spawn and puts one marker where asked. */
function shootWithMarker(things: Billboard[], x = 2, y = 3, angle = 0): Framebuffer {
  const fb = new Framebuffer(163, 50)
  fb.clear(0, 0, 0, 0)
  const view: View = { x, y, z: 1.6, angle, sector: sectorAt(LEVEL_1, x, y), fovY: DEFAULT_FOV_Y }
  renderView(fb, LEVEL_1, view, 0.574, {})
  drawBillboards(fb, view, 0.574, things, {})
  return fb
}

test('sprite art is rectangular', () => {
  // The sampler clamps rather than crashing on a short row, so a typo in the
  // art shows up as a column of the wrong character rather than as an error.
  const ragged: string[] = []
  for (const [name, sprite] of Object.entries(ALL_SPRITES)) {
    const widths = new Set(sprite.rows.map((row) => row.length))
    if (widths.size !== 1) ragged.push(`${name} has rows of ${[...widths].sort((a, b) => a - b).join(', ')} characters`)
  }
  assert(ragged.length === 0, ragged.join('; '))
})

test('sprite art is dense enough for the distance it is met at', () => {
  // Magnifying a grid of characters does not blur it, it repeats it: a row
  // stretched to three times its width comes out as LLLL and vvvvvv. The first
  // set of art here was drawn at four rows tall and only reached one character
  // per cell at ten to twelve units, so it was magnified three to twelve times
  // for the whole of every encounter.
  //
  // Five units is the bar: a creature that close is being fought, and the art
  // has to be at least as detailed as the space it fills. Past that it shrinks,
  // and shrinking drops detail rather than smearing it.
  const { planeHalf, projScale } = projectionOf(163, 50, 0.574, DEFAULT_FOV_Y)
  const distance = 5
  const thin: string[] = []
  for (const [name, sprite] of Object.entries(ALL_SPRITES)) {
    const screenWide = (sprite.width / (distance * planeHalf)) * (163 / 2)
    const screenTall = (sprite.height * projScale) / distance
    const artWide = sprite.rows[0]!.length
    const artTall = sprite.rows.length
    if (screenWide > artWide) thin.push(`${name} is ${screenWide.toFixed(0)} cells wide from ${artWide} characters`)
    if (screenTall > artTall) thin.push(`${name} is ${screenTall.toFixed(0)} cells tall from ${artTall} rows`)
  }
  assert(thin.length === 0, `art is magnified at ${distance} units — ${thin.join('; ')}`)
})

test('a thing straight ahead is drawn straight ahead', () => {
  // The invariant that ties billboards to the same projection as the walls. If
  // the two disagreed at all, a creature would sit beside the doorway it is
  // standing in, and no assertion about its size would notice.
  const fb = shootWithMarker([{ x: 12, y: 3, z: 0, light: 1, sprite: MARKER }])
  const box = markerBox(fb)
  assert(box.count > 0, 'nothing was drawn for a thing in plain view')
  const centre = (box.minX + box.maxX) / 2
  close(centre, (fb.width - 1) / 2, 1, 'the centre column of a thing dead ahead')
})

test('a thing twice as far is half as large, in both directions', () => {
  // Perspective again, and the check that catches a sprite scaled by distance
  // on one axis only — which looks almost right and is the usual bug.
  const near = markerBox(shootWithMarker([{ x: 7, y: 3, z: 0, light: 1, sprite: MARKER }]))
  const far = markerBox(shootWithMarker([{ x: 12, y: 3, z: 0, light: 1, sprite: MARKER }]))
  const nearWide = near.maxX - near.minX + 1
  const farWide = far.maxX - far.minX + 1
  const nearTall = near.maxY - near.minY + 1
  const farTall = far.maxY - far.minY + 1
  // Five units away against ten: half the size, within a cell of rounding.
  close(farWide, nearWide / 2, 1.5, 'width at twice the distance')
  close(farTall, nearTall / 2, 1.5, 'height at twice the distance')
})

test('a thing whose top is at eye level has its top on the horizon', () => {
  // The same independent invariant the wall projection is held to, applied to
  // the other drawing path. It pins the vertical placement without restating
  // the formula: at any distance, a surface at eye height is on the horizon.
  const tall: Sprite = { ...MARKER, height: 1.6 }
  for (const x of [7, 12, 20]) {
    const box = markerBox(shootWithMarker([{ x, y: 3, z: 0, light: 1, sprite: tall }]))
    assert(box.count > 0, `nothing drawn at ${x} units`)
    close(box.minY, 25, 1, `top row of a thing whose head is at eye height, ${x} units away`)
  }
})

test('a thing behind a wall is not drawn, and the same thing in front of it is', () => {
  // Occlusion comes from the depth the wall renderer already wrote, so this is
  // really a check that the two paths agree about distance. The hall's east
  // wall is at x=26.
  const behind = markerBox(shootWithMarker([{ x: 27.5, y: 3, z: 0, light: 1, sprite: MARKER }]))
  assert(behind.count === 0, `${behind.count} cells of a thing beyond the far wall were drawn`)

  const front = markerBox(shootWithMarker([{ x: 24, y: 3, z: 0, light: 1, sprite: MARKER }]))
  assert(front.count > 0, 'a thing in the open hall was not drawn at all')
})

console.log('\ndoors and lifts')

/**
 * Room, door, room — three sectors in a line, sharing full-width edges so no
 * junction needs splitting.
 *
 * Built here rather than borrowed from the game's map so that adding a door to
 * the level cannot change what these checks mean, and so that the shut height
 * is exactly the floor: a door with no gap at all is the case every one of the
 * three consumers has to get right.
 */
function doorLevel() {
  return buildLevel([
    {
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      floor: 0,
      ceiling: 3,
      light: 1,
    },
    {
      polygon: [
        [4, 0],
        [6, 0],
        [6, 4],
        [4, 4],
      ],
      floor: 0,
      ceiling: 0,
      light: 1,
    },
    {
      polygon: [
        [6, 0],
        [10, 0],
        [10, 4],
        [6, 4],
      ],
      floor: 0,
      ceiling: 3,
      light: 1,
    },
  ])
}

const DOOR_KIND: MoverKind = { surface: 'ceiling', shut: 0, open: 3, speed: 3, wait: 2 }

/**
 * Reads a body's sector without letting the compiler narrow it.
 *
 * The same shape as `stateOf` above: building a body with `sector: 0` narrows
 * the property to that literal, and TypeScript cannot know that `moveBody`
 * changes it, so comparing against any other sector is reported as impossible.
 */
function sectorOf(body: Body): number {
  return body.sector
}

/** Runs movers for a while at the simulation's own step. */
function runMovers(level: ReturnType<typeof doorLevel>, movers: Mover[], bodies: Body[], seconds: number): void {
  const step = 1 / 60
  for (let t = 0; t < seconds; t += step) updateMovers(level, movers, bodies, step)
}

test('a door opens to exactly its open height and no further', () => {
  // Two seconds, deliberately. This door takes one second to travel and then
  // waits two, so five seconds would run the whole cycle and find it shut
  // again — which is what the first version of this check asserted against,
  // and the failure was mine rather than the door's. Measuring a thing that
  // moves means saying when.
  const level = doorLevel()
  const door = makeMover(1, DOOR_KIND)
  activate(door)
  runMovers(level, [door], [], 2)
  close(level.sectors[1]!.ceiling, DOOR_KIND.open, 1e-9, 'the open height')
  assert(door.state === 'open', `the door settled as ${door.state}`)
})

test('a shut door blocks movement and sight, and an open one does not', () => {
  // The claim this whole module rests on. Nothing here knows what a door is:
  // the collision code asks whether a body fits through the opening and the
  // sight code asks whether a line clears it, and both already did that before
  // movers existed. If a moving ceiling did not change those answers, the idea
  // that one rule serves all three would simply be wrong.
  const level = doorLevel()
  const door = makeMover(1, DOOR_KIND)

  const eye = 1.6
  assert(!lineOfSight(level, 0, 2, 2, eye, 8, 2, eye), 'a shut door was see-through')

  const walker: Body = { x: 3, y: 2, sector: 0, floor: 0, radius: 0.35, height: 1.75 }
  for (let i = 0; i < 60; i++) moveBody(level, walker, 0.1, 0)
  assert(sectorOf(walker) === 0, `a shut door was walked through into sector ${walker.sector}`)

  activate(door)
  runMovers(level, [door], [], 3)
  assert(lineOfSight(level, 0, 2, 2, eye, 8, 2, eye), 'an open door was not see-through')

  for (let i = 0; i < 80; i++) moveBody(level, walker, 0.1, 0)
  assert(sectorOf(walker) === 2, `an open door was not walked through; ended in sector ${walker.sector}`)
})

test('a door with a wait shuts itself, and one without stays open', () => {
  const level = doorLevel()
  const door = makeMover(1, DOOR_KIND)
  activate(door)
  runMovers(level, [door], [], 1.5)
  close(level.sectors[1]!.ceiling, DOOR_KIND.open, 1e-9, 'open before the wait runs out')
  runMovers(level, [door], [], 4)
  close(level.sectors[1]!.ceiling, DOOR_KIND.shut, 1e-9, 'shut again after the wait')

  const held = doorLevel()
  const lift = makeMover(1, { ...DOOR_KIND, wait: 0 })
  activate(lift)
  runMovers(held, [lift], [], 10)
  close(held.sectors[1]!.ceiling, DOOR_KIND.open, 1e-9, 'a mover with no wait stays where it was sent')
})

test('a closing door reverses rather than crushing whoever is under it', () => {
  // The original's behaviour, and the only reason this module knows bodies
  // exist. A creature blocks a door exactly as a player does, because what is
  // consulted is the height of the body and not what kind of thing it is.
  const level = doorLevel()
  const door = makeMover(1, DOOR_KIND)
  const standing: Body = { x: 5, y: 2, sector: 1, floor: 0, radius: 0.35, height: 1.75 }

  activate(door)
  runMovers(level, [door], [standing], 5)
  // Past the wait, it has tried to close and found somebody there.
  assert(level.sectors[1]!.ceiling >= standing.height, `the ceiling came down to ${level.sectors[1]!.ceiling}`)

  // Step out, and it finishes closing.
  standing.sector = 2
  runMovers(level, [door], [standing], 6)
  close(level.sectors[1]!.ceiling, DOOR_KIND.shut, 1e-9, 'shut once the way is clear')
})

test('triggering a closing door sends it back up', () => {
  const level = doorLevel()
  const door = makeMover(1, DOOR_KIND)
  activate(door)
  runMovers(level, [door], [], 3.5)
  assert(door.state === 'closing', `expected it to be closing, found ${door.state}`)
  const midway = level.sectors[1]!.ceiling
  activate(door)
  runMovers(level, [door], [], 0.5)
  assert(level.sectors[1]!.ceiling > midway, 'a door triggered while closing kept closing')
})

test('a locked door refuses until the key is held', () => {
  // The lock lives on the door rather than in whoever presses the button, so
  // that every route to opening one has to go past it. A caller that forgot to
  // ask would otherwise open it, and there is more than one caller.
  const level = doorLevel()
  const locked = makeMover(1, { ...DOOR_KIND, requiresKey: 'amber' })

  assert(activate(locked) === false, 'a locked door opened for someone with no keys')
  runMovers(level, [locked], [], 2)
  close(level.sectors[1]!.ceiling, DOOR_KIND.shut, 1e-9, 'a locked door moved anyway')

  assert(activate(locked, new Set(['brass'])) === false, 'the wrong key opened it')
  assert(activate(locked, new Set(['amber'])) === true, 'the right key was refused')
  runMovers(level, [locked], [], 2)
  close(level.sectors[1]!.ceiling, DOOR_KIND.open, 1e-9, 'it did not open once unlocked')
})

test('the use key finds the door you are facing and nothing else', () => {
  // Which door a press opens is a rule with a right answer, so it is checked
  // at exact positions here rather than by driving a browser across the level
  // and hoping. Three cases: in front of it, turned away from it, and nowhere
  // near it.
  const built: Mover[] = LEVEL_1_MOVERS.map((entry) => {
    const sector = sectorIndexByTag(LEVEL_1, entry.tag)
    assert(sector >= 0, `no sector tagged ${entry.tag}`)
    return makeMover(sector, entry.kind)
  })
  const door = sectorIndexByTag(LEVEL_1, 'door-north')

  const inHall = sectorAt(LEVEL_1, 19, 9)
  assert(inHall >= 0, 'the spot in front of the door is outside the map')

  const facing = moverInFront(LEVEL_1, built, inHall, 19, 9, Math.PI / 2)
  assert(facing !== null && facing.sector === door, 'standing in front of the door did not find it')

  const turned = moverInFront(LEVEL_1, built, inHall, 19, 9, -Math.PI / 2)
  assert(turned === null, 'facing away from the door still found it')

  const away = sectorAt(LEVEL_1, 2, 3)
  assert(moverInFront(LEVEL_1, built, away, 2, 3, 0) === null, 'a door was found from the other end of the level')
})

console.log('\nplaying it through')

test('the level can actually be finished', () => {
  // The gap every other check left open. They each exercise one piece, so a
  // key placed out of reach, a lift that will not carry a body, or a door that
  // opens onto nothing would leave all of them passing and the level
  // impossible. Nobody had ever been from the spawn to the exit.
  //
  // This drives the same functions the page drives, in the same order, so what
  // it proves is that the rules make the level completable. Whether the page
  // wires them up correctly is a separate claim and the browser checks make it.
  // The level and its pickups are module state shared with every other check
  // in this file, and playing through mutates both: doors end up open, the lift
  // ends up raised, supplies end up taken. Nothing below happens to depend on
  // those today, which is exactly the kind of luck that stops holding. Saved
  // here and put back before the assertions, so a failure leaves the world as
  // clean as a pass does.
  const savedHeights = LEVEL_1.sectors.map((sector) => ({ floor: sector.floor, ceiling: sector.ceiling }))
  const savedTaken = LEVEL_1_PICKUPS.map((pickup) => pickup.taken)
  const restore = () => {
    LEVEL_1.sectors.forEach((sector, index) => {
      sector.floor = savedHeights[index]!.floor
      sector.ceiling = savedHeights[index]!.ceiling
    })
    LEVEL_1_PICKUPS.forEach((pickup, index) => {
      pickup.taken = savedTaken[index]!
    })
  }

  const player = spawnPlayer(LEVEL_1, SPAWN.x, SPAWN.y, SPAWN.angle)
  const carried: Carrier = {
    health: 100,
    maxHealth: 100,
    ammo: [60, 24],
    ammoMax: [120, 48],
    keys: new Set<string>(),
  }
  const built: Mover[] = LEVEL_1_MOVERS.map((entry) => {
    const sector = sectorIndexByTag(LEVEL_1, entry.tag)
    assert(sector >= 0, `no sector tagged ${entry.tag}`)
    return makeMover(sector, entry.kind)
  })
  const exitSector = sectorIndexByTag(LEVEL_1, 'exit')
  assert(exitSector >= 0, 'the level has no exit')
  const goal = makeGoal(exitSector)

  const dt = 1 / 60
  const speed = 3.4

  /** One tick of the world, minus the creatures, who are not the subject here. */
  const tick = () => {
    collect(LEVEL_1_PICKUPS, player.x, player.y, PLAYER_RADIUS, carried)
    if (player.sector === sectorIndexByTag(LEVEL_1, 'lift')) {
      const lift = built.find((mover) => mover.sector === player.sector)
      if (lift) activate(lift, carried.keys)
    }
    updateMovers(LEVEL_1, built, [player], dt)
    reachExit(goal, player.sector, dt)
  }

  /** Walks toward a point using the real movement code. Fails if it cannot get there. */
  const walkTo = (tx: number, ty: number, within = 0.6, seconds = 20) => {
    const steps = Math.ceil(seconds / dt)
    for (let i = 0; i < steps; i++) {
      const dx = tx - player.x
      const dy = ty - player.y
      const distance = Math.hypot(dx, dy)
      if (distance <= within) return
      player.angle = Math.atan2(dy, dx)
      moveBody(LEVEL_1, player, (dx / distance) * speed * dt, (dy / distance) * speed * dt)
      tick()
    }
    assert(
      Math.hypot(tx - player.x, ty - player.y) <= within,
      `stuck at (${player.x.toFixed(2)}, ${player.y.toFixed(2)}) trying to reach (${tx}, ${ty})`,
    )
  }

  /** Stands still for a while, so doors and lifts can finish moving. */
  const waitFor = (seconds: number) => {
    for (let i = 0; i < Math.ceil(seconds / dt); i++) tick()
  }

  try {
    walkTo(12, 3)
    walkTo(16, 4)
    walkTo(16, 8)
    walkTo(24, 8.5, 0.5)
    assert(carried.keys.has('amber'), 'walked over the key without picking it up')

    walkTo(19, 9, 0.4)
    player.angle = Math.PI / 2
    const door = moverInFront(LEVEL_1, built, player.sector, player.x, player.y, player.angle)
    assert(door !== null, 'no door in front of the player at the north wall')
    assert(activate(door, carried.keys), 'the key did not open the door it was made for')
    waitFor(2)

    walkTo(19, 14)
    walkTo(20, 18.5)
    // Standing on the lift calls it; it has no wait, so it stays up.
    waitFor(3)
    close(LEVEL_1.sectors[sectorIndexByTag(LEVEL_1, 'lift')]!.floor, 1.5, 1e-6, 'the lift did not rise')

    walkTo(20, 21.5)
    walkTo(20, 24.5)

    assert(goal.reached, `never reached the exit; ended in sector ${player.sector}`)
    assert(goal.elapsed > 0, 'the level was finished in no time at all')
  } finally {
    restore()
  }
})

console.log('\nfinishing')

test('the exit fires once, and only in the right sector', () => {
  // Everything hung on finishing a level wants to happen once — a summary
  // appearing, a clock stopping, a sound. Making the edge this module's
  // business rather than each caller's is what stops three of them disagreeing
  // about whether the level is over.
  const goal = makeGoal(7)

  assert(reachExit(goal, 3, 1 / 60) === false, 'the exit fired in the wrong sector')
  assert(!goal.reached, 'the goal was marked reached without reaching it')

  assert(reachExit(goal, 7, 1 / 60) === true, 'arriving at the exit did not fire')
  assert(goal.reached, 'arriving did not mark the goal reached')

  assert(reachExit(goal, 7, 1 / 60) === false, 'the exit fired a second time')
})

test('the clock counts the level and not the summary', () => {
  // The number shown afterwards is how long it took, not how long you have
  // been looking at the result.
  const goal = makeGoal(7)
  for (let i = 0; i < 120; i++) reachExit(goal, 1, 1 / 60)
  close(goal.elapsed, 2, 1e-9, 'two seconds of play')

  reachExit(goal, 7, 1 / 60)
  const atFinish = goal.elapsed
  for (let i = 0; i < 300; i++) reachExit(goal, 7, 1 / 60)
  close(goal.elapsed, atFinish, 1e-9, 'the clock kept running after the level ended')
})

test('the summary fits the screen it is shown on', () => {
  // The gap I left and wrote down: nothing drives the player to the exit, so
  // this screen has never been looked at. The risk is not the wide grid but the
  // narrow one — at 49 columns the longest of these lines is most of the width,
  // and centring it carelessly starts it off the left edge.
  const lines = summaryLines({ seconds: 95.4, kills: 3, creatures: 5, collected: 2, supplies: 3 })

  for (const [width, height] of [
    [163, 50],
    [49, 59],
    [40, 24],
  ] as const) {
    const placed = summaryLayout(width, height, lines)
    assert(placed.length > 0, `nothing was placed on a ${width}x${height} grid`)

    const rows = new Set<number>()
    for (const piece of placed) {
      assert(piece.col >= 0, `"${piece.text}" starts at column ${piece.col} on a ${width}-wide grid`)
      assert(
        piece.col + piece.text.length <= width,
        `"${piece.text}" ends at ${piece.col + piece.text.length} on a ${width}-wide grid`,
      )
      assert(piece.row >= 0 && piece.row < height, `"${piece.text}" is on row ${piece.row} of ${height}`)
      assert(!rows.has(piece.row), `two lines share row ${piece.row}`)
      rows.add(piece.row)
    }
  }
})

test('the summary reads as a clock and a pair of counts', () => {
  const lines = summaryLines({ seconds: 95.4, kills: 3, creatures: 5, collected: 2, supplies: 3 })
  assert(lines.length === 4, `expected four lines, got ${lines.length}`)
  assert(lines[1]!.includes('1:35'), `ninety-five seconds rendered as ${JSON.stringify(lines[1])}`)
  assert(lines[2]!.includes('3 / 5'), `kills rendered as ${JSON.stringify(lines[2])}`)
  assert(lines[3]!.includes('2 / 3'), `supplies rendered as ${JSON.stringify(lines[3])}`)

  // Under a minute still reads as a clock rather than as a bare number.
  const quick = summaryLines({ seconds: 7, kills: 0, creatures: 1, collected: 0, supplies: 1 })
  assert(quick[1]!.includes('0:07'), `seven seconds rendered as ${JSON.stringify(quick[1])}`)
})

console.log('\npickups')

function carrier(overrides: Partial<Carrier> = {}): Carrier {
  return {
    health: 100,
    maxHealth: 100,
    ammo: [10, 4],
    ammoMax: [60, 24],
    keys: new Set<string>(),
    ...overrides,
  }
}

function pickupAt(x: number, y: number, grant: Pickup['grant']): Pickup {
  return { x, y, z: 0, light: 1, sprite: DUMMY_ART, grant, radius: 0.4, taken: false }
}

test('a pickup that would give you nothing is left where it is', () => {
  // The difference between a supply and a thing that punishes you for walking
  // tidily through a room. At full health the kit stays on the floor for when
  // it is worth something.
  const full = carrier()
  const kit = pickupAt(1, 1, { kind: 'health', amount: 25 })
  assert(!isUseful(kit, full), 'a kit was useful at full health')
  assert(collect([kit], 1, 1, 0.35, full).length === 0, 'a kit was taken at full health')
  assert(!kit.taken, 'a kit that gave nothing was still marked taken')

  const hurt = carrier({ health: 60 })
  assert(collect([kit], 1, 1, 0.35, hurt).length === 1, 'a kit was not taken by someone hurt')
  assert(hurt.health === 85, `health went to ${hurt.health}`)
})

test('nothing overfills', () => {
  // The excess stays in the world rather than being quietly discarded.
  const nearlyFull = carrier({ health: 90 })
  collect([pickupAt(1, 1, { kind: 'health', amount: 25 })], 1, 1, 0.35, nearlyFull)
  assert(nearlyFull.health === 100, `health overfilled to ${nearlyFull.health}`)

  const stocked = carrier({ ammo: [55, 4] })
  collect([pickupAt(1, 1, { kind: 'ammo', weapon: 0, amount: 20 })], 1, 1, 0.35, stocked)
  assert(stocked.ammo[0] === 60, `ammunition overfilled to ${stocked.ammo[0]}`)
})

test('reach is the sum of both radii, and the edge of it is the edge', () => {
  const pickup = pickupAt(0, 0, { kind: 'ammo', weapon: 1, amount: 8 })
  const reach = pickup.radius + 0.35

  const outside = carrier({ ammo: [10, 0] })
  assert(collect([pickup], reach + 0.05, 0, 0.35, outside).length === 0, 'something just out of reach was taken')

  const inside = carrier({ ammo: [10, 0] })
  assert(collect([pickup], reach - 0.05, 0, 0.35, inside).length === 1, 'something just within reach was missed')
  assert(inside.ammo[1] === 8, `ammunition went to ${inside.ammo[1]}`)
})

test('a key is taken once and then stops existing', () => {
  const holder = carrier()
  const key = pickupAt(2, 2, { kind: 'key', key: 'blue' })

  assert(collect([key], 2, 2, 0.35, holder).length === 1, 'the key was not picked up')
  assert(holder.keys.has('blue'), 'the key was picked up without being held')
  assert(key.taken, 'the key is still on the floor')

  // Walking back over it does nothing, whether or not it was marked taken.
  assert(collect([key], 2, 2, 0.35, holder).length === 0, 'the key was picked up twice')
})

console.log('\nstatus line')

const HUD_SAMPLE: HudSegment[] = [
  { text: '100', align: 'left', priority: 3 },
  { text: 'scattergun 24', align: 'left', priority: 2 },
  { text: 'corridor · 60 fps', align: 'right', priority: 1 },
]

/** The columns a placed segment actually covers. */
function span(piece: { text: string; col: number; align: 'left' | 'right' }): [number, number] {
  return piece.align === 'left'
    ? [piece.col, piece.col + piece.text.length - 1]
    : [piece.col - piece.text.length + 1, piece.col]
}

test('everything fits on a wide grid', () => {
  const placed = layoutHud(163, HUD_SAMPLE)
  assert(placed.length === HUD_SAMPLE.length, `only ${placed.length} of ${HUD_SAMPLE.length} segments were placed`)
})

test('segments are placed in the order they were written', () => {
  // The assertion that was missing, and the defect it would have caught. The
  // first version sorted by priority and then placed from that sorted list, so
  // the status line read "sidearm 56" before "86" — the weapon first, because
  // it mattered less. Overlap and survival were both fine; only the order was
  // wrong, and nothing was looking at the order.
  const placed = layoutHud(163, HUD_SAMPLE)
  const lefts = placed.filter((piece) => piece.align === 'left')
  const expected = HUD_SAMPLE.filter((segment) => segment.align === 'left').map((segment) => segment.text)
  assert(
    lefts.map((piece) => piece.text).join('|') === expected.join('|'),
    `left segments came out as ${JSON.stringify(lefts.map((p) => p.text))}, expected ${JSON.stringify(expected)}`,
  )
  for (let i = 1; i < lefts.length; i++) {
    assert(lefts[i]!.col > lefts[i - 1]!.col, 'left segments do not run left to right')
  }
})

test('nothing overlaps on a narrow one', () => {
  // The defect this exists for. At 49 columns the three pieces written by hand
  // ran together, and a character grid has no way to show that two runs of
  // text are separate things — they are simply adjacent characters.
  for (const width of [30, 40, 49, 60, 80, 163]) {
    const placed = layoutHud(width, HUD_SAMPLE)
    const spans = placed.map(span).sort((a, b) => a[0] - b[0])
    for (let i = 1; i < spans.length; i++) {
      assert(
        spans[i]![0] > spans[i - 1]![1],
        `at ${width} columns "${placed[i]?.text}" starts at ${spans[i]![0]} inside something ending at ${spans[i - 1]![1]}`,
      )
    }
    for (const [from, to] of spans) {
      assert(from >= 0 && to < width, `at ${width} columns a segment runs from ${from} to ${to}`)
    }
  }
})

test('the real status line survives a phone once a key is held', () => {
  // The other gap I wrote down. Every screenshot so far has had an empty keys
  // segment, so what has actually been looked at is three items and not four.
  // These are the four the game builds, at the width a phone gives.
  const real: HudSegment[] = [
    { text: '100', align: 'left', priority: 4 },
    { text: 'scattergun 24', align: 'left', priority: 3 },
    { text: 'keys amber', align: 'left', priority: 2 },
    { text: 'chamber · 60 fps', align: 'right', priority: 1 },
  ]
  const placed = layoutHud(49, real)
  const texts = placed.map((piece) => piece.text)

  assert(texts.includes('100'), `health was dropped on a phone, leaving ${JSON.stringify(texts)}`)
  assert(
    texts.includes('keys amber') || !texts.includes('chamber · 60 fps'),
    `the frame rate survived while the key did not: ${JSON.stringify(texts)}`,
  )

  const spans = placed.map(span).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < spans.length; i++) {
    assert(spans[i]![0] > spans[i - 1]![1], `segments overlap on a phone: ${JSON.stringify(texts)}`)
  }
})

test('what is dropped is dropped in priority order, and health never is', () => {
  // A narrow grid has to lose something. Which something is the decision, and
  // leaving it to whichever segment happened to be placed last is how a status
  // line ends up showing the frame rate and not the health.
  const narrow = layoutHud(24, HUD_SAMPLE)
  const kept = narrow.map((piece) => piece.text)
  assert(kept.includes('100'), `health was dropped, leaving ${JSON.stringify(kept)}`)
  assert(!kept.includes('corridor · 60 fps'), `the least important segment survived: ${JSON.stringify(kept)}`)

  // Narrower still: only the most important thing is left.
  const tiny = layoutHud(12, HUD_SAMPLE)
  assert(tiny.length === 1 && tiny[0]!.text === '100', `expected health alone, got ${JSON.stringify(tiny.map((p) => p.text))}`)
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
