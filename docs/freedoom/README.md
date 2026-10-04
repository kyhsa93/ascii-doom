# Freedoom, and what of it is here

Two things in this project come from [Freedoom](https://freedoom.github.io/)
0.13.0. The character art in `src/game/freedoomart.ts` is generated from its
artwork by `scripts/bakeart.ts`, and the sixty-eight maps in
`web/public/maps/` are cut from its WADs by `scripts/bakemaps.ts`, each down to
the five lumps the geometry needs. Both are released under the three-clause
BSD licence reproduced verbatim in `web/public/COPYING.txt`, with the
contributors it refers to listed in `web/public/CREDITS.txt`. Both files are
copied from the Freedoom distribution and are not edited.

The licence asks three things of anyone redistributing this. The maps are
redistributed in binary form, so the second clause is the one that bites: the
notice and the disclaimer have to travel with the distribution itself, not
only with its source. That is why the two files sit in `web/public/` — they
are served next to the page, at `COPYING.txt` and `CREDITS.txt`, and the page
links them. `npm run check` fails if either goes missing or stops being linked.
And nothing in this project uses the Freedoom name to suggest that the
Freedoom project endorses it — it does not know this exists.

No whole Freedoom WAD is redistributed. The full files are read once, at a
desk, to generate the art and the cut-down maps; they are not committed and
not needed to play.

Nothing here is from a commercial game. Freedoom is an independent work that
happens to be compatible with one.
