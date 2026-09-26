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
import { drawAutomap, mapToCell, markerFor, plotLine, type Cell } from '../src/columns/automap.ts'
import {
  acrossFrom,
  buildLevel,
  castRay,
  lineOfSight,
  sectorAt,
  type Line,
  type SectorDef,
} from '../src/columns/level.ts'
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
import { LAUNCHER, SCATTERGUN, SIDEARM, WEAPONS, fire } from '../src/game/weapons.ts'
import {
  LEVELS,
  STARTING_AMMO,
  STARTING_HEALTH,
  freshCarrier,
  isDead,
  nextLevel,
  restartLevel,
  startLevel,
} from '../src/game/campaign.ts'
import { makeGoal, reachExit, summaryLayout, summaryLines } from '../src/game/exit.ts'
import { HURT_INTERVAL, bite, hurtOf, makeHazard } from '../src/game/hazard.ts'
import { DEADZONE, IDLE, keyboardIntent, mergeIntents, touchIntent } from '../src/game/input.ts'
import { loadLevel } from '../src/game/levels.ts'
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
import { PLAYER_RADIUS, moveBody, type Body } from '../src/game/player.ts'
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

console.log('\nevery level')

test('every shipped level loads, and loads clean each time', () => {
  // A definition is a template and loading copies it. If that ever stops being
  // true the second run of a level starts with its doors open and its supplies
  // gone, which is exactly the state the playthrough check has to save and
  // restore around itself — and the reason this bundle exists.
  for (const def of LEVELS) {
    const first = loadLevel(def)
    first.pickups[0]!.taken = true
    first.level.sectors[0]!.ceiling = 99

    const second = loadLevel(def)
    assert(second.pickups[0]!.taken === false, `${def.name}: a second load remembered a collected supply`)
    assert(second.level.sectors[0]!.ceiling !== 99, `${def.name}: a second load inherited a moved ceiling`)
  }
})

test('starting a level keeps what you earned and takes back the keys', () => {
  // The newest rule in the project and, until this check, the least examined:
  // it was one line inside the frame loop, where nothing in Node can reach it.
  //
  // Keys are the whole of what does not carry. A key brought into the next
  // level would open a door it was never meant to, and would also quietly
  // falsify the check above — which asks whether each level supplies the keys
  // its own locks need, on the assumption that you arrive with none.
  const carrier: Carrier = {
    health: 42,
    maxHealth: 100,
    ammo: [17, 3, 1],
    ammoMax: [120, 48, 24],
    keys: new Set(['amber', 'cobalt']),
  }

  const state = startLevel(1, carrier)

  assert(carrier.keys.size === 0, `arrived holding ${[...carrier.keys].join(', ')}`)
  assert(carrier.health === 42, `health was reset to ${carrier.health}`)
  assert(carrier.ammo.join(',') === '17,3,1', `ammunition became ${carrier.ammo.join(',')}`)
  assert(state.def === LEVELS[1], 'started the wrong level')
  assert(
    state.pickups.every((pickup) => !pickup.taken),
    'the new level began with supplies already collected',
  )
})

test('the campaign ends rather than wrapping round', () => {
  assert(nextLevel(0) === 1, 'the first level does not lead to the second')
  assert(nextLevel(LEVELS.length - 1) === null, 'the last level leads somewhere')
})

console.log('\ndying')

test('a fresh kit is a copy, not the constant everyone spends', () => {
  // The trap this exists for: handing out `STARTING_AMMO` itself means the
  // rounds fired in one run are missing from the start of the next, which
  // looks like a balance problem rather than a shared array.
  const first = freshCarrier()
  first.ammo[0] = 3
  first.keys.add('amber')

  const second = freshCarrier()
  assert(second.ammo[0] === STARTING_AMMO[0], `a new run started with ${second.ammo[0]} rounds`)
  assert(second.keys.size === 0, 'a new run started holding keys from the last one')
  assert(STARTING_AMMO[0] !== 3, 'spending ammunition wrote into the loadout itself')
})

test('zero health is dead and one is not', () => {
  const carrier = freshCarrier()
  assert(carrier.health === STARTING_HEALTH, `a run begins on ${carrier.health}`)
  assert(!isDead(carrier), 'a full kit counts as dead')

  carrier.health = 1
  assert(!isDead(carrier), 'one point of health counts as dead')
  carrier.health = 0
  assert(isDead(carrier), 'zero health does not count as dead')
  // Damage is clamped at zero where it is applied, but the rule should not
  // depend on the clamp being there.
  carrier.health = -5
  assert(isDead(carrier), 'health below zero does not count as dead')
})

test('dying hands back the starting kit; finishing a level does not', () => {
  // The two are opposites on purpose, and the difference is the whole of what
  // this rule is. Asked in one place so that a change to either has to be
  // looked at against the other.
  const died: Carrier = {
    health: 0,
    maxHealth: 100,
    ammo: [2, 0, 0],
    ammoMax: [120, 48, 24],
    keys: new Set(['cobalt']),
  }
  const again = restartLevel(1, died)

  assert(died.health === STARTING_HEALTH, `came back on ${died.health} health`)
  assert(died.ammo.join(',') === STARTING_AMMO.join(','), `came back with ${died.ammo.join(',')}`)
  assert(died.keys.size === 0, 'came back still holding the key the map hides')
  assert(again.def === LEVELS[1], 'restarted a different level from the one that killed us')
  assert(
    again.pickups.every((pickup) => !pickup.taken),
    'the level restarted with its supplies already collected',
  )

  const moved: Carrier = {
    health: 12,
    maxHealth: 100,
    ammo: [2, 0, 0],
    ammoMax: [120, 48, 24],
    keys: new Set(['cobalt']),
  }
  startLevel(1, moved)
  assert(moved.health === 12, `walking into the next level healed to ${moved.health}`)
  assert(moved.ammo.join(',') === '2,0,0', `walking into the next level restocked to ${moved.ammo.join(',')}`)
})

console.log('\nthe automap')

test('the map centres where it is told, north up', () => {
  // A cell half as wide as it is tall, so the aspect term is something other
  // than one and a dropped factor has somewhere to show.
  const cell = 0.5
  const view = { cx: 10, cy: 4, scale: 0.5 }
  const middle = mapToCell(view, cell, 80, 40, 10, 4)
  assert(middle.col === 40 && middle.row === 20, `the centre landed at ${middle.col},${middle.row}`)

  // North is up, which makes a point further north a *smaller* row. Backwards
  // here mirrors the map, and a mirrored map still looks like a map.
  const north = mapToCell(view, cell, 80, 40, 10, 4 + view.scale * 5)
  assert(north.row === 15, `five rows north landed on row ${north.row}`)

  const east = mapToCell(view, cell, 80, 40, 10 + view.scale * cell * 5, 4)
  assert(east.col === 45, `five columns east landed on column ${east.col}`)
})

test('a square room comes out square', () => {
  // What the cell aspect is for. Ten map units across and ten up have to cover
  // the same distance *on screen*, which is not the same number of cells: a
  // cell is 0.574 as wide as it is tall, so across takes more of them, in that
  // proportion exactly. Without the term the map is stretched sideways by
  // nearly two to one and every room reads as a corridor.
  const aspect = 0.574
  const view = { cx: 0, cy: 0, scale: 0.4 }
  const at = (x: number, y: number) => mapToCell(view, aspect, 200, 200, x, y)
  const across = at(10, 0).col - at(0, 0).col
  const up = at(0, 0).row - at(0, 10).row
  close(across * aspect, up, 0.5, 'ten map units across against ten up')
})

test('a plotted line starts, ends and never jumps', () => {
  const a: Cell = { col: 3, row: 7 }
  const b: Cell = { col: 19, row: 2 }
  const cells = plotLine(a, b)

  const first = cells[0]
  const last = cells[cells.length - 1]
  assert(first !== undefined && last !== undefined, 'the line came out empty')
  assert(first.col === a.col && first.row === a.row, `started at ${first.col},${first.row}`)
  assert(last.col === b.col && last.row === b.row, `ended at ${last.col},${last.row}`)

  // Connected, which is the whole claim a line makes. A gap would draw a map
  // of dots that still reads as a map from across the room.
  for (let i = 1; i < cells.length; i++) {
    const step = Math.max(Math.abs(cells[i]!.col - cells[i - 1]!.col), Math.abs(cells[i]!.row - cells[i - 1]!.row))
    assert(step === 1, `the line jumped ${step} cells at step ${i}`)
  }

  const flat = plotLine({ col: 2, row: 5 }, { col: 8, row: 5 })
  assert(flat.length === 7, `two to eight inclusive is seven cells, not ${flat.length}`)
})

test('the marker points where the player is facing', () => {
  // Angle zero is +x, which the renderer takes as forward, and +x is east,
  // which is right on a north-up map.
  assert(markerFor(0) === '>', `east drew ${markerFor(0)}`)
  assert(markerFor(Math.PI / 2) === '^', `north drew ${markerFor(Math.PI / 2)}`)
  assert(markerFor(Math.PI) === '<', `west drew ${markerFor(Math.PI)}`)
  assert(markerFor(-Math.PI / 2) === 'v', `south drew ${markerFor(-Math.PI / 2)}`)
  // Turning does not wrap the angle, so after a few minutes it is a long way
  // from zero and the marker still has to be right.
  assert(markerFor(Math.PI * 4) === '>', 'an angle wound round several turns lost its bearing')
})

/**
 * Two closed boxes with no way between them.
 *
 * Nothing is shared, so every line is a one-sided wall and the second room is
 * unreachable and unseeable from the first. That is the point: a ray cast east
 * from inside the first room crosses the second room's lines quite happily —
 * `castRay` reports every crossing along its length — so a renderer that marked
 * what it *crossed* would put them on the map, and one that marks what the
 * column walk *reached* cannot.
 */
const SEALED_ROOMS: SectorDef[] = [
  { polygon: [[0, 0], [6, 0], [6, 4], [0, 4]], floor: 0, ceiling: 3, light: 0.85 },
  { polygon: [[10, 0], [16, 0], [16, 4], [10, 4]], floor: 0, ceiling: 3, light: 0.85 },
]

test('the map learns what was on screen, not what the rays passed through', () => {
  const level = buildLevel(SEALED_ROOMS)
  const fb = new Framebuffer(80, 40)
  const seen = new Set<Line>()
  // Standing in the first room looking straight at the second one.
  renderView(
    fb,
    level,
    { x: 3, y: 2, z: 1.6, angle: 0, sector: sectorAt(level, 3, 2), fovY: DEFAULT_FOV_Y },
    0.574,
    { seen },
  )

  assert(seen.size > 0, 'a room was drawn and nothing was learned from it')
  assert(seen.size < level.lines.length, `every line in the map was marked from one spot (${seen.size})`)
  for (const line of seen) {
    assert(
      line.ax < 10 || line.bx < 10,
      `a wall of the far room at x=${line.ax} was marked from a room with no way into it`,
    )
  }
})

/** How many cells hold a given character. */
function countGlyph(fb: Framebuffer, glyph: string): number {
  const code = glyph.charCodeAt(0)
  let count = 0
  for (let i = 0; i < fb.width * fb.height; i++) {
    if (fb.chars[i] === code) count++
  }
  return count
}

test('the map draws the lines it knows and no others', () => {
  const level = buildLevel(SEALED_ROOMS)
  const west = level.lines.find((line) => line.ax === 0 && line.bx === 0)
  assert(west !== undefined, 'the fixture has no west wall to teach the map')

  const view = { cx: 3, cy: 2, scale: 0.2 }
  const player = { x: 3, y: 2, angle: 0 }
  const aspect = 0.574

  const blank = new Framebuffer(80, 40)
  blank.clear(0, 0, 0, 0)
  drawAutomap(blank, level, new Set<Line>(), view, player, aspect)
  assert(countGlyph(blank, '#') === 0, 'a map that has learned nothing still drew walls')
  assert(countGlyph(blank, markerFor(0)) === 1, 'the player is missing from their own map')

  const known = new Framebuffer(80, 40)
  known.clear(0, 0, 0, 0)
  drawAutomap(known, level, new Set<Line>([west]), view, player, aspect)

  // Tied to the plotter rather than to a number I counted once: whatever
  // Bresenham says that wall covers, clipped to the grid, is what has to be on
  // screen. A number written here would stop being a check the moment the
  // scale changed.
  const a = mapToCell(view, aspect, 80, 40, west.ax, west.ay)
  const b = mapToCell(view, aspect, 80, 40, west.bx, west.by)
  const expected = plotLine(a, b).filter(
    (cell) => cell.col >= 0 && cell.col < 80 && cell.row >= 0 && cell.row < 40,
  ).length

  assert(expected > 1, `the fixture put the wall off the grid, so this measured nothing (${expected} cells)`)
  assert(
    countGlyph(known, '#') === expected,
    `drew ${countGlyph(known, '#')} cells for a wall the plotter makes ${expected}`,
  )
})

test('a seam between rooms of one height is not a line on the map', () => {
  // Floors get cut into several sectors for lighting and for lifts, and every
  // cut is a two-sided line. Drawing them all turns the map into a mesh of the
  // authoring rather than a picture of the place -- which is what it looked
  // like, in the first screenshot of it. A step or a lower ceiling is a real
  // feature and stays.
  const rooms = (secondFloor: number) =>
    buildLevel([
      { polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], floor: 0, ceiling: 3, light: 1 },
      { polygon: [[4, 0], [8, 0], [8, 4], [4, 4]], floor: secondFloor, ceiling: 3, light: 1 },
    ])

  const view = { cx: 4, cy: 2, scale: 0.2 }
  const player = { x: 1, y: 1, angle: 0 }
  const draw = (level: ReturnType<typeof buildLevel>) => {
    const fb = new Framebuffer(80, 40)
    fb.clear(0, 0, 0, 0)
    drawAutomap(fb, level, new Set<Line>(level.lines), view, player, 0.574)
    return fb
  }

  const flat = rooms(0)
  const seam = flat.lines.find((line) => line.back !== null)
  assert(seam !== undefined, 'the fixture rooms did not pair into a shared edge, so this measured nothing')

  assert(countGlyph(draw(flat), ':') === 0, 'a seam between two rooms at one height was drawn')
  assert(countGlyph(draw(rooms(1)), ':') > 0, 'a step between two rooms was left off the map')
})

console.log('\nfloors that hurt')

/** Dry ground, and a channel of something that bites, sharing one edge. */
const SLUDGE_ROOM: SectorDef[] = [
  { polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], floor: 0, ceiling: 3, light: 0.8 },
  {
    polygon: [[4, 0], [8, 0], [8, 4], [4, 4]],
    floor: 0,
    ceiling: 3,
    light: 0.8,
    hurt: 7,
    floorMaterial: 'sludge',
  },
]

test('a hurting floor is a property of the sector, carried through the build', () => {
  // The definition is a template and the level is built from it, so a field
  // that is not copied across is a hazard that exists only in the source.
  const level = buildLevel(SLUDGE_ROOM)
  const dry = sectorAt(level, 2, 2)
  const wet = sectorAt(level, 6, 2)
  assert(dry >= 0 && wet >= 0, 'the fixture rooms are not where this check thinks they are')
  assert(hurtOf(level, dry) === 0, `ordinary ground reports ${hurtOf(level, dry)} damage`)
  assert(hurtOf(level, wet) === 7, `the channel reports ${hurtOf(level, wet)} damage, not the 7 it was given`)
})

test('crossing the edge of a channel costs nothing', () => {
  // The first bite lands a full interval after arriving, so a room that is
  // merely stepped through is free. The alternative -- hurting on entry --
  // makes a doorway a toll and the shape of the room stops telling you
  // anything.
  const level = buildLevel(SLUDGE_ROOM)
  const wet = sectorAt(level, 6, 2)
  const hazard = makeHazard()
  assert(bite(level, wet, hazard, HURT_INTERVAL * 0.9) === 0, 'a step through the channel drew blood')
})

test('standing in it costs exactly one bite per interval', () => {
  const level = buildLevel(SLUDGE_ROOM)
  const wet = sectorAt(level, 6, 2)
  const hazard = makeHazard()
  assert(bite(level, wet, hazard, HURT_INTERVAL) === 7, 'a full interval did not cost a bite')
  assert(bite(level, wet, hazard, HURT_INTERVAL) === 7, 'the second interval did not cost a bite')

  // A long frame owes every bite it was away for rather than one. A tab left in
  // the background is the ordinary way to find this out.
  const slept = makeHazard()
  assert(bite(level, wet, slept, HURT_INTERVAL * 3 + 0.01) === 21, 'a long frame lost the bites it owed')
})

test('leaving stops the clock rather than banking it', () => {
  // Two hops across a channel must not add up to standing in it. Without the
  // reset, a corridor crossed carefully hurts exactly as much as one stood in,
  // which is the opposite of what the room is asking.
  const level = buildLevel(SLUDGE_ROOM)
  const dry = sectorAt(level, 2, 2)
  const wet = sectorAt(level, 6, 2)
  const hazard = makeHazard()

  assert(bite(level, wet, hazard, HURT_INTERVAL * 0.8) === 0, 'the first hop cost something')
  assert(bite(level, dry, hazard, 0.01) === 0, 'dry ground cost something')
  assert(hazard.standing === 0, `the clock kept ${hazard.standing}s after leaving`)
  assert(bite(level, wet, hazard, HURT_INTERVAL * 0.8) === 0, 'two hops added up to a bite')
})

test('ordinary ground never costs anything, however long you stand on it', () => {
  const level = buildLevel(SLUDGE_ROOM)
  const dry = sectorAt(level, 2, 2)
  assert(bite(level, dry, makeHazard(), 600) === 0, 'standing on a floor hurt')
})

test('a floor asking for a material is drawn in that material', () => {
  // The check below this one reads the level definition and asks what it says.
  // It passed for a day while the renderer ignored the field entirely: the
  // material was stored on every sector and read by nothing, so a channel of
  // sludge came out drawn as ordinary ground. Breaking the definition made
  // that check fail, which proved only that it reads definitions.
  //
  // So this one renders. Standing in the wet room, glyphs from the sludge ramp
  // have to actually be on the screen -- and glyphs from the floor ramp have to
  // be there too, from the dry room next door, or a frame of nothing but sludge
  // would satisfy it just as well.
  // Where you stand matters, and the obvious spot is the wrong one. From the
  // middle of the wet room the portal is two metres away, and the floor you
  // are standing on projects below the bottom of the frame -- every floor cell
  // on screen then belongs to the dry room beyond, so the view contains no
  // sludge however correctly it is drawn. Standing back from the portal brings
  // your own floor into shot. This cost three rounds of chasing the renderer
  // for a fault that was in the viewpoint.
  const level = buildLevel(SLUDGE_ROOM)
  const wet = sectorAt(level, 7.5, 2)
  const fb = new Framebuffer(120, 40)
  fb.clear(0, 0, 0, 0)
  renderView(fb, level, { x: 7.5, y: 2, z: 1.6, angle: Math.PI, sector: wet, fovY: DEFAULT_FOV_Y }, 0.574, {})

  const sludgeRamp = MATERIALS.sludge!.ramp
  const floorRamp = MATERIALS.floor!.ramp
  let sludgeCells = 0
  let floorCells = 0
  for (let i = 0; i < fb.width * fb.height; i++) {
    const glyph = String.fromCharCode(fb.chars[i] ?? 32)
    if (glyph === ' ') continue
    if (sludgeRamp.includes(glyph)) sludgeCells++
    if (floorRamp.includes(glyph)) floorCells++
  }

  // Both counts in both messages. The first version of this check reported
  // only the one that failed, and separating "the floor was drawn in the wrong
  // material" from "no floor was drawn at all" then cost a round of guessing.
  assert(
    floorCells > 0,
    `no ordinary floor was drawn at all (sludge ${sludgeCells}, floor ${floorCells}), so this view proves nothing`,
  )
  assert(
    sludgeCells > 0,
    `standing in sludge, none of it drew as sludge (sludge ${sludgeCells}, floor ${floorCells})`,
  )
})

test('every material a level names actually exists', () => {
  // The names reach the renderer now, and it looks them up without a fallback,
  // so a typo in a level definition is a blank screen rather than a wrong tint.
  const missing: string[] = []
  for (const def of LEVELS) {
    for (const sector of loadLevel(def).level.sectors) {
      for (const name of [sector.floorMaterial, sector.ceilingMaterial]) {
        if (!(name in MATERIALS)) missing.push(`${def.name} names a surface "${name}" that does not exist`)
      }
    }
  }
  assert(missing.length === 0, missing.join('; '))
})

test('ground that hurts is ground you can see is different', () => {
  // An invisible hazard is not a difficulty setting, it is a bug: the player
  // has one channel for "this is a different kind of thing", and it is the
  // glyphs. Asked of the shipped levels rather than of a fixture, because this
  // is a rule about authoring and the only place it can be broken is content.
  const wrong: string[] = []
  for (const def of LEVELS) {
    for (const sector of loadLevel(def).level.sectors) {
      if (sector.hurt > 0 && sector.floorMaterial !== 'sludge') {
        wrong.push(`${def.name} hurts you on a floor drawn as ${sector.floorMaterial}`)
      }
    }
  }
  assert(wrong.length === 0, wrong.join('; '))
})

test('somewhere in the campaign the ground is actually dangerous', () => {
  // Without this the rules above are all satisfied by a game that has no
  // hazards in it at all, and the feature could fall out of the levels while
  // every other check stayed green.
  const hazardous = LEVELS.flatMap((def) =>
    loadLevel(def).level.sectors.filter((sector) => sector.hurt > 0),
  )
  assert(hazardous.length > 0, 'no shipped level has any ground that hurts')
})

test('the way out is never through something that hurts', () => {
  // The design claim, stated where it can fail. Hazard is meant to be a cost
  // you choose for something optional -- so the exit, and any door the level
  // locks behind a key, stand on dry ground. If that stops being true this
  // stops being a choice and becomes a toll.
  const forced: string[] = []
  for (const def of LEVELS) {
    const state = loadLevel(def)
    const sectors = state.level.sectors
    const exit = sectors[state.goal.exitSector]
    if (exit && exit.hurt > 0) forced.push(`${def.name} puts its exit in ${exit.hurt}-a-bite ground`)
    for (const mover of state.movers) {
      if (mover.kind.requiresKey === undefined) continue
      const sector = sectors[mover.sector]
      if (sector && sector.hurt > 0) {
        forced.push(`${def.name} locks a door standing in ${sector.hurt}-a-bite ground`)
      }
    }
  }
  assert(forced.length === 0, forced.join('; '))
})

test('every shipped level is closed, with no holes to see through', () => {
  // The check that catches an unmatched edge, run against every map rather than
  // the first one. Two sectors share a wall only when they share an edge
  // endpoint for endpoint; miss a vertex and the wall silently becomes solid
  // on one side and a hole on the other. A sealed map draws something in every
  // cell, and an undrawn cell in the middle of the view is the only symptom.
  const holes: string[] = []
  for (const def of LEVELS) {
    const state = loadLevel(def)
    // Several directions, because a hole is only visible from some of them.
    for (const turn of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const fb = new Framebuffer(120, 40)
      fb.clear(0, 0, 0, 0)
      const view: View = {
        x: state.player.x,
        y: state.player.y,
        z: 1.6,
        angle: state.def.spawn.angle + turn,
        sector: state.player.sector,
        fovY: DEFAULT_FOV_Y,
      }
      renderView(fb, state.level, view, 0.574, {})

      let undrawn = 0
      for (let i = 0; i < fb.depth.length; i++) {
        if (fb.depth[i]! <= 0) undrawn++
      }
      if (undrawn > 0) holes.push(`${def.name} facing ${turn.toFixed(2)}: ${undrawn} cells`)
    }
  }
  assert(holes.length === 0, `undrawn cells, which means an edge did not pair: ${holes.join('; ')}`)
})

test('every shipped level can be left the way it is meant to be', () => {
  // Not a playthrough — those are routed by hand and do not generalise. This is
  // the weaker claim that does: every lock in a level has a key somewhere in
  // that same level.
  //
  // There is deliberately nothing here about the exit existing. `loadLevel`
  // refuses a definition whose exit tag names no sector, so an assertion about
  // it could never fail and would only look like coverage.
  const broken: string[] = []
  for (const def of LEVELS) {
    const state = loadLevel(def)
    const keysHeld = new Set(
      def.pickups.filter((pickup) => pickup.grant.kind === 'key').map((pickup) => (pickup.grant as { key: string }).key),
    )
    for (const mover of state.movers) {
      const needed = mover.kind.requiresKey
      if (needed !== undefined && !keysHeld.has(needed)) {
        broken.push(`${def.name} locks a door with the ${needed} key and never gives you one`)
      }
    }
  }
  assert(broken.length === 0, broken.join('; '))
})

console.log('\nplaying it through')

/**
 * A body, a loaded level, and the few verbs a route needs.
 *
 * Split out from the first playthrough because writing a second one meant
 * copying the whole of it. The walking is shared; what differs between levels
 * is only the route, which is the part worth reading.
 *
 * Creatures are deliberately not simulated. These checks ask whether a level's
 * geometry and locks let you reach the exit, and a sentry landing a blow
 * halfway through would make a failure mean two things at once.
 */
function explorer(def: (typeof LEVELS)[number]) {
  const state = loadLevel(def)
  const { level, player, movers, pickups, goal } = state
  const carried: Carrier = {
    health: 100,
    maxHealth: 100,
    ammo: [60, 24, 8],
    ammoMax: [120, 48, 24],
    keys: new Set<string>(),
  }

  const dt = 1 / 60
  const speed = 3.4

  const tick = () => {
    collect(pickups, player.x, player.y, PLAYER_RADIUS, carried)
    if (state.liftSectors.includes(player.sector)) {
      const lift = movers.find((mover) => mover.sector === player.sector)
      if (lift) activate(lift, carried.keys)
    }
    updateMovers(level, movers, [player], dt)
    reachExit(goal, player.sector, dt)
  }

  return {
    state,
    carried,
    /** Walks toward a point with the real movement code, or fails saying where it stuck. */
    walkTo(tx: number, ty: number, within = 0.6, seconds = 25) {
      const steps = Math.ceil(seconds / dt)
      for (let i = 0; i < steps; i++) {
        const dx = tx - player.x
        const dy = ty - player.y
        const distance = Math.hypot(dx, dy)
        if (distance <= within) return
        player.angle = Math.atan2(dy, dx)
        moveBody(level, player, (dx / distance) * speed * dt, (dy / distance) * speed * dt)
        tick()
      }
      assert(
        Math.hypot(tx - player.x, ty - player.y) <= within,
        `${def.name}: stuck at (${player.x.toFixed(2)}, ${player.y.toFixed(2)}) trying to reach (${tx}, ${ty})`,
      )
    },
    /** Stands still, so doors and lifts can finish moving. */
    waitFor(seconds: number) {
      for (let i = 0; i < Math.ceil(seconds / dt); i++) tick()
    },
    /** Faces a direction and opens whatever is in front, failing if nothing is. */
    open(angle: number) {
      player.angle = angle
      const door = moverInFront(level, movers, player.sector, player.x, player.y, angle)
      assert(door !== null, `${def.name}: nothing to open at (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`)
      assert(
        activate(door, carried.keys),
        `${def.name}: the door needed the ${door.kind.requiresKey} key and it was not held`,
      )
    },
  }
}

test('finishing one level hands you to the next, already playable', () => {
  // The last structurally untested thing in the project. `startLevel` has a
  // check for what it carries, and both maps have checks that they can be
  // finished, but the join between them had never run anywhere: the Node
  // playthroughs stop at the exit, and the browser never reaches one.
  //
  // Everything here except the pause on the summary is outside the page, so
  // everything except the pause can be asked about.
  const first = explorer(LEVELS[0]!)
  first.walkTo(12, 3)
  first.walkTo(16, 4)
  first.walkTo(16, 8)
  first.walkTo(24, 8.5, 0.5)
  first.walkTo(19, 9, 0.4)
  first.open(Math.PI / 2)
  first.waitFor(2)
  first.walkTo(19, 14)
  first.walkTo(20, 18.5)
  first.waitFor(3)
  first.walkTo(20, 21.5)
  first.walkTo(20, 24.5)
  assert(first.state.goal.reached, 'the first level was not finished')

  // Carrying wear and tear forward, and the key it took to get here.
  first.carried.health = 55
  first.carried.ammo[0] = 12

  const next = nextLevel(0)
  assert(next === 1, `the first level leads to ${next}`)
  const second = startLevel(next!, first.carried)

  assert(second.def === LEVELS[1], 'the hand-off landed on the wrong map')
  assert(!second.goal.reached, 'the new level began already finished')
  close(second.player.x, LEVELS[1]!.spawn.x, 1e-9, 'the player starts at the second spawn')
  close(second.player.y, LEVELS[1]!.spawn.y, 1e-9, 'the player starts at the second spawn')
  assert(first.carried.health === 55, `health became ${first.carried.health} across the join`)
  assert(first.carried.keys.size === 0, `arrived still holding ${[...first.carried.keys].join(', ')}`)

  // And it is a level, not a still image: the body moves and stays in the map.
  const startedAt = second.player.x
  for (let i = 0; i < 60; i++) moveBody(second.level, second.player, 0.05, 0)
  assert(second.player.x > startedAt, 'the player could not move in the level just handed to them')
  assert(second.player.sector >= 0, 'the player left the map immediately')
})

test('the second level can be finished too', () => {
  // Written because the level-one playthrough does not generalise and the
  // second map had only the weak claims standing behind it: closed, and with a
  // key for every lock. Neither of those says you can get from the spawn to the
  // exit, and this map's route is newer and less walked than the first's.
  const run = explorer(LEVELS[1]!)

  run.walkTo(5.3, 3, 0.4)
  run.open(0)
  run.waitFor(2)

  run.walkTo(10, 3)
  run.walkTo(12, 5)
  run.walkTo(12, 8)
  run.walkTo(13, 9, 0.5)
  assert(run.carried.keys.has('cobalt'), 'walked over the key in the store without picking it up')

  run.walkTo(12, 5)
  run.walkTo(12, -2)
  run.walkTo(12, -5.2, 0.4)
  run.open(-Math.PI / 2)
  run.waitFor(2.5)

  run.walkTo(12, -9)
  assert(run.state.goal.reached, `never reached the exit; ended in sector ${run.state.player.sector}`)
})

test('the first level can be finished', () => {
  // Moved onto the shared harness, which retires something worth noting. This
  // check used to save every sector height and every `taken` flag and put them
  // back afterwards, because it played the one built map that the rest of the
  // file also reads. Loading a level from its definition makes a private world
  // each time, so there is nothing left to put back — which is the problem the
  // level bundle was introduced to solve, actually gone rather than argued
  // about.
  const run = explorer(LEVELS[0]!)

  run.walkTo(12, 3)
  run.walkTo(16, 4)
  run.walkTo(16, 8)
  run.walkTo(24, 8.5, 0.5)
  assert(run.carried.keys.has('amber'), 'walked over the key without picking it up')

  run.walkTo(19, 9, 0.4)
  run.open(Math.PI / 2)
  run.waitFor(2)

  run.walkTo(19, 14)
  run.walkTo(20, 18.5)
  // Standing on the lift calls it; it has no wait, so it stays up.
  run.waitFor(3)
  close(
    run.state.level.sectors[sectorIndexByTag(run.state.level, 'lift')]!.floor,
    1.5,
    1e-6,
    'the lift did not rise',
  )

  run.walkTo(20, 21.5)
  run.walkTo(20, 24.5)

  assert(run.state.goal.reached, `never reached the exit; ended in sector ${run.state.player.sector}`)
  assert(run.state.goal.elapsed > 0, 'the level was finished in no time at all')
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

test('every weapon can be resupplied somewhere in the level', () => {
  // A content rule, checked because content is where this kind of mistake
  // lives. Adding the launcher gave the player eight slugs and no way to find
  // more, and the scattergun had been in the same position since it was
  // written: one canister in the level, granting the sidearm only. Nothing
  // failed, and the level was quietly worse for it.
  //
  // It was false until the same commit that added this, so it has not been
  // watched failing — what makes it worth keeping is that the next weapon
  // added without a box of its own will not get past here.
  const supplied = new Set<number>()
  for (const pickup of LEVEL_1_PICKUPS) {
    if (pickup.grant.kind === 'ammo') supplied.add(pickup.grant.weapon)
  }
  const missing = WEAPONS.map((weapon, index) => ({ weapon, index })).filter(({ index }) => !supplied.has(index))
  assert(
    missing.length === 0,
    `nothing in the level resupplies ${missing.map(({ weapon }) => weapon.name).join(', ')}`,
  )
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

console.log('\ncontrols')

test('opposing keys cancel instead of one winning', () => {
  // What a player pressing both expects, and what stops a key that never sent
  // its release from pinning you against a wall.
  const both = keyboardIntent(new Set(['w', 's']))
  assert(both.forward === 0, `forward came out ${both.forward}`)
  const sideways = keyboardIntent(new Set(['a', 'd']))
  assert(sideways.strafe === 0, `strafe came out ${sideways.strafe}`)
})

test('a diagonal is not faster than a straight line', () => {
  // The oldest bug in first-person movement. Held separately these are one
  // unit each; held together they must still be one.
  const straight = keyboardIntent(new Set(['w']))
  const diagonal = keyboardIntent(new Set(['w', 'd']))
  close(Math.hypot(straight.forward, straight.strafe), 1, 1e-9, 'walking forward')
  close(Math.hypot(diagonal.forward, diagonal.strafe), 1, 1e-9, 'walking forward and right')
})

test('a thumb resting on the stick is not a movement', () => {
  // Nobody holding a phone has their thumb exactly at the centre, so without a
  // deadzone the view creeps whenever the game is simply being held.
  const resting = touchIntent({
    stick: { x: DEADZONE * 0.5, y: DEADZONE * 0.5 },
    turn: 0,
    look: 0,
    fire: false,
    use: false,
    weapon: -1,
    map: false,
  })
  assert(resting.forward === 0 && resting.strafe === 0, 'a resting thumb moved the player')

  const pushed = touchIntent({
    stick: { x: 0, y: -1 },
    turn: 0,
    look: 0,
    fire: false,
    use: false,
    weapon: -1,
    map: false,
  })
  close(pushed.forward, 1, 1e-9, 'pushing the stick straight up')
  assert(pushed.run, 'pushing the stick to its edge is the run')
})

test('the stick agrees with the keyboard about which way is forward', () => {
  // Screen coordinates grow downward and the world does not, so this is the
  // one place a sign error would make a phone walk backwards while a keyboard
  // walks forwards — and it would look like a physics bug rather than an input
  // one.
  const key = keyboardIntent(new Set(['w']))
  const thumb = touchIntent({ stick: { x: 0, y: -1 }, turn: 0, look: 0, fire: false, use: false, weapon: -1, map: false })
  assert(Math.sign(key.forward) === Math.sign(thumb.forward), 'up on the stick is not forward')

  const right = touchIntent({ stick: { x: 1, y: 0 }, turn: 0, look: 0, fire: false, use: false, weapon: -1, map: false })
  assert(Math.sign(right.strafe) === Math.sign(keyboardIntent(new Set(['d'])).strafe), 'right on the stick is not right')
})

test('two devices at once do not add up to double speed', () => {
  // A tablet with a keyboard should obey both, and a thumb plus a key held the
  // same way should still be one unit of walking.
  const both = mergeIntents(
    keyboardIntent(new Set(['w'])),
    touchIntent({ stick: { x: 0, y: -1 }, turn: 0, look: 0, fire: true, use: false, weapon: -1, map: false }),
  )
  close(Math.hypot(both.forward, both.strafe), 1, 1e-9, 'walking on both at once')
  assert(both.fire, 'a button on one device was lost when merged with the other')

  const neither = mergeIntents(IDLE, IDLE)
  assert(neither.forward === 0 && neither.turn === 0 && !neither.fire, 'idle plus idle is not idle')
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

test('every level of every ramp is reachable by some light at some distance', () => {
  // This exists because a measurement sent me the wrong way and the correction
  // is worth keeping in code rather than in prose.
  //
  // Counting glyphs in rendered frames showed the wall's brightest character at
  // 0% and the next at 1%, which reads as two of six being decoration — the
  // same shape as the lighting bug this project started with, where levels of
  // the ramp were unreachable in principle. They are not. A wall two-tenths of
  // a unit away in the brightest sector produces the top of its ramp, and every
  // other index is producible too. What the frames actually showed is a fact
  // about this map: the bright sectors keep their walls far away, and the
  // sector you can stand nose-to-wall in is the dim corridor. Brightness and
  // proximity never coincide here, which is level design rather than a defect.
  //
  // So nothing was changed. What is checked is the thing that would have made
  // the first reading correct, and which a later edit could still cause:
  // lengthening a ramp past what the lights can drive, flattening the falloff,
  // or dimming every sector would each leave characters that cannot be
  // produced at any distance in any room.
  const lights = [...new Set(LEVEL_1.sectors.map((sector) => sector.light))]
  const near = 0.2
  const far = 64
  const dead: string[] = []

  for (const [name, material] of Object.entries(MATERIALS)) {
    const reachable = new Set<number>()
    for (const light of lights) {
      for (let distance = near; distance <= far; distance += 0.05) {
        const glyph = String.fromCharCode(rampChar(material.ramp, lightAt(light, distance)))
        reachable.add(material.ramp.indexOf(glyph))
      }
    }
    for (let index = 0; index < material.ramp.length; index++) {
      if (!reachable.has(index)) dead.push(`${name} ${JSON.stringify(material.ramp[index])} (level ${index})`)
    }
  }

  assert(dead.length === 0, `no light in the level can produce ${dead.join(', ')}`)
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
    // Standing on the platform with walls a stride away, which is the case the
    // other three miss: they all look down something. A screenshot taken here
    // read as a dense field of bright glyphs with no structure in it, and
    // whether that is saturation or simply a crowded room is a thing to count
    // rather than squint at.
    ['platform', 19.8, 3, 1.2],
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
