/**
 * The world, as sectors on a plane.
 *
 * The map is two-dimensional and the third dimension is a pair of numbers per
 * sector: a floor height and a ceiling height. That is the whole of the 1993
 * design, and everything it can and cannot express follows from it — rooms at
 * different heights, windows, steps, lifts and doors all work; a room directly
 * above another room does not exist.
 *
 * Authoring is by polygon rather than by line. A level is a list of closed
 * sector outlines, and any edge that two sectors share is discovered here and
 * becomes a portal: something you can see and usually walk through, with the
 * height difference showing as a step above or below the opening. Edges
 * belonging to one sector are solid wall. Writing the lines by hand instead
 * means keeping both sides of every shared edge in agreement, and there is no
 * reason to do that by hand when the polygons already say it.
 */

/** A closed outline with a floor, a ceiling and a brightness. */
export interface SectorDef {
  /** The outline, as map-plane points. Closed implicitly; do not repeat the first. */
  polygon: readonly (readonly [number, number])[]
  /** Height of the floor. The player walks on this. */
  floor: number
  /** Height of the ceiling. Must exceed `floor` for the sector to be enterable. */
  ceiling: number
  /** Brightness before distance is taken into account, 0 to 1. */
  light: number
  /** Surface identifiers, resolved to glyphs and colour by the renderer. */
  floorMaterial?: string
  ceilingMaterial?: string
  /** Damage dealt to whoever stands in it, per bite. Zero is safe ground. */
  hurt?: number
  /**
   * The original's own sector special, for the things this engine reads later.
   *
   * Carried raw rather than interpreted, like every other number out of a file.
   * Three hundred and twenty-five sectors across the two files are marked
   * secret -- special 9, on sixty-six of the sixty-eight maps -- and the
   * importer was reading this word to find damaging floors and then dropping
   * it, so nothing downstream could tell a secret room from any other.
   */
  special?: number
  /** A name for switches and triggers to refer to. */
  tag?: string
}

export interface Sector {
  /**
   * The outline as authored. Kept for reference; nothing reads it to decide
   * anything, and a level built from a file rather than from source may leave
   * it empty.
   */
  readonly polygon: readonly (readonly [number, number])[]
  /**
   * The sector's boundary, as unordered segments.
   *
   * What "inside" is actually decided by. A crossing count does not care which
   * segment belongs to which loop, so this can describe a room with a pillar in
   * it -- several closed rings -- where an ordered outline can only describe
   * one. Rooms of that shape are a fifth to a quarter of the sectors in a real
   * Doom map, so the distinction is not hypothetical.
   */
  readonly edges: readonly (readonly [number, number, number, number])[]
  floor: number
  ceiling: number
  light: number
  readonly floorMaterial: string
  readonly ceilingMaterial: string
  /** Damage per bite for standing here; zero for ordinary ground. */
  readonly hurt: number
  /** What the file called this sector, or zero for a plain room. */
  readonly special: number
  /**
   * Whether the ceiling is open air rather than a surface.
   *
   * Outdoor rooms in the original are sectors like any other, with a ceiling
   * height that exists only to bound the walls -- the flat above them is a
   * marker meaning "do not draw this". Left as a flag rather than a material
   * because the renderer's answer is to paint nothing at all, and a material
   * that is never looked up is a name waiting to be looked up by mistake.
   */
  readonly sky: boolean
  readonly tag: string | null
  /** Axis-aligned bounds, so point tests can reject most sectors immediately. */
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * One edge of the map.
 *
 * `back` is null for a solid wall and otherwise names the sector on the other
 * side. A two-sided line is not automatically passable: a closed door is a
 * portal whose far ceiling has been driven down to its floor, and the renderer
 * and the collision code both work that out from the heights rather than from
 * a flag, which is why a door opening needs no special case anywhere.
 */
export interface Line {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly front: number
  readonly back: number | null
  readonly material: string
  /** Blocks movement even where the heights would allow it. */
  readonly blocking: boolean
}

export interface Level {
  readonly sectors: Sector[]
  readonly lines: Line[]
}

/** Where a ray crossed a line. */
export interface RayHit {
  /** Distance along the ray direction, which the caller supplies normalized. */
  readonly t: number
  readonly line: Line
  /** How far along the line the crossing sits, 0 at `a` and 1 at `b`. */
  readonly along: number
}

/*
 * There is deliberately no "which side did the ray enter from" here. `front`
 * and `back` record nothing but which sector claimed the edge first, so a
 * field naming a side would be describing authoring order rather than
 * geometry. Walking through the map uses `acrossFrom`, which asks the question
 * that does have an answer: given the sector I am in, which one is opposite.
 */

const EDGE_EPSILON = 1e-6

/** Two endpoints in either order name the same edge. */
function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  const a = `${ax.toFixed(4)},${ay.toFixed(4)}`
  const b = `${bx.toFixed(4)},${by.toFixed(4)}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Turns sector outlines into sectors and lines, pairing up shared edges.
 *
 * Throws rather than guessing when three sectors claim one edge: the map is
 * wrong, and a renderer that quietly picks two of them draws a room that does
 * not match the one you walk through.
 */
export function buildLevel(defs: readonly SectorDef[]): Level {
  const sectors: Sector[] = defs.map((def) => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of def.polygon) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    return {
      polygon: def.polygon,
      edges: def.polygon.map((point, i) => {
        const next = def.polygon[(i + 1) % def.polygon.length]!
        return [point[0], point[1], next[0], next[1]] as const
      }),
      floor: def.floor,
      ceiling: def.ceiling,
      light: def.light,
      floorMaterial: def.floorMaterial ?? 'floor',
      ceilingMaterial: def.ceilingMaterial ?? 'ceiling',
      hurt: def.hurt ?? 0,
      // Written levels have no file behind them, so nothing called them anything.
      special: def.special ?? 0,
      // Levels written here are all indoors. Nothing authored needs this yet,
      // and a map that arrives as data sets it for itself.
      sky: false,
      tag: def.tag ?? null,
      minX,
      minY,
      maxX,
      maxY,
    }
  })

  interface Pending {
    ax: number
    ay: number
    bx: number
    by: number
    sectors: number[]
  }
  const byEdge = new Map<string, Pending>()

  defs.forEach((def, index) => {
    const n = def.polygon.length
    for (let i = 0; i < n; i++) {
      const [ax, ay] = def.polygon[i]!
      const [bx, by] = def.polygon[(i + 1) % n]!
      if (Math.hypot(bx - ax, by - ay) < EDGE_EPSILON) continue
      const key = edgeKey(ax, ay, bx, by)
      const found = byEdge.get(key)
      if (found) found.sectors.push(index)
      else byEdge.set(key, { ax, ay, bx, by, sectors: [index] })
    }
  })

  const lines: Line[] = []
  for (const [key, pending] of byEdge) {
    if (pending.sectors.length > 2) {
      throw new Error(`edge ${key} is claimed by ${pending.sectors.length} sectors; a map edge has at most two sides`)
    }
    lines.push({
      ax: pending.ax,
      ay: pending.ay,
      bx: pending.bx,
      by: pending.by,
      front: pending.sectors[0]!,
      back: pending.sectors[1] ?? null,
      material: 'wall',
      blocking: false,
    })
  }

  return { sectors, lines }
}

/** Whether a map point lies inside a sector's outline. */
/** Reused so that facing a wall every frame does not allocate. */
const facingHits: RayHit[] = []

/**
 * The line a body is looking straight at, within arm's reach.
 *
 * `moverInFront` answers a related but different question -- which *room* lies
 * across the line you are facing -- and that is no use for a piece of wall with
 * nothing behind it. A switch is one of those: you press the wall itself. On
 * the maps this was written for, thirty-two of the thirty-five lines that end a
 * level by being pressed have no room behind them at all.
 */
export function lineInFront(
  level: Level,
  x: number,
  y: number,
  angle: number,
  reach = 1.8,
): Line | null {
  castRay(level, x, y, Math.cos(angle), Math.sin(angle), reach, facingHits)
  return facingHits[0]?.line ?? null
}

export function insideSector(sector: Sector, x: number, y: number): boolean {
  if (x < sector.minX || x > sector.maxX || y < sector.minY || y > sector.maxY) return false
  // Crossing count along +x. Points exactly on an edge are not worth special
  // handling: the player has a radius and never stands on a mathematical line.
  //
  // Over the edges rather than an ordered outline, which is what lets a room
  // with a pillar in it answer correctly: the count runs over every ring the
  // sector has, so standing where the pillar is comes out even, and even is
  // outside.
  let inside = false
  for (const [ax, ay, bx, by] of sector.edges) {
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

/** The sector containing a map point, or -1 where the point is outside the map. */
export function sectorAt(level: Level, x: number, y: number): number {
  for (let i = 0; i < level.sectors.length; i++) {
    if (insideSector(level.sectors[i]!, x, y)) return i
  }
  return -1
}

/**
 * Every line the ray crosses, nearest first.
 *
 * The direction has to be normalized, because `t` is used as a distance
 * everywhere downstream — for the wall's height on screen, for the light that
 * reaches it, and for deciding what is in front of what.
 *
 * Crossings behind the ray's origin are dropped, and so are ones exactly at
 * it: a ray that starts on a line it is leaving would otherwise find that line
 * at zero distance and walk straight back into the sector it came from.
 */
export function castRay(
  level: Level,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDistance = Infinity,
  out: RayHit[] = [],
): RayHit[] {
  out.length = 0
  for (const line of level.lines) {
    const ex = line.bx - line.ax
    const ey = line.by - line.ay
    // Ray/segment intersection by the 2D cross product. A zero denominator is
    // a ray parallel to the line, which contributes nothing to see.
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-12) continue

    const rx = line.ax - ox
    const ry = line.ay - oy
    const t = (rx * ey - ry * ex) / denom
    if (t <= 1e-6 || t > maxDistance) continue

    const along = (rx * dy - ry * dx) / denom
    if (along < 0 || along > 1) continue

    out.push({ t, line, along })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/**
 * Whether one point in the world can see another.
 *
 * Walks the same crossings a rendered column walks, and stops for the same
 * reasons: a solid wall, or a portal whose opening the sight line misses. The
 * opening is the gap between the higher of the two floors and the lower of the
 * two ceilings, so a shut door blocks sight without being flagged as anything
 * — its ceiling has come down to its floor and there is no gap left. A low
 * parapet blocks a crouching shot and not a standing one, for the same reason
 * and with the same arithmetic.
 *
 * Movement blocking is deliberately ignored. A rail you cannot walk through is
 * still something you can see and shoot over, and conflating the two is how a
 * creature ends up firing at a wall because it believes it has a clear line.
 *
 * `fromSector` must be the sector containing the first point. The caller
 * usually has it already — a creature knows where it stands — and looking it
 * up here would put a scan over every sector inside a call that AI makes many
 * times a frame.
 */
/**
 * The gap a two-sided line leaves: from the higher of the two floors to the
 * lower of the two ceilings.
 *
 * Named once because three separate things ask it — whether a body fits
 * through, whether a sight line passes, and whether a shot carries — and a rule
 * written down three times is a rule that will disagree with itself. It is also
 * the whole reason a shut door needs no flag: its ceiling has come down to its
 * floor, the gap is nothing, and every one of those three answers turns out
 * right without knowing what a door is.
 */
export function openingBetween(
  level: Level,
  nearSector: number,
  farSector: number,
): { bottom: number; top: number } | null {
  const near = level.sectors[nearSector]
  const far = level.sectors[farSector]
  if (!near || !far) return null
  return {
    bottom: Math.max(near.floor, far.floor),
    top: Math.min(near.ceiling, far.ceiling),
  }
}

export function lineOfSight(
  level: Level,
  fromSector: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  hits: RayHit[] = [],
): boolean {
  if (fromSector < 0) return false
  const dx = bx - ax
  const dy = by - ay
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-9) return true

  castRay(level, ax, ay, dx / distance, dy / distance, distance, hits)

  let current = fromSector
  for (const hit of hits) {
    const next = acrossFrom(hit.line, current)
    if (next < 0) return false
    const opening = openingBetween(level, current, next)
    if (!opening) return false

    // Height of the sight line where it crosses, by similar triangles on the
    // map-plane distance travelled so far.
    const z = az + (bz - az) * (hit.t / distance)
    if (z <= opening.bottom || z >= opening.top) return false

    current = next
  }
  return true
}

/** The sector on the other side of a line from `from`, or -1 at a solid wall. */
export function acrossFrom(line: Line, from: number): number {
  if (line.back === null) return -1
  if (line.front === from) return line.back
  if (line.back === from) return line.front
  // The ray left a sector through a line that does not belong to it, which
  // means the crossing sequence has gone wrong rather than the map.
  return -1
}
