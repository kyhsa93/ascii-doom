/**
 * Art that was turned into characters before the game shipped.
 *
 * The decoder in `wadpic.ts` runs on a file a player opened. This is the other
 * half: the same decoder run once, at a desk, with the answer written into the
 * source. What that buys is the whole point of it -- the game looks the way it
 * looks the moment it is opened, with no file to find, no thirty megabytes, and
 * nothing to explain.
 *
 * The encoding is a character per cell twice over. One string of glyphs and one
 * string of colour indices, laid out exactly alike, against a palette that
 * belongs to that one picture. Per picture rather than shared, because the
 * whole set needs a hundred and sixty-eight colours even quantised to eight
 * steps a channel and a single character cannot index that many -- while any
 * one picture uses few enough that it can.
 *
 * Everything is baked at a height of one. A creature's real size is this game's
 * business and is applied by whoever asks for the art, which also keeps the
 * converter from having to import the things it is generating art for.
 */

import type { Sprite } from './sprite.ts'

/**
 * The characters a colour index is written as.
 *
 * Printable, and deliberately without space, quote, apostrophe, backslash or
 * backtick: space means transparent, and the other four would have to be
 * escaped in the generated source, which is the kind of difference that makes a
 * diff unreadable and an off-by-one invisible.
 */
export const CODES =
  '!#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~'

/**
 * A palette byte is a fraction of the picture's own brightest channel.
 *
 * Not a fraction of some fixed ceiling, which is the mistake this was written
 * with first. The decoder stretches a picture until its *brightness* reaches
 * 1.2, and brightness is a weighted sum -- so a saturated colour needs a
 * channel well above 1.2 to get there, and a pure green needs 1.68. Against a
 * fixed ceiling those channels were clipped, and the baked art came out
 * differing from the live decoder by more than the whole range.
 *
 * Clipping is not harmless even though the presenter clamps at one: the colour
 * is multiplied by distance first, so 1.68 and 1.2 are plainly different once
 * anything is more than arm's length away.
 */
function colourAt(palette: string, index: number, scale: number): [number, number, number] {
  const at = index * 6
  return [
    (parseInt(palette.slice(at, at + 2), 16) / 255) * scale,
    (parseInt(palette.slice(at + 2, at + 4), 16) / 255) * scale,
    (parseInt(palette.slice(at + 4, at + 6), 16) / 255) * scale,
  ]
}

/**
 * A baked picture as the renderer wants it.
 *
 * `hues` is the same shape as `rows`: one character per cell, a space wherever
 * the glyph is a space. A row of colours shorter than its row of glyphs is a
 * generator bug rather than something to paper over, so it is refused.
 */
export function unpackSprite(
  rows: readonly string[],
  hues: readonly string[],
  palette: string,
  tint: string,
  width: number,
  scale: number,
): Sprite {
  if (rows.length !== hues.length) {
    throw new Error(`baked art has ${rows.length} rows of glyphs and ${hues.length} of colour`)
  }
  const colors: [number, number, number][][] = []
  for (let row = 0; row < rows.length; row++) {
    const glyphs = rows[row]!
    const codes = hues[row]!
    if (glyphs.length !== codes.length) {
      throw new Error(`baked row ${row} is ${glyphs.length} glyphs against ${codes.length} colours`)
    }
    const line: [number, number, number][] = []
    for (let col = 0; col < codes.length; col++) {
      const code = codes[col]!
      line.push(code === ' ' ? [0, 0, 0] : colourAt(palette, CODES.indexOf(code), scale))
    }
    colors.push(line)
  }
  return { rows: [...rows], colors, tint: colourAt(tint, 0, scale), width, height: 1 }
}

/**
 * The same picture at the size this game says the thing is.
 *
 * Baked art is a shape and a set of colours; how big the thing is belongs to
 * the game. Height for something standing up.
 */
export function atHeight(sprite: Sprite, height: number): Sprite {
  return { ...sprite, width: sprite.width * height, height }
}

/**
 * And width for something lying down.
 *
 * A corpse fitted to a height would shrink as it fell -- the picture is flatter,
 * so the same height across a shorter picture is a narrower one -- and a
 * creature that gets smaller when it dies reads as one walking away.
 */
export function atWidth(sprite: Sprite, width: number): Sprite {
  return { ...sprite, width, height: width / sprite.width }
}
