# graft: the patch editor for iii scripts

Status: **design + prototype, phase 2** (November 2026). **graft** is
greenhouse's patch editor (the **graft** drawer, `js/patch.js`,
`lua/blocks*.lua`); this document is where the design lives and changes.

## Why

iii scripts are short Lua programs that react to events: a key, an encoder,
a MIDI message, a metro. Writing them is easy for programmers and a wall for
everyone else. Most scripts people want are the same few patterns wired
differently: an encoder drives a CC, a key toggles a note, an LFO moves a
parameter, a value is shown on a screen or a key's LED.

A patcher in the spirit of Max or Pure Data makes those patterns visible:
boxes for sources, processors and outputs, wires between them. greenhouse already
has what makes this pleasant: a live connection to the device, a view of the
device to play (the achene panel, the virtual grid), and an editor for when
code is the better tool. The patcher adds the missing middle.

**Goals**

- A useful script in minutes without writing Lua, played live as it's built.
- The result is an ordinary `.lua` file on the device: it runs without greenhouse,
  can be read, edited, shared and kept in a script library.
- Nothing is lost by switching to code: custom Lua lives inside the patch.
- The same patch logic works on achene, a grid, and devices to come; only the
  device's own inputs and outputs change.

**Not goals (for now)**: audio, sample-accurate timing, a full Max clone,
blocks that need more than iii offers (no file I/O, no networking).

## Model

A **patch** is a graph of **nodes** joined by **wires**. Messages are
numbers, pushed along wires when something happens (Max's event model, not
a continuously evaluated dataflow):

```
[encoder 5] --delta--> [accum 0..127] --value--> [midi cc 20]
                                        \------> [display "cutoff"]
[key 7] --press--> [toggle] --0/1--> [midi note 60]
                              \----> [key led 7]
[lfo 0.5 Hz] --0..1--> [scale 0..127] --> [midi cc 21]
```

- **Sources** start messages: device inputs (encoder delta, encoder push,
  key, grid key), MIDI in, clocks, LFOs, metros.
- **Processors** transform them: scale, accumulate, toggle, quantize, slew,
  random, counter, gate, and so on.
- **Outputs** end them: MIDI out, key LEDs, the screen, grid LEDs.

A node has numbered inputs and outputs and a few **parameters** (an encoder's
number, a CC, a range), edited in the node itself.

Time-based nodes (LFO, slew, clock) share one metro, the patch's tick, so a
patch uses one or two of iii's twelve metros whatever its size.

## On the device: a runtime and the patch as data

Two ways to turn a patch into Lua:

1. **Generate flat code**: every wire becomes a function call. Fast and
   self-contained, but large, hard to read, and hand edits can't be mapped
   back to the patch.
2. **A runtime plus data** (chosen): a library of block types
   (`lua/blocks*.lua`) and a short declaration of nodes and wires that the
   runtime builds and runs. The device gets only the parts of the library
   the patch uses (below).

The second keeps the generated file small and readable, makes custom blocks
just Lua functions registered with the runtime, and lets greenhouse update a
running patch live by sending one node or wire at a time.

### blocks.lua

```lua
B.version                -- the runtime's version; greenhouse uploads a newer one
B.type(name, def)        -- registers a block type: def.inputs, def.outputs,
                         -- def.init(node), def.input(node, i, v),
                         -- def.tick(node, dt), def.stop(node), and
                         -- def.start(node): its first value, sent once
                         -- the patch is wired (a value block's start)
B.clear()                -- stops and removes everything
B.node(id, type, params) -- adds a node (or replaces the one with that id)
B.wire(from, out, to, in)
B.unwire(from, out, to, in)
B.set(id, key, value)    -- changes a parameter of a running node
B.start()                -- installs the event handlers and the tick
B.patch{nodes = {...}, wires = {...}}  -- all of the above at once
B.out(node, i, v)        -- what a block calls to send v from output i
```

**Built for each patch** (runtime v9). The whole library held in RAM was
most of an RP2040's heap (on the XIAO, a running patch left a 2.6 KB
largest free block), so the source is in **parts**, and greenhouse joins only
the ones a patch uses. `blocks.lua` holds the core and the blocks any iii
device runs, `blocks_achene.lua` achene's (encoders, pushes, keys, key
LEDs, the screen blocks), `blocks_grid.lua` the grid's. A line
`--@part name needs a b` starts a part: one per block type (with its
helpers), plus shared ones (`scales`, `screen`, `widgets`, `grid`,
`gnotes`, `sends`); `needs` lists the earlier parts whose locals or `B`
fields it uses. `buildRuntime` (`js/patch-blocks.js`) takes the core, the
parts defining the patch's types and what those need, in file order,
**compacted** (no comments, blank lines or indentation), and ends it with
`B.build`, its fingerprint. Another device's parts are left out.

- **Run**: greenhouse puts that in `blocks_run.lua` and runs it, unless `B.build`
  says it is running already; a file of the same size (after a restart) is
  run and checked before anything is uploaded, so flash is written only
  when the set of blocks changes. Before a new one compiles, the old `B` is
  cleared and collected, so the two are never in RAM together; the tick
  metro is kept (iii has 12).
- **Live**: a block of a type the runtime running lacks (dragged in,
  pasted, a new patch opened) makes greenhouse run the patch again on a runtime
  with it, its blocks' state kept; edits to blocks of types it has go
  live as before.
- **Save and export**: the patch file carries its runtime, so it runs on
  its own on any device of its kind, with nothing else on it.

Measured on the PC (64-bit Lua, which reads higher than the device but
tracks it), a running example went from 105-128 KB to 44-87 KB. Every type
is checked alone in a test build: it compiles, uses no other part's local
as a global (a missing `needs`), and runs.

The runtime owns iii's event functions (`event_enc`, `event_key`,
`event_enc_key`, `event_grid`, `event_midi`) while a patch runs and routes
them to the source nodes that asked for them. A Lua node can still define
its own handlers for anything else.

### The patch file

```lua
-- graft patch: cutoff and a toggle
--@patch {"v":1,"nodes":[{"id":1,"type":"encoder","x":40,"y":60,
--@patch "params":{"n":5}}, ...],"wires":[[1,1,2,1], ...]}
-- the blocks runtime v9 it runs on, built by greenhouse with: core encoder accum midi_cc
if B and B.clear then B.clear() end
B = {tick_metro = B and B.tick_metro}
...                                    -- the parts, compacted
B.build = "1a2b3c4d"
B.patch{
  nodes = {
    {1, "encoder", {n = 5}},
    {2, "accum", {lo = 0, hi = 127, start = 64}},
    {3, "midi_cc", {cc = 20, ch = 1}},
  },
  wires = {{1, 1, 2, 1}, {2, 1, 3, 1}},
}
```

- The `--@patch` comment lines carry the editor's own copy (positions and
  all) as JSON, split into lines under 400 characters: iii reads at most 512
  per line, in uploads too.
- The Lua below it is what runs. Every line stays short for the same reason.

### Round trip

- greenhouse opens a `.lua` file with `--@patch` lines as a patch: **open…** in the
  drawer lists the device's scripts, and a script's file menu has **patch**.
- **Custom code** goes in a **lua** node: its code is part of the patch and
  survives the round trip.
- Editing the generated Lua by hand outside a lua node **detaches** the file:
  greenhouse notices the code no longer matches the patch (it regenerates and
  compares) and opens it as code, saying so. The patch can still be restored
  from the comment, losing the hand edits. Simple and honest; no attempt at
  parsing arbitrary Lua back into boxes.

## In greenhouse

- A **patch** drawer, like the achene and grid drawers: the canvas, a
  palette of blocks, and **run / stop / save**. Later it may become a view
  of its own next to the editor.
- **Live**: **run** starts the patch on the device, and it keeps running
  while you edit. With **live** on (the default), every change goes
  straight to it as `B.node`, `B.wire`, `B.set` lines; the device's view
  shows the result and plays it. With live off, changes wait and
  **apply (n)** sends them together (several changes to one block go as
  one), without restarting the patch. **save** writes the patch file; **run**
  on a saved file does `fs_run_file`.
- **Patch files** start with `-- graft patch:` (`-- greenhouse patch:` before the rename); the file list marks them with
  a **patch** tag, and **open…** lists only them.
- The runtime is uploaded when missing or older than the one greenhouse carries.
- **Device palettes**: the palette shows the connected device's own blocks
  (achene: encoders, pushes, keys, key LEDs, screen; grid: buttons, faders,
  keys, LEDs) next to the shared ones. greenhouse tells achene, parterre (it has
  `og_mirror`), a stock grid and other iii devices apart, with the grid's
  size. Offline, **for:** in the bar picks the device (achene, grid 16×8,
  8×8, 16×16); connected, it shows the device and is locked. The examples
  menu, the guide's sections and recipes, and the layout button (**screen**
  or **grid**) follow it. A patch's device comes from its blocks (achene or
  screen blocks: achene; grid blocks: grid; neither: any iii device), and
  opening one made for another device says so. Later: drag an encoder off
  the achene panel into the patch.
- **Library**: Drawflow (MIT, no dependencies), bundled into `vendor/` like
  the code editor, so the site keeps its no-build setup.

## Blocks

**The blocks so far** (runtime v8). Device blocks show in the palette only
for that device:

| block                                                                             | does                                                                                                                                |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| encoder _n_ (achene)                                                              | a turn's steps                                                                                                                      |
| enc push _n_ (achene)                                                             | 1 pushed, 0 released                                                                                                                |
| key _n_ (achene)                                                                  | 1 pressed, 0 released                                                                                                               |
| key led _n, colour_ (achene)                                                      | lights key n at the value's brightness (0..1)                                                                                       |
| display _label, place_ (achene)                                                   | a labelled bar on the screen, in one of eight places                                                                                |
| grid key _x, y_ (grid)                                                            | 1 pressed, 0 released                                                                                                               |
| grid led _x, y_ (grid)                                                            | lights a key at the value's level (0..1 to 0..15)                                                                                   |
| button _mode, x, y, w, h_ (grid)                                                  | momentary (1/0), toggle (flips, remembered) or trigger (1); lit while held or on; input lights it                                   |
| fader _lo, hi, start, style, direction, x, y, w, h_ (grid)                        | a row or column of keys from lo to hi; a press sends, the input moves it; remembered                                                |
| steps _steps, input 1 is, note, scale, x, y, w, h_ (grid)                         | a step grid: columns steps, rows notes of the scale; pages past the width; inputs page, length, transpose; outputs gate, note, step |
| keys _note, row, scale, send, ch, vel, x, y, w, h_ (grid)                         | an isomorphic keyboard (rows a fourth apart by default), polyphonic MIDI of its own; outputs the last note and a gate               |
| ripples _note, scale, step, echoes, speed, len, send, ch, vel, x, y, w, h_ (grid) | a press plays its note and sends a ring out; each key it grows plays an echo, higher and quieter; input 1 drops one at random       |
| lfo _rate, shape_                                                                 | 0..1, sine / triangle / saw / square, 50 times a second                                                                             |
| constant _value_                                                                  | a fixed number: sent at the start, and again on anything at its input                                                               |
| metro _ms, per beat_                                                              | a gate: 1 on each beat, 0 halfway; input 1 stops (0) and starts it, input 2 sets BPM                                                |
| clock in _div_                                                                    | MIDI clock in: a gate every _div_ clocks; output 2 is 1 on start, 0 on stop                                                         |
| midi in cc _cc, ch_                                                               | an incoming CC's value                                                                                                              |
| midi in note _ch_                                                                 | output 1 the note number, output 2 1 on / 0 off                                                                                     |
| value _lo, hi, start_                                                             | adds what comes in, clamped: encoder steps become a value; sends its start                                                          |
| scale _in lo/hi, out lo/hi_                                                       | maps a range                                                                                                                        |
| toggle                                                                            | flips 0 / 1 on each press; sends its state (0) at the start too                                                                     |
| counter _lo, hi, step_                                                            | input 1 steps (the first step is lo), input 2 resets; wraps                                                                         |
| random _lo, hi_                                                                   | a whole number in the range for each non-zero input                                                                                 |
| quantize _scale, root_                                                            | the nearest note of the scale                                                                                                       |
| slew _time_                                                                       | glides to each new value                                                                                                            |
| gate                                                                              | passes input 1 while input 2 is open (not 0)                                                                                        |
| route                                                                             | input 1 out of output 1 while input 2 is 0, out of output 2 otherwise (one control, two jobs)                                       |
| midi cc _cc, ch_                                                                  | sends the value (0..127, rounded; repeats skipped)                                                                                  |
| midi note _note, vel, ch_                                                         | input 1: note on / off; input 2 sets the note number                                                                                |
| math _op, b_                                                                      | two numbers: + − × ÷ mod min max pow > < =; input 1 computes and sends, input 2 sets b quietly                                      |
| function _fn_                                                                     | sin cos tan (radians) abs neg not sqrt exp log floor ceil round                                                                     |
| change                                                                            | passes a value only when it differs from the last                                                                                   |
| memory _start_                                                                    | input 1 stores and sends, input 2 stores quietly, input 3 recalls                                                                   |
| sample & hold                                                                     | input 1 watched quietly; a trigger on input 2 sends the value it had then                                                           |
| set var / get var _name_                                                          | a named value shared by the whole patch, without wires (Max's send/receive)                                                         |
| watch                                                                             | passes values on and shows them on the block: the latest and a graph (10 a second)                                                  |
| print _label_                                                                     | prints to greenhouse's console, at most 10 a second                                                                                       |
| lua _code_                                                                        | your code, for each message: `i`, `v`, `out(n, value)`, and `s` kept between calls                                                  |

Gates (metro, clock in) go 1 then 0, so a note retriggers and a toggle or
counter counts only the 1s. Outputs (MIDI, LEDs) send at most once a tick:
a value that comes sooner is held and the latest goes out next tick, so an
LFO can't flood MIDI and a knob still answers at once.

### The grid

The grid widgets (button, fader, steps, keys, ripples) each take a
rectangle of keys: **x, y** for its top left key and **w, h** in keys, cut
to the grid's size on the device. They draw into one picture of levels
(0–15) that goes to the grid at most once a tick, with one
`grid_refresh()`, and only when something changed; a press goes to the
widget under it. grid led blocks draw into the same picture, under the
widgets. The **grid** button (where **screen** is for achene) opens the
grid layout: the grid at the device's size (offline: the size for: picks)
with a box per grid block; drag a box to move it, drag its bottom right
corner to resize it, and a place over another block is refused. The
**mixer** example has four two-key-wide channel faders with mute toggles
and a master; **sequencer** a 16-step grid with a length fader; **keys** a
keyboard with octave and mod wheel faders; **ripples** stones, and rain
from a metro. The guide has fader, button, host-feedback, step grid and
keyboard recipes. keys and ripples play MIDI themselves (several notes at
once; the midi note block is one note at a time), with send: outputs only
to leave it to the wiring; ripples fold their notes into four octaves.

### The screen

achene's screen is the centre of the patch: the **screen** blocks share a
grid that matches the panel. Its four columns of 32 px sit under E1–E4 and
over K1–K4, and its rows are **top** (9 px: what the encoders above do),
**middle** (44 px, or its **middle top** and **middle bottom** halves) and
**bottom** (9 px: what the keys below do). Each block takes a row, a
column and a width in columns:

```text
 ┌ E1 ──┬ E2 ──┬ E3 ──┬ E4 ──┐   top
 │ note │cutoff│   achene    │
 ├──────┴──────┴──────┴──────┤
 │ ■  ■  □  ■  □  ■  □  ■    │   middle top: steps
 ├──────┬──────┬─────────────┤
 │  ▮   │  ◔   │  ∿ lfo      │   middle bottom: slider, knob, graph
 ├──────┼──────┼──────┬──────┤
 │ run  │      │      │      │   bottom
 └ K1 ──┴ K2 ──┴ K3 ──┴ K4 ──┘
```

| block                                         | draws                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| enc label _label, lo, hi_ (top)               | a name with its value as a line under it; turning shows the number a moment |
| key label _label_ (bottom)                    | a name, inverted while its input is not 0 (a key, a toggle)                 |
| slider _label, lo, hi_                        | a vertical bar with its value over it and name under it                     |
| knob _label, lo, hi_                          | an arc with the value inside and the name under it                          |
| number _label_                                | a name and its value as text                                                |
| graph _label, lo, hi_                         | the last values as a line scrolling from the right (25 a second)            |
| steps _steps, input 1 is, note, lo, hi, keys_ | a step sequencer of up to 64 steps with a note each, as bars (below)        |
| text _text_                                   | fixed words                                                                 |

**steps** is a sequencer in one block, up to 64 steps, each on or off with
its own note, drawn as bars as tall as their notes (within lo..hi). Input 1
is the playing step (from a counter), or, with **input 1 is** set to beat, a
beat (a metro, clock in) that moves to the next step and wraps at the
length, so no counter is needed: it sends the step's note (output 2) and,
when the step is on, a gate (output 1: 1, then 0 at the next step); the note
goes first so a midi note block plays it. Output 3 is the step number. Its
**keys** (K1–K4, K5–K8, K10–K13, or all eight under the encoders) show the
page of steps that's playing, with their LEDs (amber on, white playing, blue
held). A press turns a step on or off; an encoder wired to input 3 then sets
that step's note, for 2 seconds after the press or while the key is held, so
press a step and dial its note with one hand (or one mouse, in greenhouse's panel
view). Otherwise the encoder transposes every step. The screen shows the
step and note for a moment. Input 2 (a step number) turns a step on or off.
Input 4 picks the page the keys show, counting steps through auto, page 1,
page 2… and back to auto: a positive number is the next page, a negative one
the previous, 0 nothing. So an encoder works, a key wired straight in is
“next” and a key through math × −1 is “previous”; a value block in between
doesn't work, since it sends its total (positive) on every press and
release, so a step on another page can be edited without waiting for it to
play (the line under the bars marks the page; caps at its ends when it was
picked by hand). Input 5 sets the length, 1 to 64 steps, from a value block
(encoder → value 1..64 → length); until it does, the steps field is the
length, and steps past it keep their pattern. The pattern and notes stay
when the block is edited. The guide's **Steps: tips** and its recipes (pages
from two keys, a sequence whose length you turn) show the wiring.

**Examples** (examples… in the drawer): **sequencer**, 16 steps across the
middle of the screen, played from the keys under E5–E12 (two pages; E4 picks
one to edit), notes set with E1 and snapped to C minor, a filter cutoff and
resonance on E2 and E3 with knobs, the playing step's number, and K1 to
start and stop; **controller**, four CCs on E1–E4 named over their encoders
with knobs and sliders under them, and K1 for sustain; **modes**, one set of
encoders with two jobs: K2 toggles edit mode, and route blocks send E1 and
E2 either to cutoff and resonance or to the sequencer's notes and page;
**arp**, the lua block making an arpeggio; **basics**, a first patch: an
encoder on a CC and the screen, a key on a note and its LED, an LFO on a CC.

greenhouse sends the runtime again whenever it changes (its `B.build` is a
fingerprint of the text); one loaded again stops the one that was running
and takes over its clock, so two never play at once.

The **screen** button in the drawer opens the layout builder
(js/patch-screen.js): the screen drawn between E1–E4 and K1–K4 with a box
for each screen block. Drag a box to move it, drag its right edge to widen
it, double-click it to switch between the full middle row and a half;
overlapping boxes turn red, and a click selects the block on the canvas.
The **? guide** button (and the opening page) shows a patching guide with a
picture of the grid.

The screen redraws at most 25 times a second and only when something on it
changed; the firmware sends the frame in the background, one changed page
at a time. The older **display** block (8 fixed bars) still works and draws
under the screen blocks.

The lua block's code travels as one Lua string in one line, so it's capped
at 360 characters (iii reads 512 per line). Longer code belongs in a user
block file (below).

**Next**: probability, curve, sample & hold, stepped values, a clock out,
grid key rows and LED rows; for the screen, pages (a page input that
flips between sets of screen blocks), saving a steps pattern with the
patch, and a menu block to set parameters from the panel.

**From the Monolit list** (achene's DESIGN.md §9.4): LFO with clock sync and
min/max, motion recorder, macro (one to many), key modifiers (freeze,
override), arpeggiator, step sequencer, page / bank, randomize a page.

**Custom**: beyond the lua block, user block files: a `.lua` that calls `B.type` and shows up in the
palette.

## Editing

Blocks come from the palette by a click (near the middle of the view) or a
drag (where they are dropped). Hovering a block's title, a field or a port
tells what it does. Wires are drawn from either end: from an output to an
input, or from an input back to an output. As in most node editors: the
wheel zooms around the pointer (the buttons too, and **fit** shows the whole
patch); a drag on empty space draws a selection box (shift adds to it); a
click selects a block, shift- or ctrl-click adds or removes one; dragging a
selected block moves the whole selection; space + drag or the middle button
pans; ctrl+C / X / V copy, cut and paste the selection with the wires
between its blocks (a paste lands under the mouse, and copied blocks paste
into another greenhouse tab too), ctrl+D duplicates it, ctrl+A selects every
block; delete removes the selection, Esc lets go. Drawflow pans on a plain
drag, zooms on ctrl+wheel only and has no group selection, so js/patch.js
handles these first and wraps its drag handler to move the rest of a
selection. The **patch** button at the top opens the editor any time, with
no device connected: a patch can be made offline and kept with **export…**
(a file on the computer, in the same format as **save…** on the device) and
**import…**. The guide's **recipes** are small wirings (an encoder on a CC,
a key as a switch, an LFO on a CC, random notes on a beat, following a MIDI
clock, an LFO around a knob, a shared value, one key for two jobs) that
**add** puts on the canvas beside what's there. Right-click a block (or the
selection it's in) for duplicate, copy, cut, delete and what it does, or
empty canvas for paste here and select all; a wire keeps its × to delete it.
New blocks from the palette, a recipe or a duplicate land on free space,
never on top of other blocks.

## State, versions and limits

Blocks that remember something keep it: a steps block its pattern, notes,
length and page; value, counter and memory blocks their number; a toggle
and a route their side; sample & hold its sample. The runtime reports it
(`B.state()`, one `__webdiii_state` line per block, as JSON) and takes it
back (`B.load(id, {...})`, or a fourth field in `B.patch`'s nodes). greenhouse
asks for it on **stop**, **save…**, **export…** and before **run** on a
running patch, keeps it with the block (copying a block copies it too) and
sends it with the patch, so a patch starts again where it was, on the
device or from a saved file.

A patch file carries the runtime version it was made with (`rt`) and,
from v9, the runtime itself, so on the device it can't meet an older one.
Files saved before v9 `require` blocks.lua (and v8's modules), which
still work while those files are on the device. In greenhouse, opening or
importing one lists the blocks it doesn't know and says when the file is
newer than greenhouse.

Limits: the whole patch runs on one 50 Hz metro (iii has 12), so blocks
cost memory, not metros; the status shows the running patch's blocks and
Lua memory (`B.stats()`). Timing is rounded to the 20 ms tick (a metro at
120 BPM in sixteenths can be up to 20 ms late), outputs send at most once
a tick each, and a line to the device stays under iii's 512 characters
(the lua block's code, a block's state).

## Memory and timing

- The runtime costs Lua heap once, only for the blocks a patch uses; a
  patch costs a table per node. Roomy on the RP2350's ~400 KB; on an
  RP2040 (parterre, achene's Pico build) watch `og_mem()`'s largest
  block: the heap fragments.
- The tick runs at 50 Hz by default: LFOs and slews are smooth enough for
  MIDI, and the device stays responsive. Outputs skip repeated values, so a
  slow LFO doesn't flood MIDI.
- Timing-critical blocks can later move to achene's C control engine
  (DESIGN.md §12) behind the same block names.

## Phases

1. **This prototype**: the runtime with the first block set, the patch
   drawer, live updates, save as a patch file. achene only.
2. Round trip (open a patch file), the lua node, more blocks, the grid's
   blocks.
3. Device palettes and drag-from-panel, block help, example patches in the
   script library.
4. Clock, sequencing and the Monolit blocks; user block files; sharing.

## Open questions

- Where the patch view lives once it grows: a drawer, a tab beside the
  editor, or its own page.
- Whether patches should also compile to flat Lua for the leanest devices.
- Naming: blocks are named for what they do (`accum`, `scale`); a beginner
  might prefer "value" over "accum". Settle with the first users.
