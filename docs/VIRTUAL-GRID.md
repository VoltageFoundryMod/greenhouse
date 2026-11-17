# The virtual grid

**device ▾ → virtual grid** (or **or try a virtual grid** on the welcome page) connects
greenhouse to a 16×8 grid that runs inside the page. It needs no device and no Web Serial, so
it also works in Firefox and Safari. Use it to try scripts and graft patches, or to show
greenhouse to someone who has no grid. Everything works as with a parterre: the REPL, files,
the editor, the grid drawer, graft (with the grid's blocks), the MIDI monitor and backups.
**disconnect** goes back to USB devices.

## How it works

`js/virtual-device.js` holds two pieces:

- **`VirtualIii`** is iii's firmware for a grid, without the hardware. It runs iii's own
  `lib.lua` (`vendor/iii-lib.lua`, monome/iii v1.1.2, unchanged) in
  [Fengari](https://fengari.io), which is Lua 5.3 written in JavaScript (`vendor/fengari.js`,
  bundled by `npm run vendor`). Under that it supplies the C layer, written after iii's
  `repl.c`, `vm.c` and `metro.c` and parterre's `main.c`:
    - the REPL: lines of at most 512 bytes; `^^s`/`^^f`/`^^w` uploads, `^^c`, `^^i`, `^^r`,
      `^^p` and `^^g`;
    - `print`, `dostring`, `midi_tx`, `metro_set`, `get_time`, `device_id` (`grid`) and
      `device_version` (`virtual`);
    - `fs_*`;
    - parterre's grid functions (`grid_*`) and greenhouse's `gh_*`: `gh_mirror`, `gh_key`,
      `gh_dump_file`, `gh_rename_file`, `gh_board`, `gh_midi_monitor`, `gh_midi_counts` and
      `gh_mem`.
- **`createVirtualConnection`** wraps it in the interface of `iiiConnection`
  (`js/connection.js`). The app swaps it in for the USB connection (`connectVirtual` in
  `js/device.js`) and runs the same detection as for a device, so nothing else in greenhouse
  knows the difference.

The output is passed back in a microtask, never inside the `write` that caused it, as bytes
arriving over USB would be. Files live in localStorage under `webdiii.virtualFs`.

Keep it in step with the firmware. When iii's REPL or parterre's `gh_*` functions change,
change them here too, and add any new difference to the list below.

`npm run check:virtual` (part of `make test`) drives the virtual grid the way greenhouse
drives a device: captures, uploads, `^^c`/`^^i`, metros, the grid mirror, keys, the MIDI
monitor, and every graft example, both live and as a saved file. It runs all of that twice:
on the `fengari` npm package, and on `vendor/fengari.js` in a context without Node's
globals, as a browser loads it.

## Differences from a parterre

- **Lua 5.3, not 5.4.** There's no `<const>`, `<close>` or integer `for` loop overflow
  check, and some error messages are worded differently. **Integers are 32-bit**: anything
  past ±2147483647 wraps around (the device has 64 bits).
- **Timing.** Metros run on browser timers. They don't drift, but each tick can be a few
  milliseconds late. A tab in the background is slowed to about once a second, so keep the
  tab in front when the timing matters.
- **Memory.** Nothing is measured: `collectgarbage("count")` returns 0, and `gh_mem` gives
  fixed numbers. A script that runs out of memory on an RP2040 runs fine here.
- **A script that never returns** (`while true do end`) is stopped after 3 seconds with an
  error. A device would hang until the watchdog restarts it.
- **A line over 512 bytes** is dropped, and the virtual grid says so. A device loses it too,
  but silently, and then runs the part after byte 512.
- **No MIDI ports.** MIDI only goes to the MIDI monitor: nothing reaches a synth, and no
  MIDI comes in (no clock either, so the tempo stays at 0). `VirtualIii.midiIn()` is the
  place to connect Web MIDI later.
- **No hardware.** `grid_intensity` is kept but doesn't dim the drawer; there's no status
  LED (`pt_led`) and no monome mode (`pt_set_mode`), so the menu hides it. **bootloader**
  only prints a message, and **reboot** restarts the Lua state without disconnecting.
- **Files** don't get iii's trailing `\0`, so `fs_file_size` is one byte smaller than on
  the device. The free space starts from 1 MB.

## Credits

The idea, and several of the solutions used here, come from Jon Waterschoot's
[diii-neotrellis-emulator](https://github.com/jonwaterschoot/diii-neotrellis-emulator)
(GPL-3.0), a browser emulator for iii grid scripts. His emulator showed that iii scripts run
well in Fengari. From it come: answering `collectgarbage` in place of Fengari's missing
`lua_gc`, popping the error after a failed callback (otherwise a broken metro fills the
stack), passing event arguments as integers so `x .. ""` gives `1`, and timing metros against
a running target so they don't drift. The code here was written for greenhouse, around iii's
own `lib.lua` instead of his engine. If you want sound, his emulator has synths and a drum
kit, and it can play scripts straight from GitHub.

- Fengari: MIT, with sprintf-js (BSD-3-Clause) bundled in; both notices are in `vendor/fengari.LICENSE`.
- iii's `lib.lua`: monome, GPL-3.0, like greenhouse.
