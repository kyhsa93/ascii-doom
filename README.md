# ascii-doom

A first-person shooter drawn with characters, built on
[ascii-engine](https://github.com/kyhsa93/ascii-engine).

Play it at <https://kyhsa93.github.io/ascii-doom/>.

## What this is

The rendering techniques and gameplay systems of the 1993 shooter, implemented
against a character grid: a sector-based level, a column renderer for walls,
horizontal spans for floors and ceilings, light that falls off with distance,
billboard sprites, hitscan and projectile weapons, doors, lifts, keys and
switches.

**All content is original.** The levels, the creatures, the weapons, the
textures and the names are written for this project. Nothing is extracted from
a commercial game, and no commercial data file is needed to play. If you want
to run genuinely Doom-compatible content one day,
[Freedoom](https://freedoom.github.io/) is the freely licensed asset set that
belongs in that slot.

## Why characters suit this

A character grid is a grid of *columns*, and the renderer this game needs is a
column renderer. Two properties of the 1993 design fall out of that:

- A wall column has one distance, so it has one shade — the whole column is a
  single colour and a run of glyphs, which is one escape sequence rather than
  one per cell.
- A floor row has one distance too, because a floor is a horizontal plane:
  `distance = k / (row − horizon)`.

So a frame is a few hundred runs rather than a few thousand cells, and the
number of rays cast per frame is the number of columns — 163 on a typical
browser grid, against the 8150 a per-cell raymarcher would need.

The engine's `resolve(ramp)` — glyph chosen from luminance, last — is already
the shape of the original's lighting: a light level scaled by distance and
quantised into a small table of shades.

## Layout

```
vendor/ascii-engine/  the renderer, as a submodule -- not modified here
src/columns/          walls, floor spans, sprites: things with a checkable answer
src/game/             levels, entities, weapons, rules: things you have to play
web/                  the page
scripts/              checks
```

The split is by *what can be falsified*, not by what might be reused. How many
rows tall a wall is at a given distance is arithmetic, and it is checked. How
long a door should take to open is not, and it is not.

## Running it

```sh
git clone --recurse-submodules https://github.com/kyhsa93/ascii-doom.git
cd ascii-doom
npm install
npm run dev
```

Already cloned without submodules? `git submodule update --init --recursive`.

- `npm run dev` — the page, with hot reload
- `npm run build` — typecheck and build into `dist/`
- `npm run viewcheck` — the built page, driven in a real browser
- `npm run check` — the renderer's checks, in Node. Arrives with the renderer;
  there is nothing to check yet.
