# Visual editor: patching iii scripts

Status: **design + prototype, phase 2** (November 2026). The prototype is the
**patch** drawer (`js/patch.js`, `lua/blocks.lua`); this document is where
the design lives and changes.

## Why

iii scripts are short Lua programs that react to events: a key, an encoder,
a MIDI message, a metro. Writing them is easy for programmers and a wall for
everyone else. Most scripts people want are the same few patterns wired
differently: an encoder drives a CC, a key toggles a note, an LFO moves a
parameter, a value is shown on a screen or a key's LED.

A patcher in the spirit of Max or Pure Data makes those patterns visible:
boxes for sources, processors and outputs, wires between them. diii already
has what makes this pleasant: a live connection to the device, a view of the
device to play (the achene panel, the virtual grid), and an editor for when
code is the better tool. The patcher adds the missing middle.

**Goals**

- A useful script in minutes without writing Lua, played live as it's built.
- The result is an ordinary `.lua` file on the device: it runs without diii,
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
2. **A runtime plus data** (chosen): the device gets one library,
   `blocks.lua`, with every block type; the patch script is a short
   declaration of nodes and wires that the runtime builds and runs.

The second keeps the generated file small and readable, makes custom blocks
just Lua functions registered with the runtime, and lets diii update a
running patch live by sending one node or wire at a time.

### blocks.lua

```lua
B.version                -- the runtime's version; diii uploads a newer one
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

The runtime owns iii's event functions (`event_enc`, `event_key`,
`event_enc_key`, `event_grid`, `event_midi`) while a patch runs and routes
them to the source nodes that asked for them. A Lua node can still define
its own handlers for anything else.

### The patch file

```lua
-- diii patch: cutoff and a toggle
--@patch {"v":1,"nodes":[{"id":1,"type":"encoder","x":40,"y":60,
--@patch "params":{"n":5}}, ...],"wires":[[1,1,2,1], ...]}
require("blocks.lua")
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

- diii opens a `.lua` file with `--@patch` lines as a patch: **open…** in the
  drawer lists the device's scripts, and a script's file menu has **patch**.
- **Custom code** goes in a **lua** node: its code is part of the patch and
  survives the round trip.
- Editing the generated Lua by hand outside a lua node **detaches** the file:
  diii notices the code no longer matches the patch (it regenerates and
  compares) and opens it as code, saying so. The patch can still be restored
  from the comment, losing the hand edits. Simple and honest; no attempt at
  parsing arbitrary Lua back into boxes.

## In diii

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
- **Patch files** start with `-- diii patch:`; the file list marks them with
  a **patch** tag, and **open…** lists only them.
- The runtime is uploaded when missing or older than the one diii carries.
- **Device palettes**: the palette shows the connected device's own blocks
  (achene: encoders, pushes, keys, key LEDs, screen; grid: keys, LEDs) next
  to the shared ones. Later: drag an encoder off the achene panel into the
  patch.
- **Library**: Drawflow (MIT, no dependencies), bundled into `vendor/` like
  the code editor, so the site keeps its no-build setup.

## Blocks

**The blocks so far** (runtime v5). Device blocks show in the palette only
when that device is connected:

| block                           | does                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| encoder _n_ (achene)            | a turn's steps                                                                                 |
| enc push _n_ (achene)           | 1 pushed, 0 released                                                                           |
| key _n_ (achene)                | 1 pressed, 0 released                                                                          |
| key led _n, colour_ (achene)    | lights key n at the value's brightness (0..1)                                                  |
| display _label, place_ (achene) | a labelled bar on the screen, in one of eight places                                           |
| grid key _x, y_ (grid)          | 1 pressed, 0 released                                                                          |
| grid led _x, y_ (grid)          | lights a key at the value's level (0..1 to 0..15)                                              |
| lfo _rate, shape_               | 0..1, sine / triangle / saw / square, 50 times a second                                        |
| metro _ms_                      | a gate: 1 on each beat, 0 halfway; its input stops (0) and starts it                           |
| clock in _div_                  | MIDI clock in: a gate every _div_ clocks; output 2 is 1 on start, 0 on stop                    |
| midi in cc _cc, ch_             | an incoming CC's value                                                                         |
| midi in note _ch_               | output 1 the note number, output 2 1 on / 0 off                                                |
| value _lo, hi, start_           | adds what comes in, clamped: encoder steps become a value; sends its start                     |
| scale _in lo/hi, out lo/hi_     | maps a range                                                                                   |
| toggle                          | flips 0 / 1 on each press; sends its state (0) at the start too                                |
| counter _lo, hi, step_          | input 1 steps (the first step is lo), input 2 resets; wraps                                    |
| random _lo, hi_                 | a whole number in the range for each non-zero input                                            |
| quantize _scale, root_          | the nearest note of the scale                                                                  |
| slew _time_                     | glides to each new value                                                                       |
| gate                            | passes input 1 while input 2 is open (not 0)                                                   |
| route                           | input 1 out of output 1 while input 2 is 0, out of output 2 otherwise (one control, two jobs)  |
| midi cc _cc, ch_                | sends the value (0..127, rounded; repeats skipped)                                             |
| midi note _note, vel, ch_       | input 1: note on / off; input 2 sets the note number                                           |
| math _op, b_                    | two numbers: + − × ÷ mod min max pow > < =; input 1 computes and sends, input 2 sets b quietly |
| function _fn_                   | sin cos tan (radians) abs neg sqrt exp log floor ceil round                                    |
| change                          | passes a value only when it differs from the last                                              |
| memory _start_                  | input 1 stores and sends, input 2 stores quietly, input 3 recalls                              |
| set var / get var _name_        | a named value shared by the whole patch, without wires (Max's send/receive)                    |
| watch                           | passes values on and shows them on the block: the latest and a graph (10 a second)             |
| print _label_                   | prints to diii's console, at most 10 a second                                                  |
| lua _code_                      | your code, for each message: `i`, `v`, `out(n, value)`, and `s` kept between calls             |

Gates (metro, clock in) go 1 then 0, so a note retriggers and a toggle or
counter counts only the 1s. Outputs (MIDI, LEDs) send at most once a tick:
a value that comes sooner is held and the latest goes out next tick, so an
LFO can't flood MIDI and a knob still answers at once.

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

| block                             | draws                                                                       |
| --------------------------------- | --------------------------------------------------------------------------- |
| enc label _label, lo, hi_ (top)   | a name with its value as a line under it; turning shows the number a moment |
| key label _label_ (bottom)        | a name, inverted while its input is not 0 (a key, a toggle)                 |
| slider _label, lo, hi_            | a vertical bar with its value over it and name under it                     |
| knob _label, lo, hi_              | an arc with the value inside and the name under it                          |
| number _label_                    | a name and its value as text                                                |
| graph _label, lo, hi_             | the last values as a line scrolling from the right (25 a second)            |
| steps _steps, note, lo, hi, keys_ | a step sequencer of up to 32 steps with a note each, as bars (below)        |
| text _text_                       | fixed words                                                                 |

**steps** is a sequencer in one block, up to 32 steps, each on or off with
its own note, drawn as bars as tall as their notes (within lo..hi). Input 1
is the playing step (from a counter): it sends the step's note (output 2)
and, when the step is on, a gate (output 1: 1, then 0 at the next step); the
note goes first so a midi note block plays it. Output 3 is the step number.
Its **keys** (K1–K4, K5–K8, K10–K13, or all eight under the encoders) show
the page of steps that's playing, with their LEDs (amber on, white playing,
blue held). A press turns a step on or off; an encoder wired to input 3 then
sets that step's note, for 2 seconds after the press or while the key is
held, so press a step and dial its note with one hand (or one mouse, in
diii's panel view). Otherwise the encoder transposes every step. The screen
shows the step and note for a moment. Input 2 (a step number) turns a step
on or off. Input 4 picks the page the keys show: each step from an encoder
(or each press of a key) moves through auto, page 1, page 2… and back to
auto, so a step on another page can be edited without waiting for it to play
(the line under the bars marks the page; caps at its ends when it was picked
by hand). The pattern and notes stay when the block is edited.

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

diii uploads blocks.lua again whenever it changes (its first line carries a
fingerprint of the text); a copy loaded again stops the one that was running
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
into another diii tab too), ctrl+D duplicates it, ctrl+A selects every
block; delete removes the selection, Esc lets go. Drawflow pans on a plain
drag, zooms on ctrl+wheel only and has no group selection, so js/patch.js
handles these first and wraps its drag handler to move the rest of a
selection. The **patch** button at the top opens the editor any time, with
no device connected: a patch can be made offline and kept with **export…**
(a file on the computer, in the same format as **save…** on the device) and
**import…**. The guide's **recipes** are small wirings (an encoder on a CC,
a key as a switch, an LFO on a CC, random notes on a beat, following a MIDI
clock, an LFO around a knob, a shared value, one key for two jobs) that
**add** puts on the canvas beside what's there.

## Memory and timing

- The runtime costs Lua heap once; a patch costs a table per node. Fine on
  the RP2350's ~400 KB; worth measuring on the RP2040 (og_mem) as blocks
  grow.
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
