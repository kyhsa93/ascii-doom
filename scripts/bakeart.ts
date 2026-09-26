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
]

const SUPPLIES: readonly (readonly [string, string])[] = [
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
const INTERFACE: readonly (readonly [string, string, number])[] = [['M_DOOM', 'LOGO', 12]]

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

  for (const [prefix, name] of [...CREATURES, ...SUPPLIES]) {
    if (done.has(prefix)) continue
    const standing = frontFacing(art.sprites, prefix)
    if (standing === null) continue
    done.add(prefix)

    const at = art.sprites.get(standing)!
    const upright = spriteFromPicture(readPicture(view, at), art.palette, { height: 1 }, CELL_ASPECT)
    if (upright === null) continue
    made.push(encode(name, upright))

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

const missing = [...CREATURES, ...SUPPLIES, ...INTERFACE]
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
console.error(
  `baked ${made.length} pictures; colours per picture ${Math.min(...made.map((b) => b.colours))}..` +
    `${Math.max(...made.map((b) => b.colours))}, quantised below full only on ` +
    `${made.filter((b) => b.steps < 256).length} of them`,
)
