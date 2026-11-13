# graft blocks

<!-- Made by tools/manual-blocks.mjs from js/patch-blocks.js: edit the blocks there, then run make manual-blocks. -->

Every block in graft's palette, by group, in the order the palette shows them. Hover a
block's title, a field or a port in graft for the same help. Numbers travel along the wires:
a block with inputs acts when one arrives, and sends its result on from its outputs. A setting
marked • can also be set by a wire: the block has an input for it after its own, shown while a
wire is drawn (or one is plugged in).

<!-- if: achene -->

## achene

The panel's encoders, pushes, keys and key LEDs (with achene connected).

### encoder

An achene encoder: a turn sends its detents, +1, +2... clockwise and -1, -2... counterclockwise (a fast turn sends more than 1 at once).

*no inputs, 1 output*

| setting | default | takes |
| --- | --- | --- |
| E | `5` | 1 to 12 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

### key

An achene key button: 1 when pressed, 0 when released.

*no inputs, 1 output*

| setting | default | takes |
| --- | --- | --- |
| K | `5` | 1 to 16 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

### key led

Lights an achene key button: the value (0..1) is the brightness.

*1 input, no outputs*

| setting | default | takes |
| --- | --- | --- |
| K | `5` | 1 to 16 |
| colour | `amber` | `white`, `red`, `amber`, `green`, `cyan`, `blue`, `pink` |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

### display

A labelled bar on achene's screen, in one of 8 places (two columns of four); the screen blocks place things more freely.

*1 input (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `value` | text |
| place | `1` | 1 to 8 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |
| lo • | `0` | a number |
| hi • | `127` | a number |

### enc push

An achene encoder's push button: 1 pressed, 0 released.

*no inputs, 1 output*

| setting | default | takes |
| --- | --- | --- |
| E | `1` | 1 to 12 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

### page

Picks the page shown: encoders, keys, LEDs and screen blocks with a page setting act and show only on their page (always: on every page). hold: shows page while the input is not 0 (a key held as a shift), the page before when it lets go; step: each step is the next page (positive) or the previous (negative), wrapping at pages (an encoder, a key); number: the input is the page. Sends the page whenever it changes.

*1 input, 1 output*

| setting | default | takes |
| --- | --- | --- |
| mode | `hold` | `hold`, `step`, `number` |
| page | `2` | 1 to 4 |
| pages | `2` | 1 to 4 |

<!-- end if -->

<!-- if: achene -->

## screen

Things drawn on achene's OLED, placed on a grid that lines up with E1–E4 and K1–K4.

### enc label

A name over an encoder (top row) with its value as a line; turning shows the number for a moment.

*1 input (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `cutoff` | text |
| shows as | (empty) | names for lo, lo+1… (off,on), a format with # for the number (ch #), note (C4), a unit (ms), or empty for the number |
| row | `top` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `1` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |
| lo • | `0` | a number |
| hi • | `127` | a number |

### key label

A name over a key (bottom row), shown inverted while its input is not 0 (wire a key or a toggle).

*1 input, no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `play` | text |
| row | `bottom` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `1` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

### slider

A vertical bar with its name and value.

*1 input (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `level` | text |
| shows as | (empty) | names for lo, lo+1… (off,on), a format with # for the number (ch #), note (C4), a unit (ms), or empty for the number |
| row | `middle` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `1` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |
| lo • | `0` | a number |
| hi • | `127` | a number |

### bars

Up to four thin vertical bars, one per input, side by side: two of one column each put eight values (E5–E12) on half the screen. In the full middle row its name sits under them, and the bar just moved shows its number there for a moment.

*4 inputs (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `E5-E8` | text |
| shows as | (empty) | names for lo, lo+1… (off,on), a format with # for the number (ch #), note (C4), a unit (ms), or empty for the number |
| bars | `4` | 1 to 4 |
| style | `frame` | `frame`, `solid` |
| row | `middle` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `1` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |
| lo • | `0` | a number |
| hi • | `127` | a number |

### knob

An arc with the value inside and the name under it (largest in the full middle row).

*1 input (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `res` | text |
| shows as | (empty) | names for lo, lo+1… (off,on), a format with # for the number (ch #), note (C4), a unit (ms), or empty for the number |
| row | `middle` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `1` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |
| lo • | `0` | a number |
| hi • | `127` | a number |

### number

A name and its value as text.

*1 input, no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `bpm` | text |
| shows as | (empty) | names for lo, lo+1… (off,on), a format with # for the number (ch #), note (C4), a unit (ms), or empty for the number |
| row | `middle top` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `1` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

### graph

The last values as a line scrolling from the right (an LFO, a CC).

*1 input (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `lfo` | text |
| row | `middle` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `2` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |
| lo • | `0` | a number |
| hi • | `1` | a number |

### steps

A step sequencer of up to 64 steps, each with a note, drawn as bars. *Step input* is the playing step (a counter), or with 'input 1 is' set to beat, a beat (a metro, clock in) that moves to the next step. Each step sends its note and, if it is on, a gate; step output is the step number. Its keys show a page of steps: a press turns a step on or off; an encoder wired to *edit input* then sets that step's note (for 2 seconds after the press, or while the key is held); otherwise it transposes them all. *Flip input* takes a step number and turns that step on or off. *Page input* picks the page the keys show, counting steps through auto, page 1, page 2...: positive is the next page, negative the previous (wire an encoder, a key for next on each push or a key thru 'math x -1' op for previous). *Length input* sets the length, 1 to 64 (from a value block); see guide for more recipes.

*5 inputs (and 2 for settings •), 3 outputs*

| setting | default | takes |
| --- | --- | --- |
| steps | `8` | 1 to 64 |
| input is | `step number` | `step number`, `beat` |
| note | `60` | 0 to 127 |
| lo • | `48` | 0 to 127 |
| hi • | `72` | 0 to 127 |
| keys | `K5-K8 K10-K13` | `none`, `K1-K4`, `K5-K8`, `K10-K13`, `K5-K8 K10-K13` |
| row | `middle top` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `4` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

### text

Fixed words, e.g. a title.

*no inputs, no outputs*

| setting | default | takes |
| --- | --- | --- |
| text | `achene` | text |
| row | `middle top` | `top`, `middle`, `middle top`, `middle bottom`, `bottom` |
| column | `1` | 1 to 4 |
| width | `2` | 1 to 4 |
| page | `always` | `always`, `1`, `2`, `3`, `4` |

<!-- end if -->

<!-- if: grid -->

## grid

Widgets made of grid keys, and single keys and LEDs (with a grid connected).

### grid key

A grid key: 1 pressed, 0 released.

*no inputs, 1 output*

| setting | default | takes |
| --- | --- | --- |
| x | `1` | 1 to 16 |
| y | `1` | 1 to 16 |

### grid led

Lights a grid key: the value (0..1) is the level (0 to 15 on the grid).

*1 input, no outputs*

| setting | default | takes |
| --- | --- | --- |
| x | `1` | 1 to 16 |
| y | `1` | 1 to 16 |

### button

A button of one key or more on the grid. momentary: 1 pressed, 0 let go; toggle: each press flips it, 1 or 0 (and it remembers); trigger: 1 on each press. It's lit while held or on; its input lights it (and sets a toggle) without sending, so MIDI coming back can show a state. The grid button places it.

*1 input, 1 output*

| setting | default | takes |
| --- | --- | --- |
| mode | `momentary` | `momentary`, `toggle`, `trigger` |
| x | `1` | 1 to 16 |
| y | `1` | 1 to 16 |
| width | `1` | 1 to 16 |
| height | `1` | 1 to 16 |

### fader

A fader of grid keys from lo to hi: vertical when taller than wide (lo at the bottom), horizontal otherwise (lo on the left); a wider one moves as one. A press sends its value; its input moves it without sending. Each key is one step, so 8 keys of 0..127 jump by 18. It remembers where it was.

*1 input (and 2 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| lo • | `0` | a number |
| hi • | `127` | a number |
| start | `0` | a number |
| style | `fill` | `fill`, `dot` |
| direction | `auto` | `auto`, `vertical`, `horizontal` |
| x | `1` | 1 to 16 |
| y | `1` | 1 to 16 |
| width | `1` | 1 to 16 |
| height | `8` | 1 to 16 |

### steps

A step grid: each column a step, each row a note of the scale from note (the bottom row lowest); one key high, a row of on/off steps. A press puts its step on that row, or turns it off. Input 1 is the playing step (a counter), or with 'input 1 is' set to beat, a beat (a metro) that moves to the next step. Steps past the width go on to pages, which follow the playing step unless input 2 picks one (positive next, negative previous, through auto). Input 3 sets the length (1 to 64), input 4 transposes (semitones). Outputs: gate, note (sent before the gate), step number. It remembers its pattern.

*4 inputs, 3 outputs*

| setting | default | takes |
| --- | --- | --- |
| steps | `16` | 1 to 64 |
| input 1 is | `beat` | `step number`, `beat` |
| note | `48` | 0 to 127 |
| scale | `minor pent.` | `major`, `minor`, `dorian`, `pentatonic`, `minor pent.`, `chromatic` |
| x | `1` | 1 to 16 |
| y | `1` | 1 to 16 |
| width | `8` | 1 to 16 |
| height | `4` | 1 to 16 |

### keys

An isomorphic keyboard: a semitone to the right, row semitones going up (5, a fourth, as on Push and Launchpad), from note at the bottom left. Root keys are lit brighter, the scale dimmer, and a held note lights every key that plays it. It plays MIDI itself, several notes at once (send: midi), and sends the last note and a gate (1 while any key is held) for wiring. Input 1 transposes, in semitones (octaves from a fader).

*1 input (and 2 for settings •), 2 outputs*

| setting | default | takes |
| --- | --- | --- |
| note | `48` | 0 to 127 |
| row | `5` | 1 to 12 |
| scale | `major` | `major`, `minor`, `dorian`, `pentatonic`, `minor pent.`, `chromatic` |
| send | `midi` | `midi`, `outputs only` |
| ch • | `1` | 1 to 16 |
| vel • | `100` | 1 to 127 |
| x | `1` | 1 to 16 |
| y | `1` | 1 to 16 |
| width | `8` | 1 to 16 |
| height | `4` | 1 to 16 |

### ripples

A press drops a stone: it plays the key's note (the scale from note, a step to the right, a step going up) and a ring spreads from the key, fading. Each key it grows plays again, step scale steps higher and quieter, echoes times. Input 1 drops one on a random key (anything but 0: a metro makes rain), input 2 sets the speed (keys a second). Notes fold into the four octaves from note. It plays MIDI itself, each note len ms long, and sends each note and a gate for wiring.

*2 inputs (and 4 for settings •), 2 outputs*

| setting | default | takes |
| --- | --- | --- |
| note | `48` | 0 to 127 |
| scale | `pentatonic` | `major`, `minor`, `dorian`, `pentatonic`, `minor pent.`, `chromatic` |
| step | `2` | -7 to 7 |
| echoes • | `4` | 0 to 12 |
| speed | `6` | a number |
| len ms • | `150` | 20 to 4000 |
| send | `midi` | `midi`, `outputs only` |
| ch • | `1` | 1 to 16 |
| vel • | `100` | 1 to 127 |
| x | `1` | 1 to 16 |
| y | `1` | 1 to 16 |
| width | `8` | 1 to 16 |
| height | `8` | 1 to 16 |

<!-- end if -->

## sources

Start messages: an LFO, a metro, clock and MIDI coming in.

### lfo

A slow wave, 0 to 1, updates 50 times a second.

*no inputs (and 1 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| Hz • | `0.5` | 0.01 to 20 |
| shape | `sine` | `sine`, `triangle`, `saw`, `square` |

### metro

A steady beat: 1 on each beat, 0 halfway. Input 1: 0 stops it, anything else starts it. Input 2 sets the tempo in BPM (then ms is unused), with per beat beats to a quarter note (2 eighths, 4 sixteenths); it steps on the 50 Hz tick, so timing is rounded to 20 ms.

*2 inputs (and 1 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| ms • | `500` | 20 to 10000 |
| per beat | `1` | `1`, `2`, `3`, `4` |

### clock in

MIDI clock in: output 1 beats every div clocks (24 = a quarter(PPQN)); output 2 is 1 on start, 0 on stop.

*no inputs, 2 outputs*

| setting | default | takes |
| --- | --- | --- |
| div | `24` | `96`, `48`, `24`, `12`, `6`, `3` |

### midi in cc

An incoming CC: its value, 0..127.

*no inputs (and 2 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| cc • | `74` | 0 to 127 |
| ch • | `1` | 1 to 16 |

### midi in note

Incoming notes: output 1 the note number, output 2 1 on and 0 off.

*no inputs (and 1 for settings •), 2 outputs*

| setting | default | takes |
| --- | --- | --- |
| ch • | `1` | 1 to 16 |

### constant

A fixed number: sent when the patch starts, and again whenever anything comes in (a key, a beat).

*1 input (and 1 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| value • | `1` | a number |

## process

Shape messages on their way.

### value

Stores and accumulates a value, keeps it between lo and hi: turns encoder steps into a value.

*1 input (and 2 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| lo • | `0` | a number |
| hi • | `127` | a number |
| start | `64` | a number |

### scale

Maps one range onto another, e.g. 0..1 to 0..127.

*1 input (and 4 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| in lo • | `0` | a number |
| in hi • | `1` | a number |
| out lo • | `0` | a number |
| out hi • | `127` | a number |

### toggle

Flips between 0 and 1 on each press (a flip-flop).

*1 input, 1 output*

### counter

Step input: the next step when not 0, wrapping; reset input: resets to lo when not 0.

*2 inputs (and 3 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| lo • | `1` | a whole number |
| hi • | `8` | a whole number |
| step • | `1` | a whole number |

### random

A whole number from lo to hi each time the input is not 0.

*1 input (and 2 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| lo • | `48` | a whole number |
| hi • | `72` | a whole number |

### quantize

Quantizes the input note to the nearest note in the selected scale.

*1 input (and 1 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| scale | `major` | `major`, `minor`, `dorian`, `pentatonic`, `minor pent.`, `chromatic` |
| root • | `0` | 0 to 11 |

### slew

Glides to each new value over a time (seconds).

*1 input (and 1 for settings •), 1 output*

| setting | default | takes |
| --- | --- | --- |
| s • | `0.5` | 0 to 30 |

### gate

Passes input value while "open" is not 0; starts open.

*2 inputs, 1 output*

### route

Input 1 goes out of output 1 while pick (input 2) is 0, and out of output 2 when pick is anything else; the other output stays quiet (a toggle on pick switches it).

*2 inputs, 2 outputs*

## math

Arithmetic and functions.

### math

Applies an operation to two number inputs: input 1 computes and sends (a op b), input 2 sets b without sending; until then b is the field.

*2 inputs, 1 output*

| setting | default | takes |
| --- | --- | --- |
| op | `+` | `+`, `-`, `*`, `/`, `mod`, `min`, `max`, `pow`, `>`, `<`, `=` |
| b | `1` | a number |

### function

One number in, one out; sin/cos/tan take radians (an LFO times 6.2832 is a full turn).

*1 input, 1 output*

| setting | default | takes |
| --- | --- | --- |
| fn | `sin` | `sin`, `cos`, `tan`, `abs`, `neg`, `not`, `sqrt`, `exp`, `log`, `floor`, `ceil`, `round` |

### change

Passes a value only when it differs from the last one.

*1 input, 1 output*

## memory

Keep values: samples, memories and variables.

### sample & hold

Sample & hold: input 1 is watched quietly; a trigger on input 2 (not 0, e.g. a metro) sends the value input 1 had then.

*2 inputs, 1 output*

### memory

Input 1 stores and sends; input 2 stores quietly; input 3 (not 0) sends what is stored.

*3 inputs, 1 output*

| setting | default | takes |
| --- | --- | --- |
| start | `0` | a number |

### set var

Stores a value under a name; every get var with that name sends it on (no wire needed).

*1 input, no outputs*

| setting | default | takes |
| --- | --- | --- |
| name | `x` | text |

### get var

Sends the value each time a set var with the same name stores one.

*no inputs, 1 output*

| setting | default | takes |
| --- | --- | --- |
| name | `x` | text |

### keep

Keeps what the patch's blocks remember (values, toggles, counters, steps, the page) on the device, so a patch that starts at power-up starts where it was: written only when something changed, at most every 'every' seconds, and read when the patch starts. Save input (not 0) writes now; forget input (not 0) drops what was kept. Give each patch its own name.

*2 inputs, no outputs*

| setting | default | takes |
| --- | --- | --- |
| name | `patch` | text |
| every s | `10` | 2 to 600 |

## output

Send messages out: MIDI, the console.

### midi cc

Sends the value as a MIDI CC (0..127).

*1 input (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| cc • | `20` | 0 to 127 |
| ch • | `1` | 1 to 16 |

### midi note

Input 1: note on when not 0, off when 0; input 2 (optional) sets the note number.

*2 inputs (and 2 for settings •), no outputs*

| setting | default | takes |
| --- | --- | --- |
| note | `60` | 0 to 127 |
| vel • | `100` | 1 to 127 |
| ch • | `1` | 1 to 16 |

### watch

Passes values unchanged and shows the values on the block with a graph (updated 10 times a second at most).

*1 input, 1 output*

### print

Prints values in greenhouse's console, at most 10 times a second.

*1 input, no outputs*

| setting | default | takes |
| --- | --- | --- |
| label | `value` | text |

## custom

A block of your own Lua.

### lua

Your own code, run for each message: i (the input), v (the value), out(n, value), s (kept between calls).

*2 inputs, 2 outputs*

| setting | default | takes |
| --- | --- | --- |
| code | example code | Lua code |

<!-- pagebreak -->

## Recipes

Small wirings to start from, in graft's guide (**? guide**, then **add**): each lands on the canvas
beside what is there.

| any device | wiring | what it shows |
| --- | --- | --- |
| An LFO moves a CC | lfo → scale → midi cc, scale → watch | An LFO sends 0 to 1, fifty times a second; scale maps it to the range you want (here 20 to 100). MIDI outputs send at most once a tick, so it can not flood a synth. watch shows the values on the canvas while it runs. |
| Random notes on a beat | metro → random → quantize → midi note (2), metro → midi note (1) | The metro's 1 picks a random note and then plays it: wires leave an output in the order they were made, so the note reaches midi note's input 2 before the beat reaches input 1. quantize keeps it in a scale. |

<!-- if: achene -->

| with achene | wiring | what it shows |
| --- | --- | --- |
| An encoder sends a CC | encoder → value → midi cc (and enc label) | An encoder sends steps (+1, −2…), not a position: value adds them up and keeps the total in its range. The enc label names it on the screen, over E1. |
| A key plays a note and lights up | key → midi note, key → key led | A key sends 1 when pressed and 0 when let go: midi note plays while it gets 1, key led lights at the value (0 to 1) as its brightness. One output can feed any number of inputs. |
| A key as an on/off switch | key → toggle → key led, toggle → math (× 127) → midi cc | toggle flips between 0 and 1 on each press (a release's 0 does nothing), so the key latches. math scales the 1 to a CC's 127, here sustain (CC 64). |
| Follow a MIDI clock | clock in → counter → steps → midi note | clock in turns the MIDI clock a DAW or drum machine sends into beats: div 6 is sixteenths (24 clocks to a quarter note). The counter counts them into steps, so the sequencer plays in time and starts where the clock starts. |
| Pages from two keys (or an encoder) | key K9 → steps page, key K14 → math (× −1) → steps page | The page input counts steps: a positive number is the next page, a negative one the previous, 0 nothing. A key sends 1 on press (next) and 0 on release (ignored); math × −1 makes the other key's press a −1 (previous). An encoder wired straight in works too. Not through a value block: it sends its total, always positive, on every press and release, so each click would turn two pages forward. |
| A sequence whose length you turn | metro → steps (input 1 is: beat), encoder → value (1..64) → steps length | With 'input 1 is' set to beat, each beat moves to the next step and wraps at the length, so no counter is needed. The length input takes a number of steps, so it goes through a value block (here 1 to 64, starting at 16); number shows it on the screen. |
| An LFO around a knob | lfo → scale → math a, encoder → value → math b, math → midi cc | math's input 1 computes and sends, its input 2 only sets b: put the source that should send (the LFO) on input 1 and the setting (the encoder) on input 2. Here the LFO sways ±20 around where E2 is. |
| A tempo shared without a wire | encoder → value → set var "tempo" … get var "tempo" → metro (bpm), number | set var stores a value under a name and every get var with that name sends it on, anywhere in the patch. Here E3 sets a tempo (60 to 200 BPM) that a metro's input 2 follows, four beats to a quarter note; K16's LED blinks with it. |
| One key, two jobs for an encoder | key → toggle → route (2), encoder → route (1) → two values | route sends input 1 out of output 1 while input 2 is 0, out of output 2 otherwise. A toggle on a key picks the output, so E1 sends one CC or the other. The modes example does this for a sequencer. |
| A channel you turn, kept at power-off | encoder → value (1..16) → midi cc ch, keep | A midi cc's ch has an input of its own (it shows while you draw a wire): E4 through a value block from 1 to 16 turns the channel E1's CC goes out on. keep writes what the blocks remember to the device when it changes, so after a power cut the patch starts on the same channel and value. Give keep a name of its own for each patch. |
| A shift key: hold K4 for settings | key K4 → page (hold); E1 on page 1 → a CC, E1 on page 2 → its channel | A block's page setting puts it on one page: it acts and shows only while that page is shown, and always means every page. page in hold mode shows page 2 while K4 is held. E1 is two encoder blocks, one on each page, each with its own value, so the CC doesn't jump when you come back: on page 1 it turns the cutoff, on page 2 (K4 held) the channel, with its own label over E1. |
| Thin bars for E5–E8 | encoders E5–E8 → values → bars (inputs 1–4) and midi cc | bars draws up to four thin bars side by side, one per input, in one column of the screen. Here E5 to E8 each turn a value that sends a CC and moves its bar; the bar just moved shows its number under them for a moment. A second bars block in column 4, fed by E9–E12, puts all eight on half the screen. |

<!-- end if -->

<!-- if: grid -->

| with grid | wiring | what it shows |
| --- | --- | --- |
| A grid fader sends a CC | fader → midi cc | A fader is a column (or row) of keys from lo to hi: a press sends the value of that key. Its size and place are its x, y, width and height, or drag it in the grid button. It sends its start value when the patch starts. |
| Grid buttons play notes and toggle a CC | button (momentary) → midi note; button (toggle) → math (× 127) → midi cc | A momentary button sends 1 while held and 0 when let go, just what midi note wants for its gate. A toggle flips between 1 and 0 on each press; math × 127 makes that a CC value (127 on, 0 off). |
| A button that shows what the host says | midi in cc → button input; button (toggle) → math (× 127) → midi cc | A button's input lights it without sending. Wire a midi in cc for the same CC into it, and the button shows the state your DAW sends back, even when it was changed there. |
| A step grid plays notes | metro → steps (input 1 is: beat) → midi note (note, then gate) | Each beat moves the steps one column on. A step with a key lit plays that row's note: the note goes to midi note's input 2 first, then the gate to its input 1. Press a key to put its step there, press it again to clear it. |
| A keyboard with an octave fader | fader (−24..24, dot) → keys (transpose) | keys plays MIDI by itself, several notes at once, so it needs no midi note block. A fader of five keys from −24 to 24 sends −24, −12, 0, 12 or 24: octaves, into its transpose input. |

<!-- end if -->

## Examples

Whole patches, from **examples…** in graft's bar. Loading one replaces the canvas.

<!-- if: achene -->

- **with achene:** basics, sequencer, controller, modes, arp (lua)

<!-- end if -->

<!-- if: grid -->

- **with grid:** mixer, sequencer, keys, ripples

<!-- end if -->
