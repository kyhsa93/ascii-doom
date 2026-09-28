/**
 * Turns the pictures in a WAD into source, once, at a desk.
 *
 *   node scripts/bakeart.ts freedoom1.wad freedoom2.wad > src/game/freedoomart.ts
 *
 * Not part of the build and not run by anybody playing. The file it writes is
 * committed; the WAD it reads is not, and neither is anything else about it --
 * thirty megabytes of somebody else's work has no business in a repository for
 * a page that is forty kilobytes.
 *
 * What it uses is the decoder the runtime importer uses, on purpose. A second
 * one written for baking would drift from it, and then a map opened from a file
 * would look different from the same creature standing in a level written here.
 *
 * The output is Freedoom's artwork, which is licensed BSD three-clause rather
 * than being anybody's commercial game. The notice that has to travel with it
 * is in `docs/freedoom/`.
 */

import { readFileSync } from 'node:fs'
import { CODES } from '../src/columns/bakedart.ts'
import type { Sprite } from '../src/columns/sprite.ts'
import { readArt } from '../src/columns/wad.ts'
import { deathFrame, frontFacing, pictureSize, readPicture, spriteFromPicture } from '../src/columns/wadpic.ts'

/**
 * What to bake, and what to call it.
 *
 * Its own list rather than one read out of the importers, because those import
 * the art this generates and a converter that cannot run until its own output
 * exists is a converter nobody can rerun. A check holds the two lists to each
 * other instead.
 */
const CREATURES: readonly (readonly [string, string])[] = [
  ['POSS', 'TROOPER'],
  ['SPOS', 'GUNNER'],
  ['CPOS', 'REPEATER'],
  ['TROO', 'IMP'],
  ['SARG', 'HOUND'],
  ['HEAD', 'FLOATER'],
  ['SKUL', 'EMBER'],
  ['BOSS', 'BARON'],
  ['BOS2', 'KNIGHT'],
  ['PAIN', 'BROODER'],
  ['SKEL', 'STALKER'],
  ['FATT', 'BLOATER'],
  ['BSPI', 'WEAVER'],
  ['VILE', 'REVIVER'],
  ['CYBR', 'TITAN'],
  ['SPID', 'MATRIARCH'],
  // The player, for the three corpses the maps place of one. Baked as a creature
  // because what is wanted is the fallen frame, and that is the one thing only
  // the creature path works out.
  ['PLAY', 'MARINE'],
]

const SUPPLIES: readonly (readonly [string, string])[] = [
  // Weapons, armour and the powerups, which the maps are full of and which
  // nothing here could pick up until now: armour stands on sixty-four of the
  // sixty-eight maps, the rocket launcher on fifty-eight, the shotgun on
  // fifty-seven. Every lump below resolves in freedoom2; SGN2 and MEGA are
  // Doom II's own and are absent from the first file, which the baker already
  // handles by skipping what it cannot find.
  ['SHOT', 'SHOTGUN'],
  ['SGN2', 'DOUBLE_SHOTGUN'],
  ['MGUN', 'CHAINGUN'],
  ['LAUN', 'LAUNCHER_PICKUP'],
  ['PLAS', 'PLASMA'],
  ['BFUG', 'BFG'],
  ['CSAW', 'CHAINSAW'],
  ['BPAK', 'BACKPACK'],
  ['ARM1', 'ARMOUR'],
  ['ARM2', 'ARMOUR_HEAVY'],
  ['BON2', 'ARMOUR_BIT'],
  ['SOUL', 'SOULSPHERE'],
  ['MEGA', 'MEGASPHERE'],
  ['PSTR', 'BERSERK'],
  ['PINV', 'INVULNERABILITY'],
  ['PINS', 'BLUR'],
  ['PMAP', 'COMPUTER_MAP'],
  ['PVIS', 'LIGHT_AMP'],
  // The one powerup picture that was missed the first time round, which is why
  // the radiation suit stood in sixty-eight maps as a thing with no art.
  ['SUIT', 'RADIATION_SUIT'],
  // What the two cell-fed weapons throw. Projectiles were hand-drawn literals
  // while the only two were a bolt and a slug; these are the file's own, which
  // is what the rest of the art in here is.
  // The two the maps place two hundred and thirty-eight of and this game had
  // nothing to do with, so they were never given pictures either.
  // The two things on the last map that can be shot and are not creatures.
  ['BBRN', 'BOSS_BRAIN'],
  ['KEEN', 'HANGING_KEEN'],
  ['CELL', 'CELL_CHARGE'],
  ['CELP', 'CELL_PACK'],
  ['PLSS', 'PLASMA_BOLT'],
  ['BFS1', 'CANNON_SHELL'],
  ['BAR1', 'BARREL'],

  ['BON1', 'BONUS'],
  ['STIM', 'STIM'],
  ['MEDI', 'MEDIKIT'],
  ['CLIP', 'CLIP'],
  ['AMMO', 'CLIP_BOX'],
  ['SHEL', 'SHELLS'],
  ['SBOX', 'SHELL_CRATE'],
  ['ROCK', 'ROCKET'],
  ['BROK', 'ROCKET_BOX'],
  ['BKEY', 'BLUE_KEY'],
  ['BSKU', 'BLUE_SKULL'],
  ['RKEY', 'RED_KEY'],
  ['RSKU', 'RED_SKULL'],
  ['YKEY', 'AMBER_KEY'],
  ['YSKU', 'AMBER_SKULL'],
]

/**
 * The interface pictures worth having, which is one of them.
 *
 * Most of Freedoom's interface does not survive being turned into characters,
 * and looking at it is what settled that. `TITLEPIC` is a 320 by 200 painting:
 * at thirty rows and again at forty-six it comes out as a low-contrast fog of
 * colons with no shape in it at all. `STBAR` is worse value -- it is the metal
 * texture behind the status bar, and everything that makes a status bar useful
 * is composited onto it at runtime, so baking it buys a noisy stripe with no
 * numbers on it. The small font is 9 by 7 pixels a glyph, and drawing a picture
 * of the letter A as characters is a worse letter A than the letter A.
 *
 * The logo does survive. At eight rows it is still readable and at twelve it is
 * crisp, because it is large flat lettering rather than a painting -- which is
 * the property that decides this, not whether something is "interface".
 */
const INTERFACE: readonly (readonly [string, string, number])[] = [
  ['M_DOOM', 'LOGO', 12],
  /*
   * The weapon in your hands, at rest and firing.
   *
   * Fourteen rows, which is about a third of the fifty a desk draws -- the
   * proportion the original gives it. A fixed count rather than a fraction of
   * the grid: a phone draws seventy-seven rows at eight pixels and the same
   * fourteen come out smaller there, which is what you want, because the gun is
   * furniture and the room is the thing being looked at.
   *
   * All nine, which is the original's arsenal.
   *
   * This comment has now twice said that some of these were left out because
   * there was nothing here to fire them with -- first the four the maps place
   * and this game folded away, then the fist and the saw. Both sentences were
   * true when written and both stopped being true without the comment noticing.
   * There is nothing left to leave out.
   */
  ['PISGA0', 'SIDEARM_HELD', 14],
  ['PISGB0', 'SIDEARM_FIRING', 14],
  ['SHTGA0', 'SCATTERGUN_HELD', 14],
  ['SHTGB0', 'SCATTERGUN_FIRING', 14],
  ['MISGA0', 'LAUNCHER_HELD', 14],
  ['MISGB0', 'LAUNCHER_FIRING', 14],
  ['PUNGA0', 'FISTS_HELD', 14],
  ['PUNGB0', 'FISTS_FIRING', 14],
  ['SAWGA0', 'CHAINSAW_HELD', 14],
  ['SAWGB0', 'CHAINSAW_FIRING', 14],
  ['SHT2A0', 'TWINBORE_HELD', 14],
  ['SHT2B0', 'TWINBORE_FIRING', 14],
  ['CHGGA0', 'AUTOGUN_HELD', 14],
  ['CHGGB0', 'AUTOGUN_FIRING', 14],
  ['PLSGA0', 'ARC_RIFLE_HELD', 14],
  ['PLSGB0', 'ARC_RIFLE_FIRING', 14],
  ['BFGGA0', 'CANNON_HELD', 14],
  ['BFGGB0', 'CANNON_FIRING', 14],
]


/**
 * The furniture: lamps, pillars, trees, corpses and the things that hang.
 *
 * Four thousand of these stand across the sixty-eight maps and not one of them
 * was drawn, which made a room the map had filled a room this game showed empty.
 * They are their own list rather than more supplies because of what they are
 * not: nothing here is picked up, and the numbers that matter about them --
 * whether you can walk through one, how wide it is, whether it hangs -- come out
 * of the original's own table rather than being chosen here. See `waddecor.ts`.
 *
 * The corpses of creatures are absent on purpose. A dead trooper is the trooper's
 * own fallen frame, which is already baked, so five of these thing numbers cost
 * nothing at all.
 */
const DECOR: readonly (readonly [string, string])[] = [
  ['BRS1', 'BRAIN_POOL'],
  ['CAND', 'CANDLE'],
  ['CBRA', 'CANDELABRA'],
  ['CEYE', 'EVIL_EYE'],
  ['COL1', 'TALL_GREEN_PILLAR'],
  ['COL2', 'SHORT_GREEN_PILLAR'],
  ['COL3', 'TALL_RED_PILLAR'],
  ['COL4', 'SHORT_RED_PILLAR'],
  ['COL5', 'HEART_PILLAR'],
  ['COL6', 'SKULL_PILLAR'],
  ['COLU', 'FLOOR_LAMP'],
  ['ELEC', 'TECHNO_COLUMN'],
  ['FCAN', 'BURNING_BARREL'],
  ['FSKU', 'FLOATING_SKULL'],
  ['GOR1', 'HANGING_TWITCHING'],
  ['GOR2', 'HANGING_ARMS_OUT'],
  ['GOR3', 'HANGING_BODY'],
  ['GOR4', 'HANGING_ONE_LEG'],
  ['GOR5', 'HANGING_LEG'],
  ['HDB1', 'HANGING_GUTTED'],
  ['HDB2', 'HANGING_GUTTED_OPEN'],
  ['HDB3', 'HANGING_TORSO'],
  ['HDB4', 'HANGING_TORSO_DOWN'],
  ['HDB5', 'HANGING_TORSO_OPEN'],
  ['HDB6', 'HANGING_TORSO_SPLIT'],
  ['POB1', 'BLOOD_POOL'],
  ['POB2', 'BLOOD_POOL_WIDE'],
  ['POL1', 'IMPALED_BODY'],
  ['POL2', 'SKULL_KEBAB'],
  ['POL3', 'SKULL_PILE'],
  ['POL4', 'SKULL_ON_POLE'],
  ['POL5', 'FLESH_POOL'],
  ['POL6', 'TWITCHING_BODY'],
  ['SMBT', 'SHORT_BLUE_TORCH'],
  ['SMGT', 'SHORT_GREEN_TORCH'],
  ['SMIT', 'STALAGMITE'],
  ['SMRT', 'SHORT_RED_TORCH'],
  ['TBLU', 'BLUE_TORCH'],
  ['TGRN', 'GREEN_TORCH'],
  ['TLMP', 'TALL_LAMP'],
  ['TLP2', 'SHORT_LAMP'],
  ['TRE1', 'BURNT_TREE'],
  ['TRE2', 'BIG_TREE'],
  ['TRED', 'RED_TORCH'],
]

/**
 * The cell aspect the sampling is done at.
 *
 * Measured off the real font in a browser. It decides how many columns of
 * characters a picture is worth and nothing else -- the shape comes from the
 * width and height the art is drawn at -- so it being slightly off on somebody
 * else's screen costs detail rather than proportion.
 */
const CELL_ASPECT = 0.5627

interface Baked {
  readonly name: string
  readonly sprite: Sprite
  readonly rows: readonly string[]
  readonly hues: readonly string[]
  readonly palette: string
  readonly colours: number
  readonly steps: number
  readonly scale: number
}

const hex = (value: number, scale: number): string =>
  Math.max(0, Math.min(255, Math.round((value / scale) * 255)))
    .toString(16)
    .padStart(2, '0')

const packed = (hue: readonly [number, number, number], scale: number): string =>
  hex(hue[0], scale) + hex(hue[1], scale) + hex(hue[2], scale)

/**
 * The brightest single channel anywhere in the picture.
 *
 * Everything is stored as a fraction of this. A fixed ceiling of 1.2 was tried
 * and clipped: the decoder normalises *brightness* to 1.2, and a saturated
 * colour reaches that with a channel far above it -- 1.68 for a pure green.
 */
function brightestChannel(sprite: Sprite): number {
  let most = 1e-6
  for (let row = 0; row < sprite.rows.length; row++) {
    for (let col = 0; col < sprite.rows[row]!.length; col++) {
      if (sprite.rows[row]![col] === ' ') continue
      for (const value of sprite.colors![row]![col]!) most = Math.max(most, value)
    }
  }
  return most
}

/**
 * A picture as a palette and two strings the same shape.
 *
 * Quantised only as far as it has to be. Any one picture usually has fewer
 * colours than there are characters to index them with; the few that do not
 * lose a step at a time until they fit, which is a visible loss only on the one
 * or two that need it and is better than spending two characters a cell on all
 * of them.
 */
function encode(name: string, sprite: Sprite): Baked {
  const scale = brightestChannel(sprite)
  for (let steps = 256; steps >= 4; steps = Math.floor(steps / 2)) {
    const order: string[] = []
    const seen = new Map<string, number>()
    const hues: string[] = []
    let painted = 0
    let red = 0
    let green = 0
    let blue = 0

    for (let row = 0; row < sprite.rows.length; row++) {
      let line = ''
      for (let col = 0; col < sprite.rows[row]!.length; col++) {
        if (sprite.rows[row]![col] === ' ') {
          line += ' '
          continue
        }
        const hue = sprite.colors![row]![col]!
        const quantised = hue.map(
          (value) => (Math.round((value / scale) * (steps - 1)) / (steps - 1)) * scale,
        ) as [number, number, number]
        const key = packed(quantised, scale)
        let index = seen.get(key)
        if (index === undefined) {
          index = order.length
          order.push(key)
          seen.set(key, index)
        }
        line += CODES[index] ?? ' '
        painted++
        red += quantised[0]
        green += quantised[1]
        blue += quantised[2]
      }
      hues.push(line)
    }

    if (order.length > CODES.length) continue
    return {
      name,
      sprite,
      rows: sprite.rows,
      hues,
      palette: order.join(''),
      colours: order.length,
      steps,
      scale,
    }
  }
  throw new Error(`${name} could not be squeezed into ${CODES.length} colours`)
}

const quote = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function emit(baked: Baked): string {
  const rows = baked.rows.map((row) => `    ${quote(row)},`).join('\n')
  const hues = baked.hues.map((row) => `    ${quote(row)},`).join('\n')
  const tint = packed(baked.sprite.tint as [number, number, number], baked.scale)
  return (
    `/** ${baked.colours} colours, ${baked.rows.length} by ${baked.rows[0]!.length} cells. */\n` +
    `export const ${baked.name}: Sprite = unpackSprite(\n` +
    `  [\n${rows}\n  ],\n` +
    `  [\n${hues}\n  ],\n` +
    `  '${baked.palette}',\n` +
    `  '${tint}',\n` +
    `  ${baked.sprite.width.toFixed(4)},\n` +
    `  ${baked.scale.toFixed(4)},\n` +
    `)\n`
  )
}

/**
 * Where a lump starts, by name, anywhere in the file.
 *
 * `readArt` collects the run between the sprite markers, which is where the
 * creatures live and where the interface does not.
 */
function lumpAt(view: DataView, want: string): number | null {
  const count = view.getInt32(4, true)
  const directory = view.getInt32(8, true)
  for (let i = 0; i < count; i++) {
    const entry = directory + i * 16
    let name = ''
    for (let c = 0; c < 8; c++) {
      const code = view.getUint8(entry + 8 + c)
      if (code === 0) break
      name += String.fromCharCode(code)
    }
    if (name === want && view.getInt32(entry + 4, true) > 0) return view.getInt32(entry, true)
  }
  return null
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('give me one or more WADs to read; the first one that has a picture wins')
  process.exit(1)
}

const made: Baked[] = []
/**
 * How tall each picture is in the file, in pixels.
 *
 * Emitted alongside the art because the alternative is somebody choosing a size
 * for each of a hundred things by eye. In the original a sprite's pixel height
 * *is* its height in map units, so one number divided by the units in a metre
 * gives the size it should be drawn at -- measured rather than guessed, and it
 * lands within a few hundredths of the sizes that were guessed for the supplies.
 *
 * Not the mobj height from the original's table, which is its collision box and
 * is wrong for this: a floor lamp is sixteen units tall to walk into and eighty
 * pixels tall to look at.
 */
const tall = new Map<string, number>()
const done = new Set<string>()
for (const path of files) {
  const bytes = new Uint8Array(readFileSync(path))
  const art = readArt(bytes)
  if (art === null) {
    console.error(`${path} has no pictures in it`)
    continue
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // The interface pieces are named exactly and live outside the sprite run, so
  // they are looked up by name rather than by walking frames.
  for (const [lump, name, rows] of INTERFACE) {
    if (done.has(lump)) continue
    const where = lumpAt(view, lump)
    if (where === null) continue
    done.add(lump)
    const picture = spriteFromPicture(readPicture(view, where), art.palette, { height: 1 }, CELL_ASPECT, rows)
    if (picture !== null) made.push(encode(name, picture))
  }

  for (const [prefix, name] of [...CREATURES, ...SUPPLIES, ...DECOR]) {
    if (done.has(prefix)) continue
    const standing = frontFacing(art.sprites, prefix)
    if (standing === null) continue
    done.add(prefix)

    const at = art.sprites.get(standing)!
    const upright = spriteFromPicture(readPicture(view, at), art.palette, { height: 1 }, CELL_ASPECT)
    if (upright === null) continue
    made.push(encode(name, upright))
    tall.set(name, pictureSize(view, at).height)

    const dead = deathFrame(view, art.sprites, prefix, pictureSize(view, at).height)
    if (dead === null) continue
    // At a height of one, like everything else here, and not at the standing
    // width it will eventually be shown at. `unpackSprite` reads the height of
    // a baked picture as one by definition, so a frame baked any other way came
    // back with its proportions thrown away -- a corpse exactly as tall as the
    // creature that fell over. Laying it down is `atWidth`'s job, at the point
    // where the size is known.
    const fallen = spriteFromPicture(readPicture(view, art.sprites.get(dead)!), art.palette, { height: 1 }, CELL_ASPECT)
    if (fallen !== null) made.push(encode(`${name}_DOWN`, fallen))
  }
}

const missing = [...CREATURES, ...SUPPLIES, ...DECOR, ...INTERFACE]
  .filter(([prefix]) => !done.has(prefix))
  .map(([prefix]) => prefix)
if (missing.length > 0) console.error(`no picture found for: ${missing.join(', ')}`)

const header = `/**
 * Freedoom's artwork, turned into characters.
 *
 * GENERATED by \`node scripts/bakeart.ts\` -- do not edit by hand. Rerunning it
 * against the same files gives the same bytes back.
 *
 * The pictures are Freedoom's, used under the three-clause BSD licence it is
 * released under; the notice that has to travel with them is in
 * \`docs/freedoom/\`. Nothing here is from a commercial game.
 *
 * Every picture is baked at a height of one and scaled by whoever draws it, so
 * that how big a thing is stays this game's decision and only how it looks is
 * taken from the file.
 */

import { unpackSprite } from '../columns/bakedart.ts'
import type { Sprite } from '../columns/sprite.ts'
`

console.log(header)
console.log(made.map(emit).join('\n'))
console.log(`
/**
 * How tall each picture is in the file, in pixels.
 *
 * Divided by the units in a metre this is the size a thing should be drawn at,
 * because in the original a sprite's pixel height is its height in map units.
 * Here so that nothing has to choose a size for a hundred things by eye.
 */
export const PIXEL_HEIGHT: Readonly<Record<string, number>> = {
${[...tall.entries()].map(([name, height]) => `  ${name}: ${height},`).join('\n')}
}`)
console.error(
  `baked ${made.length} pictures; colours per picture ${Math.min(...made.map((b) => b.colours))}..` +
    `${Math.max(...made.map((b) => b.colours))}, quantised below full only on ` +
    `${made.filter((b) => b.steps < 256).length} of them`,
)
