/**
 * A picture out of a WAD, as characters.
 *
 * The format is columns rather than rows, which is not an accident of 1993 so
 * much as the same decision this renderer makes: a wall is drawn a column at a
 * time, so the art is stored a column at a time. Each column is a run of posts
 * -- a start, a length, that many palette indices -- and everything a post does
 * not cover is transparent. Fifty-five percent of the pixels in an imp are
 * opaque; the rest is the shape.
 *
 * Turning one into characters is the thing this engine already does to the
 * whole screen: average a patch of colour, read a glyph off a ramp by how
 * bright it is. The difference is that here the colour is kept as well as the
 * glyph, because a picture whose every cell is one tint is a silhouette, and a
 * silhouette of a monster is not a monster.
 *
 * One trap, already paid for elsewhere in this project: the ramp must not begin
 * with a space, or a dark pixel that is definitely there comes out as a hole.
 * Transparency is decided by how much of the cell the picture covers, and by
 * nothing else.
 */

import { luminance } from '../../vendor/ascii-engine/src/core/ramp.ts'
import type { Sprite } from './sprite.ts'

/**
 * Glyphs from darkest to brightest, and deliberately no space at the front.
 *
 * `RAMPS.short` starts with one, which is right for a framebuffer -- nothing
 * drawn stays empty -- and wrong here, where a cell is either part of the
 * picture or not part of it. A dark pixel is part of it.
 */
const RAMP = '.:-=+*#%@'

/**
 * How much of a cell has to be painted before the cell is painted.
 *
 * Under a third and the cell is the edge of something rather than the thing, so
 * it is left transparent. Too low and a creature grows a halo of stray glyphs
 * where its outline used to be; too high and it loses its horns.
 */
const COVERAGE = 0.34

/**
 * Where the brightest part of a picture is put.
 *
 * The tints written for this game run to about 1.2, so an imported picture is
 * stretched until its own brightest cell reaches the same place. Taking the
 * palette at face value instead was tried and looked wrong for two reasons at
 * once: the commonest creature averaged [0.29, 0.17, 0.09] against this game's
 * own [1.25, 0.72, 0.55], so it was four times darker than everything standing
 * beside it -- and because it was dark, every cell landed on the bottom two
 * glyphs of a nine-glyph ramp and the shape disappeared into a wash of colons.
 *
 * What this gives up is knowing which monster is the darker one. A grid with
 * nine levels of brightness cannot say both "this is dark" and "this is the
 * shape of a face", and the shape is the one worth having.
 */
const BRIGHTEST = 1.2

/** How many rows of characters a picture is worth, unless it is smaller than that. */
const ROWS = 16

/** How far a death frame may grow before it is the burst rather than the fall. */
const GIB_RISE = 1.4

/** How much shorter than standing a frame has to be before it counts as lying down. */
const LYING = 0.75

export interface Picture {
  readonly width: number
  readonly height: number
  /** Palette index per pixel, row-major, and -1 where nothing was painted. */
  readonly pixels: Int16Array
}

/**
 * Decodes one picture.
 *
 * Throws on anything it cannot read rather than returning a broken picture:
 * this is fed bytes a player chose, and the caller's answer to a file it does
 * not understand is to keep its own art, which it cannot decide if it is handed
 * something half-decoded.
 */
export function readPicture(view: DataView, at: number): Picture {
  const width = view.getInt16(at, true)
  const height = view.getInt16(at + 2, true)
  if (width <= 0 || height <= 0 || width > 2048 || height > 2048) {
    throw new Error(`a picture claiming to be ${width} by ${height}`)
  }

  const pixels = new Int16Array(width * height).fill(-1)
  for (let column = 0; column < width; column++) {
    let p = at + view.getInt32(at + 8 + column * 4, true)
    // A column is posts until the byte that says there are no more. Doom's own
    // reader trusts that byte, so a file that omits it is broken in a way this
    // cannot paper over -- but the row bound below keeps it from running away.
    for (let guard = 0; guard < height + 2; guard++) {
      const top = view.getUint8(p)
      if (top === 0xff) break
      const length = view.getUint8(p + 1)
      // One padding byte each side of the run, which the format has always had
      // and nothing has ever used.
      for (let i = 0; i < length; i++) {
        const row = top + i
        if (row < 0 || row >= height) continue
        pixels[row * width + column] = view.getUint8(p + 3 + i)
      }
      p += 4 + length
    }
  }
  return { width, height, pixels }
}

/**
 * A picture as a sprite, at the size this game says the thing is.
 *
 * The rule everywhere in this importer: the file decides what something looks
 * like and this game decides how big it is. So `fit` comes from the caller and
 * the other side follows the picture's shape. On the commonest creature,
 * fitting its own height lands the drawing at 1.16 times the width of its
 * hitbox, which is very nearly the 1.2 the original drew its own at, and nobody
 * chose it.
 *
 * Height or width, because a creature is measured differently standing and
 * lying down. Fitting a corpse to a height would shrink it as it fell -- the
 * picture is flatter, so the same height across a shorter picture means a
 * narrower one -- and a creature that gets smaller when it dies reads as a
 * creature walking away. Fitting the width instead keeps it the size it was.
 *
 * Null when the picture has nothing in it, which is what an all-transparent
 * lump is: the marker lumps that divide the sprite run have no bytes at all,
 * but a few real ones are empty frames.
 */
export function spriteFromPicture(
  picture: Picture,
  palette: Uint8Array,
  fit: { readonly height: number } | { readonly width: number },
  cellAspect: number,
): Sprite | null {
  const shape = picture.width / picture.height
  const height = 'height' in fit ? fit.height : fit.width / shape
  const width = 'height' in fit ? fit.height * shape : fit.width
  const rows = Math.max(1, Math.min(ROWS, picture.height))
  // Not about shape. The art is stretched across whatever box `width` and
  // `height` describe, so a grid of any proportion comes out the right shape --
  // what the proportion decides is how much of the picture each cell has to
  // average. Dividing by the cell aspect allocates about one art cell per
  // screen cell, which is where the sampling is neither wasted nor coarse: a
  // cell is around 0.57 as wide as it is tall, so a picture as wide as it is
  // tall wants about 1.75 times the columns.
  //
  // It follows that getting this number wrong costs detail and not proportion,
  // which is why the caller is allowed a rough one.
  const cols = Math.max(1, Math.round((rows * shape) / cellAspect))

  // First pass: what colour each cell is, and how bright the brightest is.
  // Both passes are needed because the stretch cannot be known until the whole
  // picture has been looked at, and a cell cannot pick its glyph until it knows
  // where it sits in the stretched range.
  const cells: ([number, number, number] | null)[][] = []
  let brightest = 0
  let painted = 0

  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * picture.height) / rows)
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * picture.height) / rows))
    const line: ([number, number, number] | null)[] = []

    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor((col * picture.width) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * picture.width) / cols))

      let red = 0
      let green = 0
      let blue = 0
      let opaque = 0
      let total = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++
          const index = picture.pixels[y * picture.width + x]!
          if (index < 0) continue
          opaque++
          red += palette[index * 3]!
          green += palette[index * 3 + 1]!
          blue += palette[index * 3 + 2]!
        }
      }

      if (total === 0 || opaque / total < COVERAGE) {
        line.push(null)
        continue
      }
      const hue: [number, number, number] = [red / opaque / 255, green / opaque / 255, blue / opaque / 255]
      brightest = Math.max(brightest, luminance(hue[0], hue[1], hue[2]))
      painted++
      line.push(hue)
    }
    cells.push(line)
  }

  if (painted === 0) return null
  // A picture that is genuinely all black keeps its black rather than being
  // divided by nothing.
  const gain = brightest > 1e-6 ? BRIGHTEST / brightest : 1

  const art: string[] = []
  const colors: [number, number, number][][] = []
  for (const line of cells) {
    let glyphs = ''
    const hues: [number, number, number][] = []
    for (const hue of line) {
      if (hue === null) {
        glyphs += ' '
        hues.push([0, 0, 0])
        continue
      }
      // Brightness picks the glyph and the colour is kept beside it, the same
      // pair the wall renderer writes into every cell it fills -- and both are
      // measured against this picture's own brightest rather than against a
      // byte, which is what puts the whole ramp to work.
      const level = brightest > 1e-6 ? Math.min(1, luminance(hue[0], hue[1], hue[2]) / brightest) : 0
      glyphs += RAMP[Math.round(level * (RAMP.length - 1))]
      hues.push([hue[0] * gain, hue[1] * gain, hue[2] * gain])
    }
    art.push(glyphs)
    colors.push(hues)
  }

  return {
    rows: art,
    // Never read while `colors` is there, and present because the type asks for
    // it -- and because a caller that strips the colours gets a silhouette in
    // roughly the right colour rather than a black cut-out.
    tint: averageOf(colors),
    colors,
    width,
    height,
  }
}

/** The average of the cells that were painted, for the one-colour fallback. */
function averageOf(colors: readonly (readonly (readonly [number, number, number])[])[]): [number, number, number] {
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (const row of colors) {
    for (const hue of row) {
      if (hue[0] === 0 && hue[1] === 0 && hue[2] === 0) continue
      red += hue[0]
      green += hue[1]
      blue += hue[2]
      count++
    }
  }
  if (count === 0) return [1, 1, 1]
  return [red / count, green / count, blue / count]
}

/** How big a picture is, without decoding it. The header says so in its first four bytes. */
export function pictureSize(view: DataView, at: number): { width: number; height: number } {
  return { width: view.getInt16(at, true), height: view.getInt16(at + 2, true) }
}

/**
 * The lump a thing ends up as once it is dead, or null to keep your own.
 *
 * A death is a sequence of frames drawn from every angle at once, so the last
 * of the rotation-zero lumps is where the sequence stops. That is a corpse
 * seven times out of nine in the file this was measured against -- and twice it
 * is not, because a skull bursts and a spider's last frame is the same size as
 * its first. So the test is not which frame it is but whether it is lying down:
 * under three quarters of the standing height, or this keeps the art the game
 * already had. A corpse that stands up is worse than a corpse that is drawn by
 * hand.
 */
export function deathFrame(
  view: DataView,
  sprites: ReadonlyMap<string, number>,
  prefix: string,
  standingHeight: number,
): string | null {
  const facingEveryWay: string[] = []
  for (const name of sprites.keys()) {
    if (name.length === 6 && name.startsWith(prefix) && name[5] === '0') facingEveryWay.push(name)
  }
  facingEveryWay.sort()

  // Walk the frames in order and stop where the height jumps back up, because
  // that is the second sequence starting -- the one where the body bursts
  // rather than falls. Measured across nine creatures in the file this was
  // written against: the largest rise inside a death is 1.33, and the smallest
  // jump into a burst is 2.4, so the two do not overlap anywhere near 1.4.
  let lowest = Infinity
  let corpse: string | null = null
  for (const name of facingEveryWay) {
    const { height } = pictureSize(view, sprites.get(name)!)
    if (height > lowest * GIB_RISE) break
    lowest = Math.min(lowest, height)
    corpse = name
  }

  // And it still has to be lying down. A skull bursts into something larger
  // than it was and a spider's last frame is the size of its first; both of
  // those come back null and keep the art this game drew for them.
  if (corpse === null) return null
  return pictureSize(view, sprites.get(corpse)!).height < standingHeight * LYING ? corpse : null
}

export function frontFacing(sprites: ReadonlyMap<string, number>, prefix: string): string | null {
  let anyFrameA: string | null = null
  for (const name of sprites.keys()) {
    if (!name.startsWith(prefix) || name.length < 6 || name[4] !== 'A') continue
    if (name[5] === '1') return name
    if (name[5] === '0') return name
    anyFrameA ??= name
  }
  return anyFrameA
}
