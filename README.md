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
one that throws bolts instead of closing the distance, nine weapons on the
original's seven slots drawing on four shared reserves, doors and lifts,
teleports, supplies you walk over, six powerups that run on clocks, furnished
rooms you can walk into the furniture of, crushing ceilings, staircases that
build themselves, keys and the doors that ask for them, a status bar laid out
the way the original's is, and an exit that ends a level, tallies what you did
and hands you to the next one.

The sky is painted. It was left as cleared pixels for most of this project's
life, on the reasoning that a sky is not a surface and the rows it owns are
owned either way. The second half of that is load-bearing — everything nearer
still has to clip against those rows — and the first half cost a fifth of the
picture on a map with a courtyard in it: standing in a sky sector on MAP02 and
looking one way left twenty per cent of the frame blank, and on E1M1 eleven.
It is drawn flat now, in a family of its own, with no depth written, which is
how the half that matters survives: a sky is infinitely far, so everything drawn
afterwards is in front of it. The same four views come back at two and three per
cent, and what is left there is where a ray leaves the map altogether, which is
a different thing and still nothing.

That fix needed the floor's brightest step. Thirteen families of glyphs had used
up every character that reads as "almost nothing", and a sky has to be drawn in
one of them — it is a flat band with no shading, so it needs exactly one glyph
and that glyph has to look like air. The floor can spare its brightest: that step
is reached only within a stride of the camera, where the floor is also the thing
you are least looking at.

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

Finishing a level shows the tally and then waits, which is what the original's
intermission does. It used to wait for a clock instead — three and a half
seconds and then the next level whether you had read the counts or not — and on
a map with nothing after it, which is every one of the sixty-eight that ship, it
waited for nothing at all: the result sat on the screen and the only thing left
to do was reload the page. A press goes to the next level where there is one and
back to the title where there is not, and the screen says which of those it is
about to do. `Esc` does the same thing mid-level, which is the other half of
what the original's menu key is for.

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

## The bar at the foot

The status bar is laid out the way the original's is: the ammunition, then the
health, then the arms you are holding, then the armour, the keys, and the four
reserves against what you can carry. Six rows of characters, which is an eighth
of a desk's screen against the sixth the original spends — the shape is the
original's for the original's reason rather than by coincidence.

It is built out of characters rather than converted from the picture, and that
is a decision the pictures forced. `STBAR` is 320 by 32 pixels of metal texture
with every number composited onto it at runtime; averaged down to rows of
characters it is a stripe of `=` and `%` with nothing legible on it — a
photograph of an interface, which is worse than an interface.

The face is on it, and it took three goes to become one. It was measured as
illegible twice — first by reading the baked rows as text, which throws away the
colour a cell at a time that carries most of a baked picture, and then properly,
on screen and in colour, at the five rows a six-row bar can give it. A warm blob
both times.

What was wrong was the size, and the number is measurable. An eye in the
original's face is four pixels across; a cell at five rows covers three and a
half, so the eye is averaged into the cheek beside it. Baked at five, eight, ten
and thirteen rows and looked at: a blob, a rounder blob, the structure present
and reading flat, and then — at thirteen — two eyes with a nose between them and
a mouth under it.

Thirteen rows will not fit in a six-row bar, and growing the bar to hold them
costs a sixth of the screen, almost all of it spent on rows the writing leaves
empty. So the face keeps the bar's floor and stands up out of it, which costs
about a twentieth. It is on the left rather than in the middle, where the
original puts it, for a reason the original does not have: its weapon is drawn
above its bar and this one is drawn in the view, so a face in the middle is a
face with a shotgun through it. That is what it looked like.

A status readout standing over the picture is not the same as the file picker
that used to: one is the game's own display — the original's fullscreen HUD
draws over the view too — and the other was a browser control.

The size bought a second thing nobody was looking for. Five health bands, the
dead face, and the one for nothing being able to touch you: at five rows those
five bands came out as four pictures, because the original separates its
healthiest two by an eyebrow and there is no eyebrow in five rows. At thirteen
there is. The check said four and now says five, both times because that is what
the pictures were.

What is taken instead is everything that is lettering. The arms display is the
original's two rows of slot numbers, a digit for a slot you have something in
and a dash for one you do not, which is how a single colour says what the
original says with two. Slot one is left out for the reason the original leaves
it out: you always have a fist. The keys stack three deep. The reserves are
shown against their ceilings, because the number alone does not say whether a
box of shells is worth walking to — and the ceiling moves when the pack is
found.

A narrow grid drops panels from the lowest priority up, so a phone loses the
powerup clock first, then the reserves, and keeps what the original would.
Below seventy-two columns there is no bar at all and a single line takes over,
which says more in one row than a cramped bar says in six.

The level's name is not on the bar. The original does not put it there — it is
on the automap — and the panel it had been using is the one the arms display
needed.

Nothing floats over the picture. Opening a file of your own was a button in a
corner of the view for a long time, and it spent that time being moved around
looking for a corner nothing needed: out of the legend because the legend is
hidden for touch, then above the stick where no thumb goes during a fight. The
answer was that a game does not put a file picker on top of itself. It is a line
on the title now, where choosing what to play already lives, and a check asks the
general form of the question rather than the old specific one — is anything
fixed sitting over the grid.

## Controls

| | |
| --- | --- |
| `W` `A` `S` `D` | move and strafe |
| `←` `→` | turn |
| `↑` `↓` | look up and down |
| `Shift` | run |
| `Space` | fire |
| `1`…`7` | the original's seven slots — `1` twice goes fist to saw, `3` twice goes scattergun to twinbore |
| `E` | open what you are facing |
| `Tab` | the automap |
| `Esc` | leave the level and go back to the title |

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
`scripts/bakeart.ts`, and the result is committed as source: the converter
reads a file once, at a desk, and what ships is characters rather than
pictures. The notice the licence asks to travel with the work is in
`docs/freedoom/`, with the contributors it names.

One consequence of shipping maps rather than files is worth stating, because
it quietly undid something else. A map here is cut down to the five lumps the
geometry needs, so it carries no pictures -- and the importer prefers the
pictures in the file it was handed. For every one of the sixty-eight that
meant there were none to prefer, and all nine thousand bodies fell back to the
art of whichever of four kinds they had been filed under: a cacodemon came at
you looking like an imp, a cyberdemon like a dog. The pictures for all
seventeen had been baked into the page months earlier and nothing named them.

They are named now. Each creature type has the picture that was baked for it,
fitted the same way a file's own picture would be -- standing to its height,
fallen to the standing width. Four have no fallen frame and keep the corpse of
the kind they are filed under, which is not an oversight: the baker only keeps
a death frame that lies down, and a skull bursts rather than falls while a
spider's last frame is as tall as its first.

The same had happened to the supplies, and more thoroughly. Every health
pickup was drawn as the kit, every key as one token whatever colour it opened,
both armours with the key's picture, and a shotgun on the floor as a box of
rounds -- while the real picture of each sat baked and unnamed. Thirty-three of
them. A check holds the two lists together now: nothing may be baked that the
game never names, which is the rule the weapons had all along in a comment and
nowhere else.

The maps ship too, and they ship as maps. That sentence used to say no WAD was
redistributed, and it is worth saying plainly that this is no longer true:
`scripts/bakemaps.ts` cuts each of the sixty-eight down to the five lumps this
engine reads and writes it out as a small WAD of its own, and those are in
`web/public/maps/`. The licence allows it and the notice travels with them; the
reason for saying so here is that a file which quietly stops being accurate is
worse than one that never claimed anything.

They are cut down rather than copied. A real map file is mostly a BSP tree, a
visibility matrix and a collision grid -- SEGS, SSECTORS, NODES, REJECT,
BLOCKMAP -- and this renderer has none of those ideas in it, so nine tenths of
the weight goes. What is left is where the walls are, what is on them, how the
rooms are lit and what is standing in them.

And they stay as WADs rather than becoming some format of this project's own,
which was the whole design decision. A format of mine would need a second
importer beside the one that already reads files people open, and two
importers for one job is how the two of them drift apart -- so the maps that
ship and the maps you open go through exactly the same code and are held to
exactly the same checks.

That costs something and it is worth saying which: the page was seventeen
kilobytes gzipped and is about seventy-eight now. Thirty-one of that is the art
itself; the first figure written here was thirty-one, which was the generated
file measured on its own rather than the page it ends up inside. The rest of
the climb is rules rather than pictures -- the WAD importer, saving, the typed
words and demos -- and the number is restated here whenever it moves, because
this file keeps using it to argue that something was worth its weight.

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

Weapons arrive as the rounds they carry, and nothing is folded any more. This
paragraph spent three rounds explaining what was being thrown away: the two
shotguns were both the scattergun, the chaingun and the plasma rifle and the BFG
were all the sidearm, and the chainsaw was left where it stood because there was
nothing here to swing. All nine are here.

| slot | | |
| --- | --- | --- |
| 1 | fists, chainsaw | free, at arm's length |
| 2 | sidearm | bullets |
| 3 | scattergun, twinbore | shells |
| 4 | autogun | bullets |
| 5 | launcher | rockets |
| 6 | arc rifle | cells |
| 7 | cannon | cells |

The reserves are four rather than one per weapon, which they had to become. Two
guns now draw on the same shells and two more on the same cells, and that is the
whole of what makes a second shotgun worth finding: it is a better way to spend
what you are carrying rather than a second pile of it. The ceilings are the
original's — two hundred, fifty, fifty, three hundred — which the pack doubles,
and which is what makes a cannon shot cost something at forty a pull.

The two free weapons reach about as far as a creature's claws do — the same
distance beyond your own edge that they reach beyond theirs, measured off the
widest reach in the game rather than chosen. The fists are the thing you still
have when the reserves are gone; the saw does more damage a second than anything
else here and only against what it is touching, which makes it the answer to a
corridor and the wrong answer to a room.

The keyboard moved to the original's seven slots at the same time. It had been
asking for weapons by position in the weapon list, which worked while that list
was also the order you would want to press them in. It is not: the list is
append-only, because everything from a save on disk to a map's shotgun indexes
it, so the fist ended up fourth. A slot is what a key means.

What you start holding is the one place this does not follow the original, and
the reason is content rather than principle. The original starts you with a
pistol and finds you everything else; the two levels written for this project
supply ammunition and no guns, so arriving with only a sidearm would mean
crossing them with shells you cannot spend. You keep the three that were always
there, and the four new ones are found — which is what makes an arms display
worth having.

The powerups grant, and did not for a round. Two hundred and fifty-six of them
stand across these maps, and for a while they were drawn and inert — the
pictures were baked, the things were placed, and walking into one did nothing
at all. All six now run on clocks rather than flags, because what is interesting
about a shield is that it runs out while you are still in the room you took it
into.

| | | |
| --- | --- | --- |
| shield | 30s | nothing can touch you, the floor included |
| suit | 60s | the channel underfoot cannot burn you |
| blur | 60s | creatures with guns fire wide; anything close enough to bite still bites |
| goggles | 120s | a dark room is lit as brightly as a lit one, and its far end is still its far end |
| berserk | the level | your fists land ten times as hard, and you are filled up on the spot |
| chart | the level | the whole map at once |

Two of those do not run out, and they say so with an infinite clock rather than
a flag of their own: one field counts down and one rule reads it, so "lasts
thirty seconds" and "lasts the level" are a number in a table rather than a
second code path. The only place that has to know is the save, because
`JSON.stringify(Infinity)` is the string `null` and would come back as zero.

The goggles are the one that is deliberately not the original's. Theirs are flat
full brightness everywhere, which on a character grid takes away the only depth
cue there is — a corridor with no falloff reads as a wall of glyphs rather than
as somewhere you can see. So the floor goes *under* the sector's light and the
distance falloff stays on top of it: a dark room becomes a lit room, and it is
still a room.

The pack doubles what you can carry and comes with a clip of each. A multiplier
on the carrier rather than a bigger ceiling on the weapon, read through one
function, because the ceiling was consulted in four places and the pack would
have worked in whichever of them got edited. Powerups end at the exit the way
the original's do; the pack does not, because a bag is not an effect.

One of the six had never been drawable. Of the eight supply pictures the baker
takes out of a WAD, `SUIT` had simply never been in the list — so the radiation
suit, the one item you most need to recognise from across a room, could not even
be the thing that grants nothing. It is in the list now, along with the held
frames for the fist and the saw, and the rest of the baked art came back byte
for byte identical, which is what says the bake was rerun against the same
Freedoom it was written from.

The rooms are furnished. Three thousand nine hundred things across these
sixty-eight maps are lamps, pillars, trees, torches, stalagmites, corpses and
bodies hanging from ceilings, and for most of this project's life the importer
had no answer for any of them — so a room the map had filled came out bare, and
the emptiest maps in the game were the ones that had been decorated most.

Which number is which picture, whether you can walk through it and whether it
hangs are read out of the original's own table rather than recalled: the editor
number, the spawn state's sprite, `MF_SOLID` and `MF_SPAWNCEILING`. That is the
one thing about the furniture that is not a judgement.

The sizes are a judgement, and worth being plain about. Every picture in this
project was given its height by eye, and those choices amount to anywhere
between twenty-two and seventy-six pixels of artwork per metre of world — a
factor of three, measured across the thirty-one supplies. There is no existing
scale to match, so the furniture is sized by one rule at the median of it. That
makes it right about itself even where it is not right about a trooper: a candle
comes out at knee height, a floor lamp at chest height, a tree at three metres,
and the corpses land within a hand's breadth of the heights the creatures they
are corpses of were given — which is the closest thing to a confirmation
available.

Five of the corpses cost nothing at all. A dead trooper is the trooper's own
fallen frame, which has been baked since creatures arrived, laid down to the
width it stood at for the reason the importer lays the others down that way.

Solid furniture stops you, which meant teaching bodies to be pushed out of
things and not only out of walls. It is the narrow version of that: creatures
still walk through you and you through them, because what a creature does when
it reaches you is a question about combat rather than about geometry. A pillar
has never moved, so pushing out of one is well defined. How far out is taken from
how wide the picture is drawn rather than from the original's collision box —
that box is sixteen or twenty map units whatever the thing looks like, and those
units are not this game's.

Everything a map file describes is read now, with one exception that is named
rather than hidden. Two measurements say so, and both can be taken because the
sixty-eight maps are in this repository:

| | before | after |
| --- | --- | --- |
| things a map places that nothing answered for | 4,157 of 26,739 | **0** |
| lines carrying a special that nothing read | 1,490 of 6,185 | **648, all one kind** |

That one kind is 48, which scrolls a wall's texture sideways. There is no texel
here to scroll — a surface carries a material and a material picks a family of
glyphs — so it is not a gap to be closed but a thing this renderer has no
equivalent of. It is named in a check so that nobody deletes the exemption
wondering what it was for.

Four kinds of machine came in with the rest of the lines. A crusher is the same
mover as a door with two differences, and working out which two took a wrong
turn worth recording: a body in the way is noticed only on the stroke the code
calls closing, so a crusher's resting end is its *open* and its working end its
*shut* — exactly inverted from a door. Modelled the other way round first, which
built a room that loaded already crushed. A staircase is a chain rather than a
room, followed from each room to the one next door that shares its floor
material; without that test the flood reaches every room in the map and raises
all of them. A light line moves nothing and is worth reading because two of the
three turn one *on*. And the monster-only teleports — three hundred and
seventy-three lines across forty-two maps — exist so that a closet of monsters
can empty into the room you are standing in; unread, those monsters spend the
level in a cupboard.

Six locked switches came back in the same round, and how is the interesting
part. They had been tried and removed with the reasoning written down: every key
colour had been guessed for the two commonest against all sixty-eight maps, nine
combinations, and none of them beat leaving them out. The door textures
contradicted each other. What was missing was not a tenth guess — it was the
original's own dispatcher, which names all six. The contradiction was that a
door texture is decoration, and a mapper is free to hang a plain wall on a
locked door.

The last map's machinery is in too, which is nineteen things across three maps
and the smallest count in the importer. Something you cannot reach throws
creatures at ten marked spots, and the way out opens when every shootable thing
in the room is dead — except on the very last map, which gives no room the tag
the original opens, because there is nowhere left to walk to. Two endings, and
which one a map gets is the map's own doing rather than a rule written here.

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

Putting it there caught something older. Three separate browser checks had been
tapping the key that selects a weapon, and a tap does nothing: this game reads
which keys are held once a frame, so the keyup arrives in the same instant as
the keydown and falls between two samples. The one that mattered was the check
for a rocket fired at your own feet. It had been selecting nothing, firing the
sidearm at a wall, and passing -- because walking into the first room of the
outpost costs seven health to something else entirely. It was measuring the
wrong weapon and the wrong injury at once, and reporting that the blast worked.
Held properly, the same shot costs fifty-seven. The check asserts which weapon
is in hand now, and the whole file shares one helper that holds a key rather
than taps it.

There is a weapon in your hands. It is the one thing on screen in every frame of
the original and it was the last piece of that missing here: fourteen rows of
the fifty a desk draws, which is about the third the original gives it, and the
same fourteen on a phone -- where the grid is seventy-seven rows, so it takes
proportionally less of them. The gun is furniture; the room is the thing being
looked at.

It moves when it fires, and the timer it moves on is not the muzzle flash. That
flash lasts sixty milliseconds, which is four frames -- right for a light and
far too short for a gun to visibly recoil. What the weapon is actually doing is
reloading: 0.28 seconds for the sidearm, 0.85 for the scattergun, 1.2 for the
launcher, and the first third of that reads as recoil at all three speeds.

Six frames cost three kilobytes gzipped, which is what settled the size: at that
price there was no reason to drop the firing frames or shave the height. The
chaingun, plasma rifle and BFG are in the file and are not baked -- there is
nothing here to fire them with, and a picture of a gun you cannot use is weight.

Two more floor switches arrive, and they needed a fourth kind of target. 18 and
20 raise the room they name to the *next* floor above it rather than to the
highest one around -- send them to the highest and a staircase built out of
three switches becomes one jump. Every one of their thirty-nine lines across the
two files carries a switch plate, which is how the file says "you press this"
rather than "you walk through it"; thirty-six of 18's forty-three rooms and all
twenty-one of 20's have a step above them to stop at, and the seven that do not
are refused like every other machine here that would not move. Between them they
take the tagged machines from twelve hundred and eighteen to twelve hundred and
sixty-three, across sixty-six of the sixty-eight maps.

The check for the whole table failed the first time this went in, and the
fixture was at fault rather than the importer: both shapes it tried put the
named room at the top of the map, so there was no step above it and the machine
was correctly refused. There is a third shape now, a sunken room with two
neighbours above it, which is also what pins "next" against "highest" -- with
floors at four and nine above, stopping at nine fails.

The switches that want a key before they open something are still out, and they
were briefly in. Trying every colour for the two commonest of them against all
sixty-eight maps gave seven to eleven maps left with a lock no key of theirs can
open -- against six with the pair removed altogether. Nothing about adding them
was an improvement, so they came back out.

The evidence for their colours turned out thin as well. In the first file not
one of their lines carries a coloured door texture at all; in the second, 133 is
DOORBLU twenty-four times against twenty-two plain lines. And one map settles
the other on its own -- MAP21 has a single lock and a single key, and that key
is red, which the second file's DOORYEL flatly contradicts. Two readings that
disagree mean something else is going on, and guessing which is exactly how the
key colours went wrong an hour earlier.

That mistake is worth writing down. Looking for maps that cannot be
finished turned up six whose locked doors wanted a colour no key on their floor
provided, and the obvious culprit was the key table -- so I swapped two numbers
in it on the strength of "26, 27 and 28 must be the open-once twins of 32, 33
and 34, in that order". It sounded like evidence and was memory wearing its
clothes: it took the six blocked maps to eleven. Trying all six assignments
against all sixty-eight maps put the original order back, and the counting is in
a check now rather than in my head.

Six maps still want a key they do not place, five of them yellow, and chasing
that number taught me more than fixing it would have. It is not one problem.
Only two of the six carry a locked switch at all -- one 135 on E2M5, one 133 on
MAP26 -- though a note in the importer blamed all six on those for weeks. The
other four carry neither, and no unread special is common to the four except
the two that every other map carries too.

It is not the table either. Every assignment of the three colours was scored
again after the gun-triggered doors went in, on the chance that opening
thirteen maps' worth of them moved the count: this order still leaves six, and
the other five leave eleven to sixteen. Each of these maps does place keys, on
every skill. They place the wrong colours for the locks they hold.

And the number reads worse than it is, which is the part worth writing down.
Each of these maps has two to five rooms behind a locked line, out of two
hundred to seven hundred. What the count measures is "a door that never opens",
not "a map that cannot be finished" -- I had been treating the two as the same
thing while using the number to decide what to build next.

The hidden rooms are counted. Three hundred and twenty-five sectors across the
two files are marked secret -- on sixty-six of the sixty-eight maps -- and the
importer had been reading that very word to find damaging floors and then
throwing it away, so nothing downstream could tell a hidden room from any other.
A sector carries the number the file gave it now, walking into one is noticed
once and remembered by room, and the level summary grows a line for it.

Only where there were any. A level written here has nothing hidden in it, and
printing "secrets 0 / 0" would tell you that you failed at something the map
never offered; both halves of that are asserted, because a rule with only one
side tested is a rule that drifts.

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

The commonest thing this importer does not read turns out not to matter, and
it took a measurement to believe it. Six hundred and forty-eight lines across
thirty-five maps carry special 48 -- more than any other number it ignores --
and not one of them names a tag. Five hundred and sixteen have nothing behind
them at all, and their textures are ordinary walls: circuit, stone, plain. A
line that names no room and has no far side cannot move anything, so what it
marks is a property of that piece of wall rather than a machine, and a map full
of them plays through untouched.

The second commonest is 334 lines on forty-one maps, which is nearly every map
in both files, and that one I chased through four guesses before the file said
no. Every one of those lines is tagged and two-sided, four fifths of them stand
alone on their tag, and their textures are plain walls. But the rooms they name
scatter: of two hundred and twenty-eight, some can only move a ceiling, some
only a floor, and thirty-eight are already where every target this importer
knows would put them. One special does one thing, and that is not the shape of
one thing. It is written here unread rather than implemented on a hunch.

What was worth reading next was much smaller and much clearer, and it is read
now. Twenty-six lines on thirteen maps name twenty-two rooms, and eighteen of
those are shut the way a door is shut, with the ceiling resting on the floor.
The geometry was never the problem. What was missing was that a bullet stopping
on a wall was not something the level could hear.

So a machine now has three ways of being worked rather than two: a wall you
press, a line you cross, and a wall a shot lands on. The tracer already knew
which wall -- every ray crossing carries the line it crossed -- and the walk
that finds how far a bullet carries held that line in its hand and returned
only the distance. Reporting it as well is most of the feature; the rest is the
page asking, after each pull of the trigger, what its pellets landed on.

Every pellet rather than the first, because a scattergun puts several into the
same door and reopening a door that is already opening does nothing. Keys apply
exactly as they do to a switch: shooting a lock is not a way past it. Thirteen
maps get twenty-two doors out of it, which is the same twenty-two the file
promised before any of this was wired.

Two people can play, with nothing in between them. There is no server behind
this page and there is not going to be one, so the two browsers talk directly:
one presses host, copies the line that appears, and the other pastes it and
sends a line back. Three copies between two people, and the game is joined.

What keeps the two games the same game is lockstep, and the demo round had
already built all of it without meaning to. Neither side advances a tick until
it holds what both players asked for on that tick; the input is addressed a few
ticks ahead so the wait is absorbed rather than felt; and the reason any of
that produces the same world twice is the same reason a recording does -- a
fixed step, one seeded generator behind every roll, and an intent per tick. A
demo and a remote player are the same mechanism pointed in different
directions.

A tick that cannot run stops the clock rather than being skipped. Skipping is
how two games quietly stop being one, and the accumulator keeping its time
means a side that fell behind runs the ticks it owes when the other catches up.

You can shoot each other, and what it took was one list rather than a change to
what a creature is. A shot is traced against bodies, and that list used to be
the creatures -- so the only way to be hit was to be a monster, and a player put
in there becomes one to every count in the game: the tally at the end of a
level, what the creatures decide to fight, what a barrel's blast catches. So
`fire` takes a second list of things that can be hit and are not creatures,
traces both together so neither can shadow the other, and reports what it
struck instead of damaging it. Whoever passed the body in decides what a hit
means.

Nothing about damage goes over the wire, which is the part worth dwelling on.
Both sides already have both players' input and the same seed, so each works
out for itself that a pellet landed and how hard -- the same way each works out
where the other is standing. What had to follow is that both sides simulate
*both* players completely: their ammunition, the boxes they walk over, the
floor burning them, their death. Simulating only your own would have the two
sides disagree the moment somebody picked up a clip.

That makes the order the two are resolved in load-bearing, and it is the kind of
thing that would have been very hard to find later. Every roll comes out of one
generator and a shot takes one per pellet, so two sides that each resolved their
own shot first would draw different numbers from that moment on -- and the
creatures share that generator, so the monsters would walk different ways on the
two screens. "Mine then theirs" is a different order on each machine. "The
host's then the guest's" is the same one, and that is what both sides do, for
firing and for reaching a box at the same instant.

Dying in a duel stops you rather than the room. Alone, death halts the world and
a press rebuilds the level; neither can happen here, because a side that stopped
stepping would stop simulating the other player, and a level rebuilt underneath
somebody would shut every door they had opened. So the body waits out the same
pause and stands up at its own start with the kit a run begins with, and both
sides reach that on the same tick from the same clock.

Checking any of this taught me something about checking lockstep. The browser
checks waited a fixed number of milliseconds and then measured what had
happened, which works for one page and quietly stops working for two: neither
side may run a tick the other has not spoken for, so a page whose frames are
being throttled does not slow itself down, it stops both. The same check passed
on its own and failed in a full gate run with another browser open, reporting
that somebody had walked no distance at all. They had walked for the whole
second. The second just had almost no ticks in it. The checks wait on the tick
counter now, and a slow machine makes them slower rather than wrong.

Aiming one player at another turned out to have a floor for the same reason. A
frame runs as many ticks as the time it swallowed, so the smallest turn a check
can ask for is however many ticks that frame happens to do -- about a fifth of a
radian when the machine is busy. At the two and three quarter metres MAP11 puts
the two starts apart, a player is a tenth of a radian wide, which is narrower
than the aim can be adjusted, and the loop circles them for ever. Walking in to
a metre first makes them a third of a radian wide. The tolerance is computed
from the distance rather than picked, because a number picked out of the air is
a number that passes for the wrong reason.

One cheat is switched off while two of you are playing. Nothing can hurt you is
a decision about your own machine, and a player who cannot be hurt on one screen
and can be on the other is two games again. Playing alone it works as it always
did.

It is played on the maps that ship, and that follows from what the two sides
can both have. A file one of you opened is a file the other has never seen; the
campaign's own two levels are written for one person and place nowhere for a
second to stand. The sixty-eight do both -- they are already on both machines,
and every one of them carries deathmatch starts, four at the barest and 519
between them. The host sends a name and a seed, both sides fetch the same map,
and the other player appears where the file says a second player goes, which is
rooms away rather than in your doorway.

One of you stands where the map starts and the other where it says a second
player goes, and getting that wrong was the near miss of the round. Both sides
run the same code, so the first version had each of them put *themselves* at
the start and the other at the deathmatch spot -- and everything looked right.
The connection was up, the other player was drawn, walking moved them on the
far screen. Two people would have been playing two games that agreed about
everything except where anybody was.

No check I had written would have caught it, because "are you connected" and
"did they move" were both true. What catches it is asking the two sides to
agree about each other: where the host says it is standing has to be where the
guest is drawing it, and the other way round. That assertion is in the gate,
and taking the split back out makes it fire.

A run can be recorded and played back. Type idrec and the game starts writing
down what you ask for; type idplay and it does it again by itself, from the
same level and the same seed.

Almost nothing had to change for that, which was the surprise. A recording is
only a recording if the game it plays into behaves the same way twice, and this
one already did: the step is a fixed sixtieth, no rule reads a clock, and the
only things that vary are two rolls -- a shot's spread and a creature's aim.
Both already took their randomness as an argument, because checks needed to pin
them long before demos existed, so the whole of determinism was passing a
seeded generator to two calls that were being handed `Math.random` by habit.

What is stored is the intent rather than the keys. There are two devices here
and they press different things; the intent is what both turn into and what the
rules actually read, so a run recorded with thumbs plays back on a keyboard.
Identical ticks are stored once with a count, which matters more than it
sounds: input barely changes between one sixtieth and the next, and a minute of
standing still is one entry instead of three and a half thousand copies of the
same object.

Recording is on the title as well, and that is not a convenience. The words
that start a demo can only be typed and a phone has nothing to type with, so
for a while the whole feature existed only at a desk -- the same shape of fault
as the file picker that once sat behind the touch controls, where everything
worked and the device most people hold could not reach it. The cheats stay
typed, which is what the original did and what a phone can do without; a
recording is a feature rather than a cheat.

That forced a better rule for ending one. It used to end by typing the word a
second time, which a phone cannot do, so a recording now ends with its level --
finished, restarted after dying, or left for somewhere else. A demo is a run,
and a run is over when the level is.

Writing that down found a bug the moment it had a check. The seal reads which
level the recording belongs to, and it had been reading where the player is
rather than where the run began: entering a map from a file sets the campaign
index to -1 on the way in, so a run recorded in the outpost and ended that way
was sealed as level -1, and playing it back asks the campaign for a level it
refuses. A recording remembers where it started now.

And the page stopped booting entirely before any of that ran, which is the
fourth time this file has taught the same lesson. The title menu greys the line
that plays a demo back when there is none, so it reads the kept recording --
and the kept recording was declared four hundred lines below the menu that
reads it, while the menu is built as the module is still being evaluated.
"Cannot access it before initialization", and a blank page. The declaration
moved up.

The words work. Typing iddqd, idkfa, idclip or iddt does what it has always
done -- nothing can hurt you, you are handed the keys and a full kit, walls
stop mattering, the map fills in -- and none of them is a bound key: no letter
does anything on its own and a word lands on its last letter.

That shape is the whole reason they are cheap here. A cheat is a function from
a stream of letters to an effect, so the recognising is a pure module with no
page in it, and what the page contributes is one line in the key handler. The
buffer rolls rather than resetting on a wrong letter, which is the original's
behaviour and much kinder: a false start falls off the front and the word still
lands when you finish it.

The words are the original's rather than invented ones, which is a deliberate
exception to how the rest of this was built. Everything else here takes the
technique and leaves the files alone -- but a cheat whose whole point is that
you already know it is not a cheat if it is renamed. What they are called
inside is this game's own: god, kit, ghost, chart.

One rule the table has to keep, and a check enforces it: no word may end inside
another. Matching on the end of a rolling buffer means a word that finishes
inside a longer one would fire first every time somebody tried to type the
longer one, and the longer one could never be reached at all.

A run survives the tab being closed now, which it did not before: everything
you had done vanished the moment the page went away, on a game made of
sixty-eight maps' worth of levels. The save goes in the browser's own storage
and the title offers to continue.

What it writes is a level's worth of difference rather than a level. Loading
builds the room again from its definition and lays the save over the top, so
nothing written down is allowed to be a thing the old level owned -- every
creature, door, pickup and remembered wall is named by where it sits in the
list the definition produced. A save that had kept the objects themselves would
come back holding a map of a place that no longer exists, which is the sort of
fault that looks fine until somebody opens the automap.

Naming things by position makes the position an assumption, so it is checked
rather than trusted: a save is refused outright if the level it is handed has a
different number of creatures, doors or pickups than the one it was taken from.
Half-applying it would hand one creature another's health and leave no sign.

When it writes is its own small decision. The original saved when a person
asked it to, on a screen this game does not have room for, so this one saves by
itself: entering a level, leaving the title, every few seconds of play, and the
moment the page is hidden. The last of those is the one that matters on a
phone, where a tab is closed without warning and `beforeunload` often never
arrives. Writing costs one short string, so writing often is cheaper than
deciding when it would be safe not to.

Two things are deliberately not saved. Anything in flight is dropped -- a bolt
halfway across a room is a frame of animation rather than progress, and
restoring one means restoring who fired it, which is an index into a list of
creatures that may have died since. And a map opened from a file cannot be
saved at all: putting one back means holding its file, and the files these were
built against run to twenty-eight megabytes, which is not what browser storage
is for. The campaign saves; a file you opened is a session.

The things that fly do. Seven hundred and forty-three of the bodies a normal run
of the two files puts in front of you float in the original -- the big one that
throws, the skull that charges, the one that spawns them -- and every one of
them was standing on the floor here, which is why a cacodemon read as a man
lobbing things.

What was missing turned out not to be a third dimension. This renderer already
draws a sprite from a height and traces sight and gunfire from one, so a
creature that floats is a creature whose art, eyes and muzzle all sit higher:
one number on the kind, applied once where the body is made. Nothing rises or
falls -- it hovers, which is what they look like anyway.

Two details cost more than the idea. A low ceiling has to press them back down,
because ten of those seven hundred stand in doorways with no headroom; the rise
is clamped against the room they spawn in, and eight of them end up flat. And
the hover has to live on the body rather than only in the height it was spawned
at, because movement recomputes that height from whatever room the body ends up
in -- without it a floater rose a metre and a half and was back on the ground
two metres of walking later. That was one line, and a check caught it rather
than a screenshot.

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
