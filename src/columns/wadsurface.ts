/**
 * What a texture name is made of.
 *
 * A WAD names every wall and floor, and the importer was throwing all of it
 * away: every imported wall was drawn as `wall` and every floor as `floor`, so
 * a rusted service corridor and a marble hall were the same room twice. The
 * geometry was right and the place had no character at all.
 *
 * Naming them individually is not on. Counted across the first file: five
 * hundred and sixty-four distinct wall textures and two hundred and one flats.
 * But the names are not arbitrary -- they are stems with numbers after them,
 * and sixty-nine per cent of wall surfaces and ninety-five per cent of floor
 * surfaces fall under a couple of dozen of those stems. So this maps the stem
 * and leaves the rest alone.
 *
 * Longest stem first, always. `BROWNGRN` has to be tested before `BROWN` or it
 * never matches, and `SW1` before `S` would match half the file. The table is
 * sorted by length when it is built rather than by hand, because a hand-sorted
 * table is one insertion away from being wrong in a way nothing would notice.
 */

/** Stems that decide a wall's material, longest matched first. */
const WALL_STEMS: readonly (readonly [string, string])[] = [
  ['BROWNGRN', 'rust'],
  ['BROWN', 'rust'],
  ['BRONZE', 'rust'],
  ['SUPPORT', 'metal'],
  ['METAL', 'metal'],
  ['SHAWN', 'metal'],
  ['SILVER', 'metal'],
  ['DOORSTOP', 'metal'],
  ['DOORTRAK', 'metal'],
  ['BIGDOOR', 'metal'],
  ['SLADWALL', 'stone'],
  ['SLAD', 'stone'],
  ['GSTONE', 'stone'],
  ['STONE', 'stone'],
  ['GRAY', 'stone'],
  ['MARB', 'stone'],
  ['ROCK', 'stone'],
  ['STARG', 'stone'],
  ['STARTAN', 'stone'],
  ['BRICK', 'stone'],
  ['BRIK', 'stone'],
  ['WOOD', 'rust'],
  ['PANEL', 'rust'],
  ['COMPUTE', 'circuit'],
  ['COMP', 'circuit'],
  ['TEKWALL', 'circuit'],
  ['TEK', 'circuit'],
  ['SPACEW', 'circuit'],
  ['SKIN', 'stone'],
  ['SKSPINE', 'stone'],
  ['SKULL', 'stone'],
  ['LITE', 'circuit'],
  ['LITEBLU', 'circuit'],
  ['SW1', 'circuit'],
  ['SW2', 'circuit'],
  ['EXIT', 'circuit'],
  ['REDWALL', 'circuit'],
]

/** And a flat's, which separate more cleanly: ninety-five per cent match. */
const FLAT_STEMS: readonly (readonly [string, string])[] = [
  ['NUKAGE', 'sludge'],
  ['BLOOD', 'sludge'],
  ['LAVA', 'sludge'],
  ['SLIME', 'sludge'],
  ['FWATER', 'sludge'],
  ['TLITE', 'stoneCeiling'],
  ['CEIL', 'stoneCeiling'],
  ['RROCK', 'stoneFloor'],
  ['GRNROCK', 'stoneFloor'],
  ['MFLR', 'stoneFloor'],
  ['DEM', 'stoneFloor'],
  ['CRATOP', 'stoneFloor'],
  ['STEP', 'stoneFloor'],
  ['SFLR', 'stoneFloor'],
  ['FLOOR', 'stoneFloor'],
  ['FLAT', 'stoneFloor'],
  ['GATE', 'stoneFloor'],
]

const byLength = (table: readonly (readonly [string, string])[]) =>
  [...table].sort((one, other) => other[0].length - one[0].length)

const WALLS = byLength(WALL_STEMS)
const FLATS = byLength(FLAT_STEMS)

/**
 * The material a wall texture is drawn with.
 *
 * `wall` for anything unrecognised, which is what every one of them was before
 * this existed -- so a name this does not know costs nothing rather than
 * throwing or drawing a hole.
 */
export function wallMaterial(texture: string): string {
  const name = texture.toUpperCase()
  for (const [stem, material] of WALLS) if (name.startsWith(stem)) return material
  return 'wall'
}

/** The material a floor or ceiling flat is drawn with. */
export function flatMaterial(flat: string, ceiling = false): string {
  const name = flat.toUpperCase()
  for (const [stem, material] of FLATS) if (name.startsWith(stem)) return material
  return ceiling ? 'ceiling' : 'floor'
}

/** Every material these can produce, for a check to hold against the renderer. */
export function surfaceMaterials(): string[] {
  return [...new Set([...WALL_STEMS.map(([, m]) => m), ...FLAT_STEMS.map(([, m]) => m), 'wall', 'floor', 'ceiling'])]
}
