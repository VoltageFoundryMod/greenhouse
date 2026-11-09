# Roadmap

What's planned for this fork of diii, newest ideas last. Decisions and
details live in the linked documents; this is the list.

## Done

- **Own repo** (November 2026), split out of Open-Grid-Controller with its
  history, published at diii.vfmod.com from its own Pages workflow.
- **Device views**: the Open Grid's virtual grid; the achene panel, drawn
  from its PCB layout, with its LEDs and OLED live and its controls playable
  (help, full screen, keyboard).
- **achene's API** in the editor's autocomplete and the reference.
- **Opening page**: what diii is, connect, the devices with renders linking
  to their pages, where to start, the credit to monome's web-diii.
- **Visual editor, phase 1** ([VISUAL-EDITOR.md](VISUAL-EDITOR.md)): the
  patch drawer, the blocks runtime (`lua/blocks.lua`), ten blocks, live
  editing, save as a script that runs on its own, and open it again (open…
  in the drawer, or patch in a file's menu). Tested on an achene (Pico 2).
- **Visual editor, phase 2**: 24 blocks (MIDI in and clock in, metro,
  counter, random, quantize, slew, gate, print, encoder push, the grid's
  keys and LEDs), the lua block for custom code, a send limit for fast
  outputs, a palette that follows the connected device (any iii device
  gets the drawer), port names, and a sequencer example.
- **Visual editor, math and memory**: math, function, change, memory and
  shared variables (set var / get var); zoom buttons and fit; selecting
  several blocks (shift-drag, shift-click) to move or delete them together.
- **Visual editor, the screen**: screen blocks on a grid that matches the
  panel (enc label, key label, slider, knob, number, graph, steps, text),
  steps as a sequencer played from the keys with their LEDs, and a screen
  example; live/apply, palette drag, tooltips and resizable drawers; a
  screen layout builder (drag the screen blocks into place), a patching
  guide, and an opening page that says what iii and diii are and what
  works with each device.
- **Visual editor, steps and recipes**: steps with a note per step (bars),
  up to 32 steps, paging, one-handed note editing; route and watch blocks;
  a modes example; recipes in the guide; offline editing with export and
  import.
- **Visual editor, runtime v6**: state kept across stop, run, save and
  export; versioned patch files; constant, sample & hold, not, a metro
  with a BPM input; a right-click menu; new blocks on free space; the
  running patch's size in the status.
- **Visual editor, the grid (part A), runtime v7**: grid widgets on a
  shared grid picture (button, fader), a grid layout builder, device
  detection (achene, Open Grid, grid, with its size) with the palette,
  examples, guide and layout following it, a for: picker offline, a
  warning when a patch was made for another device, and a grid mixer
  example.
- **Visual editor, the grid (part B), runtime v8**: a step grid, an
  isomorphic keyboard and ripples (rings spreading from a press, an echo
  for each key they grow), with sequencer, keys and ripples examples.

## Next

- **A name of our own.** The tool now covers several devices and a patch
  editor; "diii" is monome's name for their app. Broad names rather than
  botanical ones; keep the credit to monome's web-diii (README, about box,
  the opening page), the GPL-3.0 license and the upstream remote, and
  redirect diii.vfmod.com.
- **Device pages on vfmod.com** (achene, Open Grid) for the opening page's
  cards to link to.
- **Visual editor, next blocks**: probability, curve, sample & hold,
  stepped values, a clock out, grid rows; user block files for code longer
  than the lua block takes.
- **Visual editor, phases 3 and 4**: device palettes and dragging a control
  off the device view into the patch; block help; example patches in a
  script library; the Monolit blocks (LFO with clock sync, motion recorder,
  macro, key modifiers, arpeggiator, sequencer, pages); user block files.
- **Firmware updates for achene** from its GitHub releases, as for the Open
  Grid (`js/firmware.js` per device).

## Ideas

- Where the patch editor lives once it grows: a drawer, a tab beside the
  code editor, or a page of its own.
- The achene view playing a recorded demo on the opening page, before any
  device is connected.
