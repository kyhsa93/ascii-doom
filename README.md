# ascii-doom

A first-person shooter drawn with characters, built on
[ascii-engine](https://github.com/kyhsa93/ascii-engine).

Play it at <https://kyhsa93.github.io/ascii-doom/>.

## What this is

The rendering techniques and gameplay systems of the 1993 shooter, implemented
against a character grid.

What is in it now: sector-based maps, a column renderer for walls with
horizontal spans for floors and ceilings, light that falls off with distance,
billboard creatures that wake when they see you and swing when they reach you,
one that throws bolts instead of closing the distance, two instant weapons and
one that throws, doors and lifts, teleports, supplies you walk over, keys and
the doors that ask for them, and an exit that ends a level, tallies what you
did and hands you to the next one.

There is an automap, drawn from what you have actually been able to see rather
than from the level file: the renderer marks a wall the moment a column of the
view reaches it, which costs nothing because those rays were cast to draw the
frame anyway, and means a room behind a shut door stays blank until you open
it. Walls you cannot pass and thresholds you can are drawn differently, and
boundaries between two sectors at the same height are left out — they are a
seam in how the map was authored rather than anything you could see standing
there, and drawing them turns the picture into a mesh.

Some ground is not safe to stand on. It has its own family of glyphs rather
than a tint on the floor's, so it reads as a different kind of thing rather
than as a floor lit oddly, and it takes a bite out of you on a fixed clock
rather than a trickle per second — crossing the edge of it costs nothing, and
the clock starts again each time you step in. Creatures ignore it, as they do
in the original: sludge you could herd things into would turn every hazard into
a weapon. What sits in it is always optional, and the way to an exit never
runs through it.

Running out of health ends the run rather than leaving you walking around
unarmed. Everything stops, the room you died in stays on screen behind the
panel, and firing starts that level again with the kit you began it with — the
level you died in, not the campaign. There is a moment before the trigger is
listened to, because the trigger you are holding is usually what killed you.

A bolt hits anything that is not the thing that fired it, so a shot that goes
wide lands on whatever was behind you — and whatever it lands on turns on
whoever threw it. Two creatures that have started on each other keep at it
until one of them is dead, and walking away from that is often the better move.
The grudge lapses when its object dies, and then they remember you.

## The levels

Each map is a loop rather than a corridor.

**The outpost.** The key lies in the hall, the key opens the north door, the
door leads to a chamber, the lift is the only way onto the ledge, and the ledge
opens onto the way out.

**The cistern.** A hub you keep crossing, with the way on sunk below the floor
you arrive at. The store off the hub holds what the vault asks for, and the pit
between them is deep enough to feel like a drop and shallow enough to climb
back out of.

Health and ammunition carry between them. Keys do not — each map hides the key
to its own doors, and one brought forward would open something it was never
meant to.

## What you see first

A title, because the game used to begin in the first room with no warning and
there was nowhere for it to say what it was. The logo is Freedoom's own, turned
into characters like everything else here — and it is the only piece of that
interface that survives the conversion. The title painting and the status bar
are 320 by 200 and 320 by 32 pixels of detail; averaged down to anything that
fits on a character grid they come out as a fog of colons with no shape in
them. The logo is large flat lettering, which is why it reads at eight rows and
is crisp at twelve.

Under the logo is a menu: begin, either map by name, and nothing else. It is
worked with the trigger and the stick, which is every device — a phone has no
keyboard and a desk has no thumbstick, and the one control both have is the one
that starts the game. There was a fourth entry for opening a file; the page
already shows a file picker in the corner on every screen, and a second door
into one room is a thing to explain rather than a thing to have.

So the status bar is built rather than converted. What is taken from the
original is the arrangement — health, then ammunition, then keys, then where
you are, each in its own panel with a rule between — because that is the part
you recognise across the room and the part a grid of characters can actually
draw. Below about seventy columns there is no room for four panels, and a
phone keeps the single status line instead, which drops what does not fit by
priority and says more in one row than a cramped bar says in three.

## Controls

| | |
| --- | --- |
| `W` `A` `S` `D` | move and strafe |
| `←` `→` | turn |
| `↑` `↓` | look up and down |
| `Shift` | run |
| `Space` | fire |
| `1` `2` `3` | sidearm, scattergun, launcher |
| `E` | open what you are facing |
| `Tab` | the automap |

On a touch screen the same controls appear as a stick and three buttons, and
the keyboard ones keep working if there is one attached.

| | |
| --- | --- |
| left stick | walk and strafe — pushed to its edge, run |
| right half | drag to turn and look; it keeps turning while held out |
| fire | shoot |
| use | open what you are facing |
| weapon | cycle to the next one |
| map | the automap |

There is deliberately no run button. Pushing the stick all the way is the run,
which is one gesture rather than two and leaves the other thumb for aiming.

On a touch screen the shot is aimed for you, and the mark moves onto whatever
it has hold of: the nearest creature you can actually see — not through a wall,
and inside the picture rather than off the side of it. That is not a
concession to the small screen. Turning with a thumb is a *rate* and not a
position — you hold the thumb away from where it landed and the view keeps
swinging — which is the right control for looking around a room and a hopeless
one for putting a mark three cells wide onto a creature three cells wide. A
keyboard gets no help because it does not need any, and the original aimed its
players' shots too, vertically, for exactly this reason.

The half of the screen you drag is as tall as the picture rather than a share
of the phone, so the two cannot drift apart when the controls take a different
shape lying down.

**No commercial data file is needed to play, and none is used.** The levels, the
weapons and the names are written for this project. What you are looking at is
[Freedoom](https://freedoom.github.io/) — its own artwork, under a three-clause
BSD licence, and an independent work that merely happens to be compatible with
a commercial game rather than taken from one.

The pictures are turned into characters before the game ships, by
`scripts/bakeart.ts`, and the result is committed as source. No WAD is
redistributed and none is needed: the converter reads one once, at a desk. The
notice the licence asks to travel with the work is in `docs/freedoom/`, with
the contributors it names.

That costs something and it is worth saying which: the page was seventeen
kilobytes gzipped and is about forty-nine now. Thirty-one of that is the art
itself; the first figure written here was thirty-one, which was the generated
file measured on its own rather than the page it ends up inside.

## Installing it

The page is a progressive web app: it can be installed from the browser's own
menu and then runs from the home screen with no address bar, which on a phone
is the difference between a web page and a game.

Uninstalled it still fits. The page is sized to the window you can actually see
rather than to the one the browser reports having, and on iOS Safari those are
not the same number while the address bar is up — the difference is about the
height of the strip the controls sit in, which is why it was the controls that
went missing.

**It does not work offline, and that is a deliberate trade.** There was a
service worker that precached the shell and every hashed asset, so one visit was
enough to play with the network off. It was taken out because an installed copy
was reported showing an old build, and a cache you cannot inspect from the
outside is a bad place to be wrong.

Whether it really was the worker is not settled. Simulated here — build A
installed, the server swapped to build B, reloaded — Chromium picked up the new
build immediately, so nothing this machine can run reproduces the fault. The one
place it might live is iOS in standalone, which cannot be run here at all. Given
a choice between guessing at a cache nobody can observe and not having one, the
page does not have one: every launch fetches it, which is a fraction of a second
and no offline play.

The characters are smaller on a touch screen than at a desk — eight pixels
against thirteen. That is not about fitting more text in: a phone's grid was
49 by 47 cells, which is too few to say what a creature is, and at eight it is
80 by 77. Text stays legible because a handset draws three device pixels per
CSS pixel, and the grid is then wide enough for the status bar as well.

The icons are generated rather than drawn — `npm run icon` renders them from
the game's own characters in the game's own colours. They are wider than they
are tall in character counts for the same reason the sprites are: a monospace
cell is about 0.6 as wide as it is high, so an eleven-by-eleven mark is a tall
rectangle.

## Opening a map from a WAD

There is a file picker on the page — bottom right at a desk, above the stick on
a phone. It is for playing somebody else's maps; the art needs nothing from
you, because it is already here.
Give it a WAD — [Freedoom](https://freedoom.github.io/) is the freely licensed
one — and the first map in it is drawn by this renderer, with that file's own
pictures. The page says which it did: how many things it drew from the file, or
that the file had no pictures in it.
Nothing is bundled: thirty megabytes of someone else's work has no business in
a page of fifty-eight kilobytes, and the file never leaves your machine.

An exit in the original is a line rather than a room, and there are two kinds:
one you walk across and one you press like a switch. Both come across, by two
different routes — crossing a line means arriving in the room beyond it, which
this game already notices, while a switch is the piece of wall itself, so the
page asks what you are facing instead. Thirty-two of the thirty-five switch
lines in these files have nothing behind them at all, which is why they needed
the second route rather than the first.

Sixty-five of the sixty-eight maps can be finished. The three that cannot are
the ones the original ends by killing what is standing in the room, and no line
in them says so.

The doors you open by pressing come across. In the original a door is not a
property of a room but a number on a line, and there are two families: a line
that opens the room behind it, and a line that opens every room carrying some
tag. The first is what this engine already models — it finds the sector across
the line you are facing — so those arrive, locks and all, while the tagged kind
are left alone. The height a door opens to is measured from the rooms around it
rather than chosen: across one file that gap runs from sixty map units to a
hundred and twenty-four, so any fixed number would be wrong nearly every time.

The lifts come across too, and they are the first thing here that needed a tag
at all. A manual door special carries none — that is the format's way of saying
"the room behind this line" — but every one of the seven hundred and sixty-one
lift lines in these two files carries one, and eighty-three of them name more
than one room. So a lift is a line that calls a list of platforms, and pressing
the wall the map marked is what calls them. Five hundred and sixty-five of
those lines are a switch, and five hundred and eight of those arrive as
something you can press — across sixty-two of the sixty-eight maps. The
hundred and ninety-six you trigger by walking over arrive too, now that
crossing a line is something this engine can notice. They add fewer platforms
than that sounds: the rooms they name are mostly rooms a switch already named,
so a hundred and two of the hundred and fifteen are the same floor reached the
other way, and thirteen are new.

Crossing a line is a thing that happens now, and most of what the original's
maps do hangs off it. A step is a segment — the body was here at the start of
the frame and there at the end of it — so which lines it passed through is a
segment against a segment and nothing more. What that buys immediately is
teleports, which fifty-one of the sixty-eight maps carry across eight hundred
and sixty-three lines: a line names a tag, a marker thing stands in a room
wearing it, and you arrive standing where the marker stands, facing the way it
faces. Only when crossed from the front, which is the original's rule and not a
simplification — a teleport taken from behind is how you walk off the pad you
just landed on without being sent straight back.

That rule is also what caught the fixture lying. The two-sided line the test
file is built around was wound the opposite way to every real one, so its front
sidedef sat on its left; six checks and a measurement across three real maps all
passed while the page refused to teleport anybody, because the fixture's idea of
"the front" was backwards. The check now asks the file which sector the line
calls its front and walks from there, rather than trusting arithmetic of its
own.

The walk-over exit stays as it was — the room across the line rather than the
line itself. It could be moved onto this now, and there is no reason to: an
exit fires once and arriving in the room beyond is what crossing it means, so
the two agree, and a rewrite would be motion rather than progress.

Beyond those there is a third family, and it is the one the original's level
designers lean on hardest: a line that names a room and says what should happen
to it. A switch here opens a door over there; a line you walk across drops a
floor you cannot see. Forty-eight of the sixty-eight maps carry the switch that
opens a tagged door and forty-six the one that lowers a tagged floor, which puts
them behind only plain doors and teleports. Sixty-four of the sixty-eight gain
something from this: eight hundred and seventy-two machines, worked by four
hundred and ten walls and three hundred and seventy-nine crossed lines.

None of it is new machinery. A door is a ceiling with two heights and a floor
special is a floor with two, and the loop that steps them has never asked which
it was looking at, so the work is arithmetic on the map: where a named room's
surface should end up, measured from the rooms around it the way the doors and
lifts already measure theirs. Three rules came out of counting rather than
taste. A room already standing where it would move to is refused -- thirty-three
of the doors and twenty-three of the floors -- because the mover travels toward
whatever height it is handed without asking which way that is. A door that would
open downwards is refused for the same reason. And exactly one room in the two
files is named by a floor special *and* owned by a platform; the lift keeps it,
because two machines on one floor would drag it in turn.

A platform starts raised, drops to the floor of the lowest room touching it,
rests three seconds and climbs back. None of that needed building: a door is a
ceiling with two heights and a lift is a floor with two, and the same loop has
always stepped both. Ninety-eight of the rooms those lines point at are already
at the bottom, and are refused rather than imported as floors that would rise
when called.

The supplies come across the same way the creatures do — the file says
something of a certain class lay here, and one of this project's own is put
there instead. Health, ammunition, keys, armour and weapons all arrive now;
scenery does not, and that half matters as much, because a floor lamp that
heals you is worse than a floor lamp that is missing.

The launcher throws a blast rather than a heavy dart. Most of what it does is
the explosion -- twenty on impact and up to fifty-five over four and a half
metres, falling off linearly to nothing at the edge -- and the blast does not
ask who fired it. Firing into the wall you are standing against costs about
forty-six health, which was measured by doing it. That is the whole reason a
launcher is a decision rather than a slow rifle: it is the only weapon here you
can lose to.

It stops at walls, which needed saying out loud. The check for that spent a
round being useless: the body it put behind a wall was sixteen metres from the
blast, so it was excluded for being out of range and the sight test was never
reached. Deleting the sight test changed nothing and the falsifier sat silent.
The pair it uses now is four metres apart with a wall between them, which is the
only shape that can tell "the wall stopped it" from "it was too far away".

Armour was the largest thing being thrown away: it stands on sixty-five of the
sixty-eight maps and there was nothing here to put in its place. There is now,
and it is a pool that drains rather than a percentage that lasts — the light
jacket soaks a third of each hit and the heavy one a half, losing that much of
itself as it goes, so the last point of armour cannot absorb a rocket. The
jackets set you to a number rather than stacking; the scattered bits add one at
a time up to the heavy jacket's ceiling. That difference is not pedantry: there
are seventeen hundred of those bits across the two files, and modelling them as
"set to one" made every one of them vanish on contact for anybody already
wearing more than a single point.

Weapons arrive as the rounds they carry. This game has three and the files
place seven, so they go by what they are for — the two shotguns are the
scattergun, the rapid-fire ones the sidearm, the launcher the launcher — and
since you start holding all three, what a weapon on the floor is worth is its
ammunition. The chainsaw has no answer here and is left where it stands.

A file you open still brings its own pictures, which matters for a WAD whose
art is not Freedoom's. A creature or a supply the file has a drawing for is
drawn with it: the picture is decoded out of the file's own sprite lumps,
averaged down to a grid of characters, and kept in colour a cell at a time
rather than as one tint for the whole thing — a monster in a single colour is a
silhouette. What does not change is anything you can feel. How big it is, how
hard it hits, how far it can see and what it does when it notices you are this
game's, exactly as they were; the file decides only what you are looking at.

Two rules there fell out of the files rather than being chosen. A creature
keeps its height standing and its width lying down, so it does not change size
as it falls. And the frame it falls into is found by walking the death sequence
until the height jumps back up, which is where the bursting starts: across nine
creatures the largest rise inside a death is 1.33 and the smallest jump into a
burst is 2.4, so there is a wide gap to put the line in. Two of those nine have
no frame that lies down at all — a skull bursts into something larger than it
was — and they keep the art drawn for them here.

A picture is also stretched until its own brightest part reaches the brightness
this game's own art is drawn at. Taken at face value it was four times darker
than everything standing beside it, and being dark it spent only the bottom two
glyphs of a nine-glyph ramp, so the shape washed out into colons. A grid with
nine levels cannot say both "this is dark" and "this is the shape of a face".

The creatures themselves come across after a fashion. A map says where
something stood, and one of this project's own five stands there instead. The
grouping was by weight alone until counting the two files showed what that was
costing: ten thousand of the bodies in them attack at a distance and fewer than
fifteen hundred only bite, and four thousand eight hundred of those distance
attackers carry hitscan weapons — a rifle or a shotgun that hits the instant it
is fired. Every one of them was arriving as something that runs at you and
claws, and a room of gunmen is not a kennel.

So there are two that shoot now. A rifleman fires one shot at thirty-two
metres; the heavier one fires three in a wide cone, which is why backing away
from it works and backing away from the rifleman does not. Distance does not
save you from either and geometry does — the shot is traced against the same
walls and bodies a player's shot is, so a creature standing in the way takes it
and a corner stops it. The first map of the first file holds fifty-three
creatures and twenty-five of them are armed.
Numbers this game has no answer for put nothing there at all, which is why a
map arrives without its lamps rather than with them swinging at you.

Seven more line specials joined that third family after counting what was still
being ignored: five kinds of door and two kinds of floor, all of them tagged.
Two of the five are the commonest unhandled numbers in either file -- special 2
on thirty maps and 109 on twenty-five -- and both are doors you open by walking
through the line rather than by pressing anything, which only became possible
once a crossing was something the engine could see. Together they take the
tagged machines from eight hundred and seventy-two to twelve hundred and
eighteen, the doors among them from two hundred and twenty-seven to four hundred
and fifty-eight, and the lines you work by crossing from three hundred and
seventy-nine to seven hundred and thirty-one.

Four numbers are still out, and each for a measured reason rather than an
oversight: 133 is a locked door whose fifty-three rooms are all already at their
lowest floor, so it needs the key table rather than this one; 18 and 20 raise a
floor to the *next* height above it, a fourth kind of target this does not have,
and only half their rooms even have somewhere lower to be measured against; 46
has twenty-eight of its thirty-two rooms already at the bottom, because the
missing half of it is a trigger rather than a shape. One difference is
deliberate: special 63's door shuts itself again in the original and stays open
here, which is eighty-two lines on seventeen maps and makes none of them
unplayable.

A map from a file is made of something now. Every imported wall was drawn as
one material -- one colour, one family of glyphs -- so a rusted service corridor
and a marble hall were the same room in different places, and the geometry being
right only made that stranger. The file says which is which: the first of the
two uses five hundred and sixty-four distinct wall textures and two hundred and
one floor flats.

Naming five hundred of anything is not on, and it turns out not to be necessary.
Doom's texture names are stems with numbers after them, and sixty-nine per cent
of wall surfaces and ninety-five per cent of floors fall under a couple of dozen
stems -- BROWN, METAL, STONE, SUPPORT, COMP, and so on. Matching the stem,
longest first, is the whole of it.

What decides how many materials can exist is the glyphs rather than the names.
Families may not overlap: a floor and a wall at the same distance under the same
lamp receive exactly the same light, so if they shared characters the only thing
telling them apart would be colour, and on a terminal with few colours that is
nothing at all. About twenty-nine characters read at this size, which is seven
families of four, and six were already spent. So four new wall materials and two
new flats, chosen by what the files actually use: stone, metal, rust and circuit
cover ninety-four per cent of wall surfaces alongside the original, and a stone
floor covers fifty-eight per cent on its own. Wood, bone, brick and lit panels
are one per cent each and fold into the nearest of those rather than eating a
family — asserted in the checks, so the folding is on the record instead of
looking like a missing case.

Two mistakes on the way, both mine and both caught by checks that already
existed. The first four families reached into glyphs the original six were
using, which is exactly the overlap the rule forbids; the free list is computed
now rather than remembered. And one family was written with a character twice,
which leaves a step of its ramp that no light can produce — reported several
screens away as a dead level, so there is a check for the typo itself now.

There is sound now, and it is synthesised rather than carried. That was a
measurement rather than a preference: the eighteen noises a game like this needs
are three hundred and fifty-six kilobytes inside a real file and two hundred and
forty-six gzipped, because eight-bit PCM is close to incompressible, and the
whole page is seventy-five. Carrying them would make the download four times
what the game is, to say things that are a burst of filtered noise and a falling
tone. An oscillator and a second of random numbers cost a few hundred bytes of
code instead.

That is the opposite of the decision made about the art, and the difference is
the point. A creature's shape cannot be approximated -- it is the thing itself,
and what it looks like is most of what it is. A shotgun is a transient with a
bright attack and a fast decay, and an approximation of that reads as a shotgun.
The three weapons are told apart by length and by how dark they are rather than
by pitch, which is how you tell them apart with your eyes on the room.

Nothing sounds until you press something, because every browser refuses to make
a noise before a gesture; the speaker is built on the first key or tap rather
than at boot, so the first shot is heard instead of swallowed. The title has a
line to switch it off.

Checking it needed a different shape from everything else here. A noise leaves
no mark on the screen, so the page counts what it asks for and the browser check
reads the count -- and turns the sound off and fires again, because a counter
that only rises says nothing about the switch that is supposed to stop it.

A map is built for one difficulty rather than all of them at once. Doom's five
settings are three sets of flags -- the two easy ones share a bit and the two
hard ones share another -- and the importer was reading none of them, so every
body in the file was standing there together: twelve thousand two hundred and
ninety-two across the two files, which is more than the hardest setting the
original offers. Counted per setting it is six thousand three hundred and fifty
on easy, nine thousand on normal, eleven thousand two hundred and eighty-three
on hard. The supplies barely move between them, which is the original's shape
too: what a setting changes is who is waiting for you, not what you find.

The title screen carries it as a line that cycles rather than three that sit
there, because a file's map list already fills the rows under the logo. Normal
to begin with, which is where the original starts you.

The barrels do arrive, and they are the one piece of scenery that is a body:
five hundred and ninety-seven of them across the two files, standing on
thirty-eight maps, and three hundred and thirty-three of those are within one
blast radius of another. They go through the same table the creatures do,
because a barrel is a body with health as far as the renderer, the tracer and
the mover are concerned; what makes it a barrel is that killing it sets off the
rocket's blast, and that blast can kill the next one. Nothing else was needed
for the chain.

What was needed was one place to die in. Four different things can hurt a
creature here -- a traced pellet, a creature's own gun, a projectile arriving, a
blast catching something -- and a barrel that only burst when a rocket killed it
would behave differently depending on what shot it. The counts had to learn the
difference too: a barrel is not a creature, so bursting one is not a kill and a
level summary reading "creatures 4 / 138" on a map with nine barrels in it is a
summary that lies in both halves.

What else comes across is the geometry, the lighting, the outdoor rooms — drawn as open air rather
than as a ceiling twenty metres up — and the damaging floors, which land on the
same hazard rules the maps here already use, because the original marks them
with a sector type this engine now reads. Dying in one puts you back at its
start rather than in the campaign.

Every map in it, not just the first. Opening a file puts its maps on the title
screen and you pick one -- thirty-six in one of these files, thirty-two in the
other. It used to open the first and stop, which made thirty-five of the
thirty-six unreachable: the same shape of fault as the picker that was hidden on
a phone, where everything worked and almost none of it could be got at.

A list that long does not fit. There are nineteen rows under the logo on a desk
and seventeen with the phone lying down, so the menu scrolls: it packs the lines
when the spacing will not fit, shows the part around the cursor, and marks each
end that has more behind it. The mark goes where the leading space is so the
centred line does not shift -- except on the line under the cursor, where it
goes on the tail instead, because losing the hint that the list runs on costs
less than losing the cursor.

Two things made it possible, both of them changes to the engine rather than to
the importer. A sector is defined by its boundary rather than by an ordered
outline, which is what lets a room with a pillar in it exist at all — a fifth
to a quarter of the sectors in a real map are that shape. And a WAD has no
outlines to give: it describes lines and which sector lies on each side, which
is the same thing said differently.

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
- `npm run check` — everything with a right answer, in Node: the geometry, the
  projection, both levels walked end to end, and the rules for shooting,
  carrying, finishing and dying
