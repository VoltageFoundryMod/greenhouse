# Visual editor: patching iii scripts

Status: **design + first prototype** (November 2026). The prototype is the
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
- **Live**: while running, every change goes straight to the device as
  `B.node`, `B.wire`, `B.set` lines; the device's view shows the result and
  plays it. **save** writes the patch file; **run** on a saved file does
  `fs_run_file`.
- The runtime is uploaded when missing or older than the one diii carries.
- **Device palettes**: the palette shows the connected device's own blocks
  (achene: encoders, pushes, keys, key LEDs, screen; grid: keys, LEDs) next
  to the shared ones. Later: drag an encoder off the achene panel into the
  patch.
- **Library**: Drawflow (MIT, no dependencies), bundled into `vendor/` like
  the code editor, so the site keeps its no-build setup.

## Blocks

**First set (the prototype):**

| block                                             | does                                                    |
| ------------------------------------------------- | ------------------------------------------------------- |
| encoder _n_                                       | a turn's delta (achene)                                 |
| key _n_                                           | 1 pressed, 0 released (achene)                          |
| lfo _rate, shape_                                 | 0..1, sine / triangle / saw / square, on the tick       |
| accum _lo, hi, start_                             | adds deltas, clamped: an encoder becomes a value        |
| scale _in lo/hi, out lo/hi_                       | maps a range                                            |
| toggle                                            | flips 0 / 1 on each press                               |
| midi cc _cc, ch_                                  | sends the value (0..127, rounded; repeats skipped)      |
| midi note _note, vel, ch_                         | note on for non-zero, off for zero                      |
| key led _n, colour_                               | lights key n at the value's brightness (0..1)           |
| display _label, slot_                             | a labelled bar on the screen, in one of eight slots     |

**Next**: encoder push, MIDI in (CC / note), metro, clock (MIDI clock and
sync in), counter, random, probability, quantize to scale, slew, curve,
gate / switch, sample & hold, stepped values, grid key and grid LED, print.

**From the Monolit list** (achene's DESIGN.md §9.4): LFO with clock sync and
min/max, motion recorder, macro (one to many), key modifiers (freeze,
override), arpeggiator, step sequencer, page / bank, randomize a page.

**Custom**: the lua node (inputs, outputs and code typed in the node), and
later user block files: a `.lua` that calls `B.type` and shows up in the
palette.

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
