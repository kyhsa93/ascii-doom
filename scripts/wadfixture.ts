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
  /**
   * Whether to give the file a palette and a couple of pictures.
   *
   * Off by default, so every fixture written before this one comes out byte for
   * byte the same. On, the file carries `PLAYPAL` and a sprite run holding
   * `POSSA1` and `CLIPA0` -- the front-facing frame of the commonest creature
   * and the all-angles frame of the commonest box of ammunition, which are the
   * two shapes of sprite name the format uses.
   *
   * The pictures are eight by eight with a transparent border, because a
   * decoder that ignores transparency reads an opaque rectangle and a check
   * against an opaque rectangle would not notice.
   *
   * Two death frames come with them: a flat one and a taller one after it. That
   * is the shape a real death sequence has -- the body falls and then, if it
   * was gibbed, the burst starts over at full height -- and it is the only way
   * to make the rule that stops at the burst do anything.
   */
  withArt = false,
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
    /*
     * The one that joins the rooms, and the only one with two sides.
     *
     * Wound from vertex 2 to vertex 1 -- south -- so that its right-hand side
     * is the western room, which is the room its right sidedef belongs to. It
     * ran the other way until a teleport was hung on it and would not fire:
     * every real file puts the front sidedef on the right of the line's
     * direction, this put it on the left, and a rule about which side a body
     * crossed from came out backwards here while being right on every map.
     * Nothing else noticed, because nothing else had asked about a side.
     */
    [2, 1, 0, lineSpecial, roomTag, 1, 2],
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

  /**
   * Doom's picture format: a header, one offset per column, then each column as
   * runs of opaque pixels. A run is a start row, a length, a padding byte, the
   * palette indices, and another padding byte; 255 ends the column.
   */
  const picture = (w: number, h: number, indexAt: (x: number, y: number) => number): Uint8Array => {
    const columns: number[][] = []
    for (let x = 0; x < w; x++) {
      const out: number[] = []
      let y = 0
      while (y < h) {
        if (indexAt(x, y) < 0) {
          y++
          continue
        }
        const start = y
        const run: number[] = []
        while (y < h && indexAt(x, y) >= 0) {
          run.push(indexAt(x, y))
          y++
        }
        out.push(start, run.length, 0, ...run, 0)
      }
      out.push(0xff)
      columns.push(out)
    }
    const header = 8 + w * 4
    const body = columns.reduce((total, column) => total + column.length, 0)
    const data = bytes(header + body)
    const view = new DataView(data.buffer)
    view.setInt16(0, w, true)
    view.setInt16(2, h, true)
    view.setInt16(4, Math.floor(w / 2), true)
    view.setInt16(6, h, true)
    let at = header
    columns.forEach((column, x) => {
      view.setInt32(8 + x * 4, at, true)
      for (const byte of column) data[at++] = byte
    })
    return data
  }

  // Index 1 is red, 2 green, 3 very nearly black, and everything else black.
  //
  // The dark one earns its place, and its exact value is the point. A ramp that
  // begins with a space turns a dark pixel into a hole, and with only a bright
  // colour and a middling one in the picture, adding that space changed nothing
  // that could be told apart -- so the constant it guards had no check behind
  // it. Eight of two hundred and fifty-five is the brightness that lands on the
  // first glyph of a ramp either way: the darkest character without the space,
  // and the space with it. Twelve was tried and was not dark enough to fall off
  // the end.
  const playpal = bytes(768)
  playpal.set([0, 0, 0, 255, 0, 0, 0, 255, 0, 8, 8, 8], 0)
  // A border of nothing, a red body, a green stripe down the middle, and one
  // column of the dark.
  const edged = (x: number, y: number): number =>
    x === 0 || y === 0 || x === 7 || y === 7 ? -1 : x === 3 || x === 4 ? 2 : x === 6 ? 3 : 1

  const entries: [string, Uint8Array][] = [
    [mapName, bytes(0)],
    ['THINGS', things],
    ['LINEDEFS', linedefs],
    ['SIDEDEFS', sidedefs],
    ['VERTEXES', vertexes],
    ['SECTORS', sectors],
    ...(withArt
      ? ([
          ['PLAYPAL', playpal],
          ['S_START', bytes(0)],
          ['POSSA1', picture(8, 8, edged)],
          ['CLIPA0', picture(8, 8, edged)],
          // Lying down: two rows of the eight, so it is well under the three
          // quarters that counts as fallen.
          ['POSSL0', picture(8, 2, (x) => (x === 0 || x === 7 ? -1 : 1))],
          // And then back up again, which is where a death stops being one.
          ['POSSU0', picture(8, 7, (x, y) => (x === 0 || y === 0 ? -1 : 2))],
          ['S_END', bytes(0)],
        ] as [string, Uint8Array][])
      : []),
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
