/**
 * What stands in the level besides walls.
 *
 * The pictures are Freedoom's, baked into characters before the game shipped
 * and sized here. They were this project's own drawings until the day the bake
 * landed, and the note below about how big art has to be is the one thing worth
 * keeping from that: it is why the baked pictures are asked for at the sizes
 * they are asked for.
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

import { atHeight, atWidth } from '../columns/bakedart.ts'
import type { Sprite } from '../columns/sprite.ts'
import type { ActorKind } from './ai.ts'
import {
  BARREL,
  BLUE_KEY,
  CLIP,
  GUNNER,
  GUNNER_DOWN,
  HOUND,
  HOUND_DOWN,
  IMP,
  IMP_DOWN,
  MEDIKIT,
  ROCKET,
  SHELLS,
  TROOPER,
  TROOPER_DOWN,
} from './freedoomart.ts'
// The placement shape lives with the level bundle now, so that two levels
// describe their casts the same way and nothing has two spellings of it.
import type { ActorPlacement } from './levels.ts'
import type { Pickup } from './pickups.ts'

/**
 * What a drifter throws: a small knot of light with a tail.
 *
 * Six cells across is enough at the distance it is met, and the tail is what
 * says which way it is going — a symmetrical blob in a character grid reads as
 * an object hanging in the air rather than as something coming at you.
 */
/**
 * What the things in this game look like.
 *
 * Freedoom's pictures, turned into characters before the game shipped and
 * scaled here to the sizes this game decided on long before it had them. The
 * art that was drawn by hand for these is gone -- it was the placeholder that
 * made everything else checkable, and it had done that.
 *
 * Height for anything standing and width for anything fallen, so a creature
 * does not change size as it drops.
 */
export const CRAWLER: Sprite = atHeight(TROOPER, 1.3)
export const CRAWLER_DOWN: Sprite = atWidth(TROOPER_DOWN, CRAWLER.width)
export const SENTRY: Sprite = atHeight(HOUND, 2.1)
export const SENTRY_DOWN: Sprite = atWidth(HOUND_DOWN, SENTRY.width)
export const BARREL_ART: Sprite = atHeight(BARREL, 1.0)
export const GUNMAN: Sprite = atHeight(GUNNER, 1.4)
export const GUNMAN_DOWN: Sprite = atWidth(GUNNER_DOWN, GUNMAN.width)
export const DRIFTER: Sprite = atHeight(IMP, 1.6)
export const DRIFTER_DOWN: Sprite = atWidth(IMP_DOWN, DRIFTER.width)

/** The supplies, at the sizes the levels here were laid out around. */
export const CANISTER: Sprite = atHeight(CLIP, 0.6)
export const KIT: Sprite = atHeight(MEDIKIT, 0.5)
export const SHELL_BOX: Sprite = atHeight(SHELLS, 0.45)
export const SLUG_CRATE: Sprite = atHeight(ROCKET, 0.5)
export const KEY_TOKEN: Sprite = atHeight(BLUE_KEY, 0.5)

export const BOLT: Sprite = {
  rows: [
    ' ,-() ',
    '===**>',
    " '-() ",
  ],
  tint: [1.35, 1.1, 0.6],
  width: 0.4,
  height: 0.35,
}

/**
 * A launcher's slug: heavier and blunter than a drifter's bolt, and told apart
 * from it by mass rather than by colour, since at this size the two are a
 * handful of cells each.
 */
export const SLUG: Sprite = {
  rows: [
    '  ,--.  ',
    ' /####\\ ',
    '<######>',
    " \\####/ ",
  ],
  tint: [1.3, 0.8, 0.5],
  width: 0.5,
  height: 0.45,
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
export const LEVEL_1_PICKUPS: Pickup[] = [
  {
    x: 5.5,
    y: 1.5,
    z: 0,
    light: 0.95,
    sprite: CANISTER,
    grant: { kind: 'ammo', weapon: 0, amount: 15 },
    radius: 0.4,
    taken: false,
  },
  {
    x: 5.5,
    y: 4.5,
    z: 0,
    light: 0.95,
    sprite: KIT,
    grant: { kind: 'health', amount: 25 },
    radius: 0.4,
    taken: false,
  },
  {
    // On the way to the key, so the scattergun is worth carrying into the hall.
    x: 18,
    y: 0,
    z: 0,
    light: 1,
    sprite: SHELL_BOX,
    grant: { kind: 'ammo', weapon: 1, amount: 8 },
    radius: 0.4,
    taken: false,
  },
  {
    // Past the locked door, so the heaviest weapon is resupplied by getting
    // somewhere rather than by walking in a circle.
    x: 18.5,
    y: 14,
    z: 0,
    light: 0.72,
    sprite: SLUG_CRATE,
    grant: { kind: 'ammo', weapon: 2, amount: 6 },
    radius: 0.4,
    taken: false,
  },
  {
    // In the hall, well away from the door it opens, so finding it is a
    // reason to explore rather than a formality on the way past.
    x: 24,
    y: 8.5,
    z: 0,
    light: 1,
    sprite: KEY_TOKEN,
    grant: { kind: 'key', key: 'amber' },
    radius: 0.5,
    taken: false,
  },
]

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

/**
 * The one with a gun, which is most of what the original puts in a room.
 *
 * Four thousand eight hundred bodies across the two files fire hitscan weapons
 * and every one of them used to arrive here as something that runs at you.
 * These numbers are deliberately gentler than the original's: a map holds
 * fifty-five of these at the median and two hundred and sixty-seven at the
 * worst, and the original survives that partly through geometry this renderer
 * does not reproduce. They are a starting point to be judged by playing, not a
 * conversion of a table.
 *
 * What matters more than the numbers is the shape: it shoots the instant it
 * decides to, from across a room, and a wall is the answer rather than
 * distance. That is the difference between a room of gunmen and a kennel.
 */
export const SHOOTER_KIND: ActorKind = {
  name: 'shooter',
  sprite: CRAWLER,
  corpse: CRAWLER_DOWN,
  radius: 0.4,
  height: 1.4,
  eye: 1.1,
  health: 28,
  speed: 1.9,
  sightRange: 34,
  reach: 0.8,
  damage: 6,
  windUp: 0.45,
  recovery: 1.5,
  painTime: 0.3,
  painChance: 0.55,
  deathTime: 0.5,
  hitscan: { range: 32, shots: 1, damage: 6, spread: 0.09 },
}

/**
 * The heavier gun: three at once, so cover matters more than distance does.
 *
 * Two thousand of these across the files. Fewer shots land at range because the
 * spread is wide, which is the original's arrangement and the reason backing
 * away from one works while backing away from a rifleman does not.
 */
export const GUNMAN_KIND: ActorKind = {
  name: 'gunman',
  sprite: GUNMAN,
  corpse: GUNMAN_DOWN,
  radius: 0.42,
  height: 1.5,
  eye: 1.15,
  health: 40,
  speed: 1.8,
  sightRange: 34,
  reach: 0.85,
  damage: 8,
  windUp: 0.5,
  recovery: 1.9,
  painTime: 0.3,
  painChance: 0.45,
  deathTime: 0.6,
  hitscan: { range: 28, shots: 3, damage: 5, spread: 0.22 },
}

/**
 * A barrel: a body that stands still until something kills it.
 *
 * Not a creature in any sense that matters -- no speed, no sight, no reach --
 * but a body with health, which is exactly what a barrel is. Modelling it as
 * one costs a table entry and nothing else, and the alternative is a second
 * kind of thing that the renderer, the tracer and the mover would all have to
 * learn about.
 *
 * Twenty health, so anything kills it; the blast is the rocket's, which is what
 * the original does and the reason a room with barrels in it is a room you
 * fight differently.
 */
export const BARREL_KIND: ActorKind = {
  name: 'barrel',
  sprite: BARREL_ART,
  corpse: BARREL_ART,
  radius: 0.35,
  height: 1,
  eye: 0.5,
  health: 20,
  speed: 0,
  sightRange: 0,
  reach: 0,
  damage: 0,
  windUp: 0.1,
  recovery: 10,
  painTime: 0,
  painChance: 0,
  deathTime: 0.2,

  explodes: { radius: 4.5, damage: 55 },
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
  // The one that does not have to reach you. Slow bolts, so they are something
  // to step out of the way of rather than something that has already landed.
  ranged: {
    projectile: { sprite: BOLT, speed: 9, damage: 8, life: 4 },
    range: 18,
  },
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
  SHELL_BOX,
  SLUG_CRATE,
  KIT,
  KEY_TOKEN,
  BOLT,
  SLUG,
  CRAWLER_DOWN,
  SENTRY_DOWN,
  DRIFTER_DOWN,
}
