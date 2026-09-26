/**
 * A WAD, built in memory, a few hundred bytes of it.
 *
 * Shared by the Node checks and the browser ones so that the bytes a page is
 * asked to open are the same bytes the parser is held to. Written rather than
 * committed as a file: the real ones are thirty megabytes of someone else's
 * work, and a parser is better held to account by something small enough to
 * read in one go.
 *
 * Two square rooms side by side sharing the wall between them, the eastern one
 * full of nukage, and the western floor above zero so that a check comparing a
 * player's floor against the room's compares something.
 */
export function tinyWad(
  mapName: string,
  withStart = true,
  ceilingFlat = '',
  /** Extra things, as [x, y, angle, type] in map units, placed after the start. */
  extraThings: readonly [number, number, number, number][] = [],
  /**
   * A linedef special to hang on the wall between the two rooms.
   *
   * That is the only two-sided line here, which makes it the only one that can
   * carry a special worth anything: a manual door is the sector behind the line
   * you press, and a walk-over exit is the line you cross. Zero by default, so
   * every fixture written before this one comes out byte for byte the same.
   */
  lineSpecial = 0,
  /**
   * Whether the eastern room is shut like a door, ceiling down to its floor.
   *
   * A door wants that and an exit does not -- an exit is a line you walk
   * across, so the room beyond it has to be somewhere you can stand. Defaults
   * to whatever the special implies, which keeps every existing caller exact.
   */
  shutBack = lineSpecial !== 0,
  /**
   * Which way the player starts facing, in degrees counter-clockwise from east.
   *
   * Ninety by default, which is north, because that is what this fixture has
   * always said and a parser check asserts it. A check that has to walk into
   * the wall between the rooms wants zero instead -- walking is the only way to
   * get within arm's reach of a switch, and no amount of it helps if you set
   * off at right angles to the thing.
   */
  startAngle = 90,
  /**
   * A tag, worn by the eastern room and called for by the line between them.
   *
   * One parameter for both because that is what a tag is: the line names a
   * number and the rooms wearing it are what it acts on. A lift cannot be
   * written any other way -- every lift line in the real files carries one --
   * and a door cannot be written with one at all, since a tagged door special
   * means a room somewhere else. Zero, which the format writes on an ordinary
   * room, by default, so every fixture written before this one comes out byte
   * for byte the same.
   */
  roomTag = 0,
  /**
   * The eastern room's floor.
   *
   * Zero as it always was. A lift wants it above the western room's thirty-two:
   * that gives the platform somewhere to drop to, and makes the step up too
   * tall to walk, which is what leaves a body standing in front of the wall
   * rather than through it.
   */
  backFloor = 0,
): Uint8Array {
  const VERTEXES: [number, number][] = [
    [0, 0],
    [128, 0],
    [128, 128],
    [0, 128],
    [256, 0],
    [256, 128],
  ]
  // v1, v2, flags, special, tag, right sidedef, left sidedef (0xffff for none).
  const LINEDEFS: [number, number, number, number, number, number, number][] = [
    [0, 1, 1, 0, 0, 0, 0xffff],
    // The one that joins the rooms, and the only one with two sides.
    [1, 2, 0, lineSpecial, roomTag, 1, 2],
    [2, 3, 1, 0, 0, 3, 0xffff],
    [3, 0, 1, 0, 0, 4, 0xffff],
    [1, 4, 1, 0, 0, 5, 0xffff],
    [4, 5, 1, 0, 0, 6, 0xffff],
    [5, 2, 1, 0, 0, 7, 0xffff],
  ]
  const SIDEDEF_SECTOR = [0, 0, 1, 0, 0, 1, 1, 1]
  // floor, ceiling, light, special, tag. 7 is Doom's nukage.
  // The western room's floor sits above zero on purpose: with both at zero, a
  // check comparing the player's floor against the room's compares nothing.
  //
  // When the wall between them is a door, the eastern room becomes the door:
  // its ceiling comes down to its floor, which is what a shut door is in the
  // original -- six hundred and eighty-two of the six hundred and ninety-two
  // in the first file are built exactly that way -- and is what lets a check
  // ask whether the way through is blocked before it is opened.
  const SECTORS: [number, number, number, number, number][] = [
    [32, 128, 200, 0, 0],
    [backFloor, shutBack ? backFloor : 128, 200, 7, roomTag],
  ]
  // x, y, angle, type. Type 1 is the first player's start. A file is free to
  // have none, which is a thing worth being able to write down here.
  const THINGS: [number, number, number, number][] = [
    ...(withStart ? ([[64, 64, startAngle, 1]] as [number, number, number, number][]) : []),
    ...extraThings,
  ]

  const bytes = (size: number) => new Uint8Array(size)
  const lump = (size: number, write: (view: DataView) => void) => {
    const data = bytes(size)
    write(new DataView(data.buffer))
    return data
  }

  const things = lump(THINGS.length * 10, (view) => {
    THINGS.forEach(([x, y, angle, type], i) => {
      view.setInt16(i * 10, x, true)
      view.setInt16(i * 10 + 2, y, true)
      view.setInt16(i * 10 + 4, angle, true)
      view.setUint16(i * 10 + 6, type, true)
    })
  })
  const linedefs = lump(LINEDEFS.length * 14, (view) => {
    LINEDEFS.forEach((line, i) => {
      line.forEach((value, f) => view.setUint16(i * 14 + f * 2, value, true))
    })
  })
  const sidedefs = lump(SIDEDEF_SECTOR.length * 30, (view) => {
    SIDEDEF_SECTOR.forEach((sector, i) => view.setInt16(i * 30 + 28, sector, true))
  })
  const vertexes = lump(VERTEXES.length * 4, (view) => {
    VERTEXES.forEach(([x, y], i) => {
      view.setInt16(i * 4, x, true)
      view.setInt16(i * 4 + 2, y, true)
    })
  })
  const sectors = lump(SECTORS.length * 26, (view) => {
    SECTORS.forEach(([floor, ceiling, light, special, tag], i) => {
      view.setInt16(i * 26, floor, true)
      view.setInt16(i * 26 + 2, ceiling, true)
      // The two flat names sit between the heights and the light, eight bytes
      // each, NUL-padded. Left as zeros unless a caller wants one, so every
      // fixture written before this reads back exactly as it did.
      for (let c = 0; c < ceilingFlat.length && c < 8; c++) {
        view.setUint8(i * 26 + 12 + c, ceilingFlat.charCodeAt(c))
      }
      view.setInt16(i * 26 + 20, light, true)
      view.setInt16(i * 26 + 22, special, true)
      view.setInt16(i * 26 + 24, tag, true)
    })
  })

  const entries: [string, Uint8Array][] = [
    [mapName, bytes(0)],
    ['THINGS', things],
    ['LINEDEFS', linedefs],
    ['SIDEDEFS', sidedefs],
    ['VERTEXES', vertexes],
    ['SECTORS', sectors],
  ]

  const body = entries.reduce((total, [, data]) => total + data.length, 0)
  const file = bytes(12 + body + entries.length * 16)
  const view = new DataView(file.buffer)
  for (const [i, code] of [...'IWAD'].map((c) => c.charCodeAt(0)).entries()) view.setUint8(i, code)
  view.setInt32(4, entries.length, true)
  view.setInt32(8, 12 + body, true)

  let at = 12
  let entry = 12 + body
  for (const [lumpName, data] of entries) {
    file.set(data, at)
    view.setInt32(entry, at, true)
    view.setInt32(entry + 4, data.length, true)
    for (let c = 0; c < lumpName.length; c++) view.setUint8(entry + 8 + c, lumpName.charCodeAt(c))
    at += data.length
    entry += 16
  }
  return file
}
