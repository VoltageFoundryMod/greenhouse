// @ts-check
// The patch editor's blocks and the Lua it generates (docs/VISUAL-EDITOR.md).
// Each block here matches a B.type in lua/blocks.lua: same name, inputs,
// outputs and parameters.

/** Version of the runtime (lua/blocks*.lua) this diii carries; a patch file says which it was made with. */
export const RUNTIME_VERSION = 11;

/**
 * The runtime's source files, in the order their parts join: the core and
 * the blocks any iii device runs, then each device's own (docs/VISUAL-EDITOR.md).
 * @type {{ file: string, device: 'achene' | 'grid' | null }[]}
 */
export const RUNTIME_SOURCES = [
    { file: 'blocks.lua', device: null },
    { file: 'blocks_achene.lua', device: 'achene' },
    { file: 'blocks_grid.lua', device: 'grid' }
];

/** The script diii runs on the device: the runtime built for the patch on the canvas. */
export const RUNTIME_RUN_FILE = 'blocks_run.lua';

/** Files of the runtime on a device: the run script, and v8's whole files (still there on older setups). */
export const RUNTIME_DEVICE_FILES = [RUNTIME_RUN_FILE, ...RUNTIME_SOURCES.map((s) => s.file)];

/**
 * A short fingerprint of a text (FNV-1a, 32 bits, in hex), to tell one
 * runtime build from another.
 * @param {string} text
 */
export function fingerprint(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * @typedef {object} RuntimePart
 * @property {string} name
 * @property {string[]} needs the parts it uses (they come before it)
 * @property {string[]} types the block types it defines
 * @property {'achene' | 'grid' | null} device
 * @property {string} code compacted
 * @property {string} source as written (for tools/check-runtime.mjs)
 */

/**
 * The runtime's parts: each "--@part name needs a b" line starts one.
 * @param {Record<string, string>} texts file name -> its text, for RUNTIME_SOURCES
 * @returns {RuntimePart[]}
 */
export function parseRuntime(texts) {
    /** @type {RuntimePart[]} */
    const parts = [];
    for (const { file, device } of RUNTIME_SOURCES) {
        /** @type {{ name: string, needs: string[], lines: string[] } | null} */
        let cur = null;
        const close = () => {
            if (!cur) return;
            const body = cur.lines.join('\n');
            const types = [...body.matchAll(/^\s*(?:B\.type|widget)\("(\w+)"/gm)].map((m) => m[1]);
            parts.push({ name: cur.name, needs: cur.needs, types, device, code: compactLua(body), source: body });
        };
        for (const line of String(texts[file] ?? '').split(/\r?\n/)) {
            const m = /^--@part (\w+)(?: needs ([\w ]+))?\s*$/.exec(line);
            if (m) {
                close();
                cur = { name: m[1], needs: m[2] ? m[2].trim().split(/\s+/) : [], lines: [] };
            } else if (cur) cur.lines.push(line);
        }
        close();
    }
    return parts;
}

/**
 * The runtime for a set of block types: the core, the parts that define
 * them and the parts those need, in source order. On a device of a known
 * kind, another device's blocks are left out (they would do nothing).
 * @param {RuntimePart[]} parts from parseRuntime
 * @param {Iterable<string>} types
 * @param {'achene' | 'grid' | null} [device]
 * @returns {{ text: string, build: string, parts: string[], types: string[] }}
 */
export function buildRuntime(parts, types, device) {
    const byName = new Map(parts.map((p) => [p.name, p]));
    const fits = (/** @type {RuntimePart} */ p) => !device || !p.device || p.device === device;
    const take = new Set(['core']);
    const add = (/** @type {string} */ name) => {
        const p = byName.get(name);
        if (!p || take.has(name)) return;
        take.add(name);
        p.needs.forEach(add);
    };
    for (const t of types) {
        const p = parts.find((q) => q.types.includes(t));
        if (p && fits(p)) add(p.name);
    }
    const chosen = parts.filter((p) => take.has(p.name));
    const code = chosen.map((p) => p.code).join('') + wiredLua(chosen.flatMap((p) => p.types));
    const build = fingerprint(code);
    return {
        text: `${code}B.build = "${build}"\n`,
        build,
        parts: chosen.map((p) => p.name),
        types: chosen.flatMap((p) => p.types)
    };
}

/**
 * The block types a patch uses.
 * @param {Patch} patch
 */
export function patchTypes(patch) {
    return [...new Set(patch.nodes.map((n) => n.type))];
}

/**
 * Lua as the device gets it: no comment lines, no blank lines, no
 * indentation, and no comment after code when nothing before it is a
 * string. iii compiles each upload in RAM, so the smaller the better; the
 * runtime has no long strings, where this would go wrong.
 * @param {string} text
 */
export function compactLua(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
        let line = raw.trim();
        if (!line || line.startsWith('--')) continue;
        const at = line.indexOf('--');
        if (at > 0 && !/["']/.test(line.slice(0, at))) line = line.slice(0, at).trimEnd();
        out.push(line);
    }
    return `${out.join('\n')}\n`;
}

/**
 * @typedef {object} Param
 * @property {'int' | 'number' | 'text' | 'select' | 'code' | 'check'} type
 * @property {string} label shown in the node
 * @property {number | string} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string[]} [options] for select
 * @property {boolean} [wire] a number can set it by wire too: the block gets an input for it, after its own
 *   (wiredParams), shown while a wire is drawn and while one is plugged in
 * @property {number} [len] longest text it takes (20 when not given)
 * @property {string} [help] what it takes, for its tooltip and the manual (instead of a generic hint)
 *
 * @typedef {object} Block
 * @property {string} label
 * @property {'achene' | 'screen' | 'grid' | 'source' | 'process' | 'math' | 'memory' | 'output' | 'custom'} group palette section;
 *   achene and grid blocks show only for those devices
 * @property {number} inputs
 * @property {number} outputs
 * @property {string} doc one line, for the palette's tooltip
 * @property {Record<string, Param>} params
 * @property {'watch'} [view] something drawn on the block (the watch's value and graph)
 */

const COLOURS = ['white', 'red', 'amber', 'green', 'cyan', 'blue', 'pink'];

/** How a screen block shows its value (lua: show): names, a format with #, note, or a unit. */
/** @type {Param} */
const AS = {
    type: 'text',
    label: 'shows as',
    default: '',
    len: 60,
    help: 'names for lo, lo+1… (off,on), a format with # for the number (ch #), note (C4), a unit (ms), or empty for the number'
};

/** The page a control or screen block belongs to: it acts and shows only while a page block shows that page. */
/** @type {Param} */
const PAGE = { type: 'select', label: 'page', default: 'always', options: ['always', '1', '2', '3', '4'] };

/**
 * Where a screen block sits: a row of the screen, and columns that line up
 * with E1-E4 above it and K1-K4 below it (see lua/blocks.lua).
 * @param {string} where @param {number} span
 * @returns {Record<string, Param>}
 */
function place(where, span) {
    return {
        where: {
            type: 'select',
            label: 'row',
            default: where,
            options: ['top', 'middle', 'middle top', 'middle bottom', 'bottom']
        },
        col: { type: 'int', label: 'column', default: 1, min: 1, max: 4 },
        span: { type: 'int', label: 'width', default: span, min: 1, max: 4 },
        page: PAGE
    };
}

/**
 * Where a grid widget sits: its top left key and its size, in keys.
 * @param {number} w @param {number} h
 * @returns {Record<string, Param>}
 */
function gplace(w, h) {
    return {
        x: { type: 'int', label: 'x', default: 1, min: 1, max: 16 },
        y: { type: 'int', label: 'y', default: 1, min: 1, max: 16 },
        w: { type: 'int', label: 'width', default: w, min: 1, max: 16 },
        h: { type: 'int', label: 'height', default: h, min: 1, max: 16 }
    };
}

/** @type {Record<string, Block>} */
export const BLOCKS = {
    encoder: {
        label: 'encoder',
        group: 'achene',
        inputs: 0,
        outputs: 1,
        doc: 'an achene encoder: a turn sends its detents, +1, +2... clockwise and -1, -2... counterclockwise (a fast turn sends more than 1 at once)',
        params: { n: { type: 'int', label: 'E', default: 5, min: 1, max: 12 }, page: PAGE }
    },
    key: {
        label: 'key',
        group: 'achene',
        inputs: 0,
        outputs: 1,
        doc: 'an achene key button: 1 when pressed, 0 when released',
        params: { n: { type: 'int', label: 'K', default: 5, min: 1, max: 16 }, page: PAGE }
    },
    lfo: {
        label: 'lfo',
        group: 'source',
        inputs: 0,
        outputs: 1,
        doc: 'a slow wave, 0 to 1, updates 50 times a second',
        params: {
            rate: { type: 'number', label: 'Hz', default: 0.5, min: 0.01, max: 20, step: 0.05, wire: true },
            shape: {
                type: 'select',
                label: 'shape',
                default: 'sine',
                options: ['sine', 'triangle', 'saw', 'square']
            }
        }
    },
    accum: {
        label: 'value',
        group: 'process',
        inputs: 2,
        outputs: 1,
        doc: 'stores and accumulates a value, keeps it between lo and hi: turns encoder steps into a value. Input 2 sets the value without sending it (from a get var, to start where a kept value is)',
        params: {
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 127, wire: true },
            start: { type: 'number', label: 'start', default: 64 }
        }
    },
    scale: {
        label: 'scale',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'maps one range onto another, e.g. 0..1 to 0..127',
        params: {
            in_lo: { type: 'number', label: 'in lo', default: 0, wire: true },
            in_hi: { type: 'number', label: 'in hi', default: 1, wire: true },
            out_lo: { type: 'number', label: 'out lo', default: 0, wire: true },
            out_hi: { type: 'number', label: 'out hi', default: 127, wire: true }
        }
    },
    toggle: {
        label: 'toggle',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'flips between 0 and 1 on each press (a flip-flop)',
        params: {}
    },
    midi_cc: {
        label: 'midi cc',
        group: 'output',
        inputs: 1,
        outputs: 0,
        doc: 'sends the value as a MIDI CC (0..127)',
        params: {
            cc: { type: 'int', label: 'cc', default: 20, min: 0, max: 127, wire: true },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16, wire: true }
        }
    },
    midi_note: {
        label: 'midi note',
        group: 'output',
        inputs: 2,
        outputs: 0,
        doc: 'input 1: note on when not 0, off when 0; input 2 (optional) sets the note number',
        params: {
            note: { type: 'int', label: 'note', default: 60, min: 0, max: 127 },
            vel: { type: 'int', label: 'vel', default: 100, min: 1, max: 127, wire: true },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16, wire: true }
        }
    },
    key_led: {
        label: 'key led',
        group: 'achene',
        inputs: 1,
        outputs: 0,
        doc: 'lights an achene key button: the value (0..1) is the brightness',
        params: {
            n: { type: 'int', label: 'K', default: 5, min: 1, max: 16 },
            colour: { type: 'select', label: 'colour', default: 'amber', options: COLOURS },
            page: PAGE
        }
    },
    display: {
        label: 'display',
        group: 'achene',
        inputs: 1,
        outputs: 0,
        doc: "a labelled bar on achene's screen, in one of 8 places (two columns of four); the screen blocks place things more freely",
        params: {
            label: { type: 'text', label: 'label', default: 'value' },
            slot: { type: 'int', label: 'place', default: 1, min: 1, max: 8 },
            page: PAGE,
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 127, wire: true }
        }
    },
    enc_push: {
        label: 'enc push',
        group: 'achene',
        inputs: 0,
        outputs: 1,
        doc: "an achene encoder's push button: 1 pressed, 0 released",
        params: { n: { type: 'int', label: 'E', default: 1, min: 1, max: 12 }, page: PAGE }
    },
    page: {
        label: 'page',
        group: 'achene',
        inputs: 1,
        outputs: 1,
        doc: 'picks the page shown: encoders, keys, LEDs and screen blocks with a page setting act and show only on their page (always: on every page). hold: shows page while the input is not 0 (a key held as a shift), the page before when it lets go; step: each step is the next page (positive) or the previous (negative), wrapping at pages (an encoder, a key); number: the input is the page. Sends the page whenever it changes',
        params: {
            mode: { type: 'select', label: 'mode', default: 'hold', options: ['hold', 'step', 'number'] },
            page: { type: 'int', label: 'page', default: 2, min: 1, max: 4 },
            pages: { type: 'int', label: 'pages', default: 2, min: 1, max: 4 }
        }
    },
    grid_key: {
        label: 'grid key',
        group: 'grid',
        inputs: 0,
        outputs: 1,
        doc: 'a grid key: 1 pressed, 0 released',
        params: {
            x: { type: 'int', label: 'x', default: 1, min: 1, max: 16 },
            y: { type: 'int', label: 'y', default: 1, min: 1, max: 16 }
        }
    },
    grid_led: {
        label: 'grid led',
        group: 'grid',
        inputs: 1,
        outputs: 0,
        doc: 'lights a grid key: the value (0..1) is the level (0 to 15 on the grid)',
        params: {
            x: { type: 'int', label: 'x', default: 1, min: 1, max: 16 },
            y: { type: 'int', label: 'y', default: 1, min: 1, max: 16 }
        }
    },
    gbutton: {
        label: 'button',
        group: 'grid',
        inputs: 1,
        outputs: 1,
        doc: "a button of one key or more on the grid. momentary: 1 pressed, 0 let go; toggle: each press flips it, 1 or 0 (and it remembers); trigger: 1 on each press. It's lit while held or on; its input lights it (and sets a toggle) without sending, so MIDI coming back can show a state. The grid button places it",
        params: {
            mode: { type: 'select', label: 'mode', default: 'momentary', options: ['momentary', 'toggle', 'trigger'] },
            ...gplace(1, 1)
        }
    },
    gfader: {
        label: 'fader',
        group: 'grid',
        inputs: 1,
        outputs: 1,
        doc: 'a fader of grid keys from lo to hi: vertical when taller than wide (lo at the bottom), horizontal otherwise (lo on the left); a wider one moves as one. A press sends its value; its input moves it without sending. Each key is one step, so 8 keys of 0..127 jump by 18. It remembers where it was',
        params: {
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 127, wire: true },
            start: { type: 'number', label: 'start', default: 0 },
            style: { type: 'select', label: 'style', default: 'fill', options: ['fill', 'dot'] },
            orient: {
                type: 'select',
                label: 'direction',
                default: 'auto',
                options: ['auto', 'vertical', 'horizontal']
            },
            ...gplace(1, 8)
        }
    },
    gsteps: {
        label: 'steps',
        group: 'grid',
        inputs: 4,
        outputs: 3,
        doc: "a step grid: each column a step, each row a note of the scale from note (the bottom row lowest); one key high, a row of on/off steps. A press puts its step on that row, or turns it off. Input 1 is the playing step (a counter), or with 'input 1 is' set to beat, a beat (a metro) that moves to the next step. Steps past the width go on to pages, which follow the playing step unless input 2 picks one (positive next, negative previous, through auto). Input 3 sets the length (1 to 64), input 4 transposes (semitones). Outputs: gate, note (sent before the gate), step number. It remembers its pattern",
        params: {
            steps: { type: 'int', label: 'steps', default: 16, min: 1, max: 64 },
            advance: { type: 'select', label: 'input 1 is', default: 'beat', options: ['step number', 'beat'] },
            note: { type: 'int', label: 'note', default: 48, min: 0, max: 127 },
            scale: {
                type: 'select',
                label: 'scale',
                default: 'minor pent.',
                options: ['major', 'minor', 'dorian', 'pentatonic', 'minor pent.', 'chromatic']
            },
            ...gplace(8, 4)
        }
    },
    gkeys: {
        label: 'keys',
        group: 'grid',
        inputs: 1,
        outputs: 2,
        doc: 'an isomorphic keyboard: a semitone to the right, row semitones going up (5, a fourth, as on Push and Launchpad), from note at the bottom left. Root keys are lit brighter, the scale dimmer, and a held note lights every key that plays it. It plays MIDI itself, several notes at once (send: midi), and sends the last note and a gate (1 while any key is held) for wiring. Input 1 transposes, in semitones (octaves from a fader)',
        params: {
            note: { type: 'int', label: 'note', default: 48, min: 0, max: 127 },
            row: { type: 'int', label: 'row', default: 5, min: 1, max: 12 },
            scale: {
                type: 'select',
                label: 'scale',
                default: 'major',
                options: ['major', 'minor', 'dorian', 'pentatonic', 'minor pent.', 'chromatic']
            },
            send: { type: 'select', label: 'send', default: 'midi', options: ['midi', 'outputs only'] },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16, wire: true },
            vel: { type: 'int', label: 'vel', default: 100, min: 1, max: 127, wire: true },
            ...gplace(8, 4)
        }
    },
    gripples: {
        label: 'ripples',
        group: 'grid',
        inputs: 2,
        outputs: 2,
        doc: "a press drops a stone: it plays the key's note (the scale from note, a step to the right, a step going up) and a ring spreads from the key, fading. Each key it grows plays again, step scale steps higher and quieter, echoes times. Input 1 drops one on a random key (anything but 0: a metro makes rain), input 2 sets the speed (keys a second). Notes fold into the four octaves from note. It plays MIDI itself, each note len ms long, and sends each note and a gate for wiring",
        params: {
            note: { type: 'int', label: 'note', default: 48, min: 0, max: 127 },
            scale: {
                type: 'select',
                label: 'scale',
                default: 'pentatonic',
                options: ['major', 'minor', 'dorian', 'pentatonic', 'minor pent.', 'chromatic']
            },
            step: { type: 'int', label: 'step', default: 2, min: -7, max: 7 },
            echoes: { type: 'int', label: 'echoes', default: 4, min: 0, max: 12, wire: true },
            speed: { type: 'number', label: 'speed', default: 6 },
            len: { type: 'int', label: 'len ms', default: 150, min: 20, max: 4000, wire: true },
            send: { type: 'select', label: 'send', default: 'midi', options: ['midi', 'outputs only'] },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16, wire: true },
            vel: { type: 'int', label: 'vel', default: 100, min: 1, max: 127, wire: true },
            ...gplace(8, 8)
        }
    },
    metro: {
        label: 'metro',
        group: 'source',
        inputs: 2,
        outputs: 1,
        doc: 'a steady beat: 1 on each beat, 0 halfway. Input 1: 0 stops it, anything else starts it. Input 2 sets the tempo in BPM (then ms is unused), with per beat beats to a quarter note (2 eighths, 4 sixteenths); it steps on the 50 Hz tick, so timing is rounded to 20 ms',
        params: {
            ms: { type: 'int', label: 'ms', default: 500, min: 20, max: 10000, wire: true },
            per: { type: 'select', label: 'per beat', default: '1', options: ['1', '2', '3', '4'] }
        }
    },
    clock: {
        label: 'clock in',
        group: 'source',
        inputs: 0,
        outputs: 2,
        doc: 'MIDI clock in: output 1 beats every div clocks (24 = a quarter(PPQN)); output 2 is 1 on start, 0 on stop',
        params: {
            div: { type: 'select', label: 'div', default: '24', options: ['96', '48', '24', '12', '6', '3'] }
        }
    },
    midi_in_cc: {
        label: 'midi in cc',
        group: 'source',
        inputs: 0,
        outputs: 1,
        doc: 'an incoming CC: its value, 0..127',
        params: {
            cc: { type: 'int', label: 'cc', default: 74, min: 0, max: 127, wire: true },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16, wire: true }
        }
    },
    midi_in_note: {
        label: 'midi in note',
        group: 'source',
        inputs: 0,
        outputs: 2,
        doc: 'incoming notes: output 1 the note number, output 2 1 on and 0 off',
        params: { ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16, wire: true } }
    },
    counter: {
        label: 'counter',
        group: 'process',
        inputs: 2,
        outputs: 1,
        doc: 'step input: the next step when not 0, wrapping; reset input: resets to lo when not 0',
        params: {
            lo: { type: 'int', label: 'lo', default: 1, wire: true },
            hi: { type: 'int', label: 'hi', default: 8, wire: true },
            step: { type: 'int', label: 'step', default: 1, wire: true }
        }
    },
    random: {
        label: 'random',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'a whole number from lo to hi each time the input is not 0',
        params: {
            lo: { type: 'int', label: 'lo', default: 48, wire: true },
            hi: { type: 'int', label: 'hi', default: 72, wire: true }
        }
    },
    quantize: {
        label: 'quantize',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'quantizes the input note to the nearest note in the selected scale',
        params: {
            scale: {
                type: 'select',
                label: 'scale',
                default: 'major',
                options: ['major', 'minor', 'dorian', 'pentatonic', 'minor pent.', 'chromatic']
            },
            root: { type: 'int', label: 'root', default: 0, min: 0, max: 11, wire: true }
        }
    },
    slew: {
        label: 'slew',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'glides to each new value over a time (seconds)',
        params: { time: { type: 'number', label: 's', default: 0.5, min: 0, max: 30, step: 0.1, wire: true } }
    },
    gate: {
        label: 'gate',
        group: 'process',
        inputs: 2,
        outputs: 1,
        doc: 'passes input value while "open" is not 0; starts open',
        params: {}
    },
    constant: {
        label: 'constant',
        group: 'source',
        inputs: 1,
        outputs: 1,
        doc: 'a fixed number: sent when the patch starts, and again whenever anything comes in (a key, a beat)',
        params: { value: { type: 'number', label: 'value', default: 1, wire: true } }
    },
    sample: {
        label: 'sample & hold',
        group: 'memory',
        inputs: 2,
        outputs: 1,
        doc: 'sample & hold: input 1 is watched quietly; a trigger on input 2 (not 0, e.g. a metro) sends the value input 1 had then',
        params: {}
    },
    route: {
        label: 'route',
        group: 'process',
        inputs: 2,
        outputs: 2,
        doc: 'input 1 goes out of output 1 while pick (input 2) is 0, and out of output 2 when pick is anything else; the other output stays quiet (a toggle on pick switches it)',
        params: {}
    },
    math: {
        label: 'math',
        group: 'math',
        inputs: 2,
        outputs: 1,
        doc: 'applies an operation to two number inputs: input 1 computes and sends (a op b), input 2 sets b without sending; until then b is the field',
        params: {
            op: {
                type: 'select',
                label: 'op',
                default: '+',
                options: ['+', '-', '*', '/', 'mod', 'min', 'max', 'pow', '>', '<', '=']
            },
            b: { type: 'number', label: 'b', default: 1 }
        }
    },
    func: {
        label: 'function',
        group: 'math',
        inputs: 1,
        outputs: 1,
        doc: 'one number in, one out; sin/cos/tan take radians (an LFO times 6.2832 is a full turn)',
        params: {
            op: {
                type: 'select',
                label: 'fn',
                default: 'sin',
                options: ['sin', 'cos', 'tan', 'abs', 'neg', 'not', 'sqrt', 'exp', 'log', 'floor', 'ceil', 'round']
            }
        }
    },
    change: {
        label: 'change',
        group: 'math',
        inputs: 1,
        outputs: 1,
        doc: 'passes a value only when it differs from the last one',
        params: {}
    },
    memory: {
        label: 'memory',
        group: 'memory',
        inputs: 3,
        outputs: 1,
        doc: 'input 1 stores and sends; input 2 stores quietly; input 3 (not 0) sends what is stored',
        params: { start: { type: 'number', label: 'start', default: 0 } }
    },
    var_set: {
        label: 'set var',
        group: 'memory',
        inputs: 1,
        outputs: 0,
        doc: 'stores a value under a name; every get var with that name sends it on (no wire needed). With keep ticked, the value is kept on the device and comes back when the patch starts again, even after a power cut: written only when it changed, at most once a minute',
        params: {
            name: { type: 'text', label: 'name', default: 'x' },
            keep: { type: 'check', label: 'keep', default: 'no', help: 'kept on the device, back at the next start' }
        }
    },
    var_get: {
        label: 'get var',
        group: 'memory',
        inputs: 0,
        outputs: 1,
        doc: 'sends the value each time a set var with the same name stores one, and when the patch starts (a kept value too)',
        params: { name: { type: 'text', label: 'name', default: 'x' } }
    },
    enc_label: {
        label: 'enc label',
        group: 'screen',
        inputs: 1,
        outputs: 0,
        doc: 'a name over an encoder (top row) with its value as a line; turning shows the number for a moment',
        params: {
            label: { type: 'text', label: 'label', default: 'cutoff' },
            as: AS,
            ...place('top', 1),
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 127, wire: true }
        }
    },
    key_label: {
        label: 'key label',
        group: 'screen',
        inputs: 1,
        outputs: 0,
        doc: 'a name over a key (bottom row), shown inverted while its input is not 0 (wire a key or a toggle)',
        params: {
            label: { type: 'text', label: 'label', default: 'play' },
            ...place('bottom', 1)
        }
    },
    slider: {
        label: 'slider',
        group: 'screen',
        inputs: 1,
        outputs: 0,
        doc: 'a vertical bar with its name and value',
        params: {
            label: { type: 'text', label: 'label', default: 'level' },
            as: AS,
            ...place('middle', 1),
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 127, wire: true }
        }
    },
    bars: {
        label: 'bars',
        group: 'screen',
        inputs: 4,
        outputs: 0,
        doc: 'up to four thin vertical bars, one per input, side by side: two of one column each put eight values (E5–E12) on half the screen. In the full middle row its name sits under them, and the bar just moved shows its number there for a moment',
        params: {
            label: { type: 'text', label: 'label', default: 'E5-E8' },
            as: AS,
            bars: { type: 'int', label: 'bars', default: 4, min: 1, max: 4 },
            style: { type: 'select', label: 'style', default: 'frame', options: ['frame', 'solid'] },
            ...place('middle', 1),
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 127, wire: true }
        }
    },
    knob: {
        label: 'knob',
        group: 'screen',
        inputs: 1,
        outputs: 0,
        doc: 'an arc with the value inside and the name under it (largest in the full middle row)',
        params: {
            label: { type: 'text', label: 'label', default: 'res' },
            as: AS,
            ...place('middle', 1),
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 127, wire: true }
        }
    },
    number: {
        label: 'number',
        group: 'screen',
        inputs: 1,
        outputs: 0,
        doc: 'a name and its value as text',
        params: {
            label: { type: 'text', label: 'label', default: 'bpm' },
            as: AS,
            ...place('middle top', 1)
        }
    },
    graph: {
        label: 'graph',
        group: 'screen',
        inputs: 1,
        outputs: 0,
        doc: 'the last values as a line scrolling from the right (an LFO, a CC)',
        params: {
            label: { type: 'text', label: 'label', default: 'lfo' },
            ...place('middle', 2),
            lo: { type: 'number', label: 'lo', default: 0, wire: true },
            hi: { type: 'number', label: 'hi', default: 1, wire: true }
        }
    },
    steps: {
        label: 'steps',
        group: 'screen',
        inputs: 5,
        outputs: 3,
        doc: "a step sequencer of up to 64 steps, each with a note, drawn as bars. *Step input* is the playing step (a counter), or with 'input 1 is' set to beat, a beat (a metro, clock in) that moves to the next step. Each step sends its note and, if it is on, a gate; step output is the step number. Its keys show a page of steps: a press turns a step on or off; an encoder wired to *edit input* then sets that step's note (for 2 seconds after the press, or while the key is held); otherwise it transposes them all. *Flip input* takes a step number and turns that step on or off. *Page input* picks the page the keys show, counting steps through auto, page 1, page 2...: positive is the next page, negative the previous (wire an encoder, a key for next on each push or a key thru 'math x -1' op for previous). *Length input* sets the length, 1 to 64 (from a value block); see guide for more recipes",
        params: {
            steps: { type: 'int', label: 'steps', default: 8, min: 1, max: 64 },
            advance: { type: 'select', label: 'input is', default: 'step number', options: ['step number', 'beat'] },
            note: { type: 'int', label: 'note', default: 60, min: 0, max: 127 },
            lo: { type: 'int', label: 'lo', default: 48, min: 0, max: 127, wire: true },
            hi: { type: 'int', label: 'hi', default: 72, min: 0, max: 127, wire: true },
            keys: {
                type: 'select',
                label: 'keys',
                default: 'K5-K8 K10-K13',
                options: ['none', 'K1-K4', 'K5-K8', 'K10-K13', 'K5-K8 K10-K13']
            },
            ...place('middle top', 4)
        }
    },
    draw: {
        label: 'draw',
        group: 'screen',
        inputs: 2,
        outputs: 0,
        doc: "your own Lua drawing its place on the screen: w and h (its size), a and b (inputs 1 and 2), s (kept between draws), t (ticks, 50 a second), and text(x, y, s), line(x1, y1, x2, y2), rect(x, y, w, h, fill), pixel(x, y), width(s), in the block's own pixels from its top left (a last argument of 0 draws black). It draws again when an input comes, or every frame with redraw: always",
        params: {
            code: {
                type: 'code',
                label: 'code',
                default:
                    'local f = math.max(0, math.min(1, a / 127))\nrect(0, 0, w - 2, h)\nrect(1, h - 1 - f * (h - 2), w - 4, f * (h - 2), true)'
            },
            redraw: { type: 'select', label: 'redraw', default: 'on input', options: ['on input', 'always'] },
            ...place('middle', 1)
        }
    },
    text: {
        label: 'text',
        group: 'screen',
        inputs: 0,
        outputs: 0,
        doc: 'fixed words, e.g. a title',
        params: {
            text: { type: 'text', label: 'text', default: 'achene' },
            ...place('middle top', 2)
        }
    },
    watch: {
        label: 'watch',
        group: 'output',
        inputs: 1,
        outputs: 1,
        doc: 'passes values unchanged and shows the values on the block with a graph (updated 10 times a second at most)',
        view: 'watch',
        params: {}
    },
    print: {
        label: 'print',
        group: 'output',
        inputs: 1,
        outputs: 0,
        doc: "prints values in greenhouse's console, at most 10 times a second",
        params: { label: { type: 'text', label: 'label', default: 'value' } }
    },
    lua: {
        label: 'lua',
        group: 'custom',
        inputs: 2,
        outputs: 2,
        doc: 'your own code, run for each message: i (the input), v (the value), out(n, value), s (kept between calls)',
        params: { code: { type: 'code', label: 'code', default: 'out(1, v * 2)' } }
    }
};

/**
 * The settings a wire can set, in the order of their inputs: input
 * block.inputs + 1 is the first.
 * @param {string} type
 * @returns {[string, Param][]}
 */
export function wiredParams(type) {
    return Object.entries(BLOCKS[type]?.params || {}).filter(([, p]) => p.wire);
}

/**
 * How many inputs a block has on the canvas: its own and one per setting a wire can set.
 * @param {string} type
 */
export function inputCount(type) {
    const block = BLOCKS[type];
    return block ? block.inputs + wiredParams(type).length : 0;
}

/**
 * What the runtime needs to know of the settings wires set, for the block
 * types given: one B.wired line each, name, lo, hi and whether whole, for
 * each (false where there is no limit).
 * @param {Iterable<string>} types
 */
export function wiredLua(types) {
    const lines = [];
    for (const type of types) {
        const list = wiredParams(type).map(([key, p]) =>
            [`"${key}"`, p.min ?? 'false', p.max ?? 'false', p.type === 'int'].join(',')
        );
        if (list.length)
            lines.push(`B.wired("${type}",{${list.join(',')}})
`);
    }
    return lines.join('');
}

/** @param {string} type */
export function defaultParams(type) {
    const block = BLOCKS[type];
    /** @type {Record<string, number | string>} */
    const params = {};
    for (const [key, param] of Object.entries(block?.params || {})) params[key] = param.default;
    return params;
}

/**
 * A parameter as Lua: numbers as numbers (clamped, ints rounded), text and
 * choices as quoted strings with only safe characters.
 * @param {Param} param @param {unknown} value
 */
export function luaParam(param, value) {
    if (param.type === 'int' || param.type === 'number') {
        let n = Number(value);
        if (!Number.isFinite(n)) n = Number(param.default);
        if (param.min !== undefined) n = Math.max(param.min, n);
        if (param.max !== undefined) n = Math.min(param.max, n);
        if (param.type === 'int') n = Math.round(n);
        return String(n);
    }
    if (param.type === 'code') return luaCode(value ?? param.default);
    let text = String(value ?? param.default);
    if (param.type === 'select' && !param.options?.includes(text)) text = String(param.default);
    if (param.type === 'select' && /^\d+$/.test(text)) return text;
    // printable ASCII without quotes or backslashes, so it's always valid Lua
    text = text.replace(/[^ -~]|["\\]/g, '').slice(0, param.len ?? 20);
    return `"${text}"`;
}

/** Longest code a lua block takes: its B.node line must stay under iii's 512. */
export const CODE_MAX = 360;

/**
 * Code for a lua block as one Lua string: newlines and tabs as escapes,
 * quotes and backslashes escaped, other control characters dropped.
 * @param {unknown} value
 */
export function luaCode(value) {
    const code = String(value).replace(/\r\n?/g, '\n').slice(0, CODE_MAX);
    const escaped = code
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/[\x00-\x1f\x7f]/g, '');
    return `"${escaped}"`;
}

/**
 * A node's parameters as a Lua table, e.g. {n = 5, cc = 20}.
 * @param {string} type @param {Record<string, unknown>} values
 */
export function luaParams(type, values) {
    const block = BLOCKS[type];
    if (!block) return '{}';
    const parts = Object.entries(block.params).map(([key, param]) => `${key} = ${luaParam(param, values?.[key])}`);
    return `{${parts.join(', ')}}`;
}

/**
 * @typedef {object} PatchNode
 * @property {number} id
 * @property {string} type
 * @property {Record<string, unknown>} params
 * @property {number} [x]
 * @property {number} [y]
 * @property {Record<string, unknown>} [state] what the block remembered on the device (a pattern, a value)
 *
 * @typedef {object} Patch
 * @property {PatchNode[]} nodes
 * @property {[number, number, number, number][]} wires from, output, to, input
 * @property {number} [rt] the runtime version it was made with (files)
 */

/**
 * A JSON value as a Lua literal: numbers, booleans, strings (printable
 * ASCII without quotes), arrays and objects with plain keys.
 * @param {unknown} v
 * @returns {string}
 */
function luaValue(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return `"${v.replace(/[^ -~]|["\\]/g, '')}"`;
    if (Array.isArray(v)) return `{${v.map(luaValue).join(', ')}}`;
    if (v && typeof v === 'object') {
        const parts = Object.entries(v)
            .filter(([k]) => /^[A-Za-z_]\w*$/.test(k))
            .map(([k, x]) => `${k} = ${luaValue(x)}`);
        return `{${parts.join(', ')}}`;
    }
    return 'nil';
}

/**
 * A block's remembered state as a Lua table, or '' when there is none or
 * it would not fit one line to the device.
 * @param {PatchNode} n
 */
export function luaState(n) {
    if (!n.state || typeof n.state !== 'object') return '';
    const lua = luaValue(n.state);
    return lua.length > 400 ? '' : lua;
}

/**
 * The device a patch is for, from its blocks: 'achene' (achene or screen
 * blocks), 'grid' (grid blocks), 'mixed' (both) or null (shared blocks only,
 * for any iii device).
 * @param {Patch} patch
 * @returns {'achene' | 'grid' | 'mixed' | null}
 */
export function patchDevice(patch) {
    let achene = false;
    let grid = false;
    for (const n of patch.nodes) {
        const group = BLOCKS[n.type]?.group;
        if (group === 'achene' || group === 'screen') achene = true;
        if (group === 'grid') grid = true;
    }
    if (achene && grid) return 'mixed';
    return achene ? 'achene' : grid ? 'grid' : null;
}

/**
 * What would go wrong opening a patch here: blocks this greenhouse doesn't know,
 * a newer runtime than it carries, or blocks for another device.
 * @param {Patch} patch
 * @param {'achene' | 'grid' | null} [device] the device it would run on
 * @returns {string[]}
 */
export function patchProblems(patch, device) {
    const problems = [];
    const made = patchDevice(patch);
    if (device && made && made !== device) {
        problems.push(
            made === 'mixed'
                ? `it has both achene and grid blocks: on this ${device}, the ${device === 'grid' ? 'achene' : 'grid'} ones do nothing`
                : `it was made for ${made === 'grid' ? 'a grid' : 'achene'}: on this ${device}, its ${made} blocks do nothing`
        );
    }
    const unknown = [...new Set(patch.nodes.filter((n) => !BLOCKS[n.type]).map((n) => n.type))];
    if (unknown.length) problems.push(`blocks this greenhouse doesn't know (left out): ${unknown.join(', ')}`);
    if (patch.rt && patch.rt > RUNTIME_VERSION) {
        problems.push(
            `made with a newer runtime (v${patch.rt}; this greenhouse has v${RUNTIME_VERSION}): reload greenhouse for the newest`
        );
    }
    return problems;
}

/** The lines that rebuild a patch live on a device with the runtime loaded. */
/** @param {Patch} patch */
export function liveLines(patch) {
    return [
        'B.clear()',
        ...patch.nodes.map((n) => `B.node(${n.id}, "${n.type}", ${luaParams(n.type, n.params)})`),
        ...patch.nodes.filter((n) => luaState(n)).map((n) => `B.load(${n.id}, ${luaState(n)})`),
        ...patch.wires.map((w) => `B.wire(${w.join(', ')})`),
        'B.start()'
    ];
}

/**
 * A patch as a script file: the editor's copy in --@patch comment lines,
 * the runtime built for it (buildRuntime), then the Lua that runs it. It
 * needs nothing else on the device. Every line stays well under iii's 512.
 * @param {string} name @param {Patch} patch
 * @param {{ text: string, parts: string[] }} runtime
 */
export function patchFile(name, patch, runtime) {
    const json = JSON.stringify({ v: 1, rt: RUNTIME_VERSION, nodes: patch.nodes, wires: patch.wires });
    const lines = [
        `-- graft patch: ${name.replace(/[^ -~]/g, '')}`,
        "-- made in graft, greenhouse's patch editor; open it there to change it"
    ];
    for (let i = 0; i < json.length; i += 300) lines.push(`--@patch ${json.slice(i, i + 300)}`);
    lines.push(
        `-- the blocks runtime v${RUNTIME_VERSION} it runs on, built by greenhouse with: ${runtime.parts.join(' ')}`,
        runtime.text.trimEnd(),
        'B.patch{',
        '  nodes = {'
    );
    for (const n of patch.nodes) {
        const state = luaState(n);
        lines.push(`    {${n.id}, "${n.type}", ${luaParams(n.type, n.params)}${state ? `, ${state}` : ''}},`);
    }
    lines.push('  },', '  wires = {');
    for (const w of patch.wires) lines.push(`    {${w.join(', ')}},`);
    lines.push('  },', '}', '');
    return lines.join('\n');
}

/**
 * The patch saved in a file's --@patch lines, or null.
 * @param {string} text
 * @returns {Patch | null}
 */
export function readPatchFile(text) {
    const json = String(text)
        .split(/\r?\n/)
        .filter((line) => line.startsWith('--@patch '))
        .map((line) => line.slice('--@patch '.length))
        .join('');
    if (!json) return null;
    try {
        const data = JSON.parse(json);
        if (!Array.isArray(data.nodes) || !Array.isArray(data.wires)) return null;
        return { nodes: data.nodes, wires: data.wires, rt: Number(data.rt) || 0 };
    } catch {
        return null;
    }
}

/** A first patch to play with: an encoder on a CC and the screen, a key on a note and its LED, an LFO on a CC. */
/** @returns {Patch} */
export function examplePatch() {
    return {
        nodes: [
            { id: 1, type: 'encoder', params: { n: 5 }, x: 30, y: 30 },
            { id: 2, type: 'accum', params: { lo: 0, hi: 127, start: 64 }, x: 230, y: 30 },
            { id: 3, type: 'midi_cc', params: { cc: 20, ch: 1 }, x: 460, y: 10 },
            { id: 4, type: 'display', params: { label: 'cutoff', slot: 1, lo: 0, hi: 127 }, x: 460, y: 130 },
            { id: 5, type: 'key', params: { n: 5 }, x: 30, y: 260 },
            { id: 6, type: 'toggle', params: {}, x: 230, y: 260 },
            { id: 7, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 460, y: 280 },
            { id: 8, type: 'key_led', params: { n: 5, colour: 'amber' }, x: 460, y: 410 },
            { id: 9, type: 'lfo', params: { rate: 0.25, shape: 'triangle' }, x: 30, y: 560 },
            { id: 10, type: 'scale', params: { in_lo: 0, in_hi: 1, out_lo: 0, out_hi: 127 }, x: 230, y: 540 },
            { id: 11, type: 'midi_cc', params: { cc: 21, ch: 1 }, x: 460, y: 550 },
            { id: 12, type: 'display', params: { label: 'lfo', slot: 2, lo: 0, hi: 127 }, x: 680, y: 540 }
        ],
        wires: [
            [1, 1, 2, 1],
            [2, 1, 3, 1],
            [2, 1, 4, 1],
            [5, 1, 6, 1],
            [6, 1, 7, 1],
            [6, 1, 8, 1],
            [9, 1, 10, 1],
            [10, 1, 11, 1],
            [10, 1, 12, 1]
        ]
    };
}

/**
 * An arpeggio from a lua block: a metro steps a counter through 8 steps;
 * the lua block turns each step into a note of an arpeggio, transposed by
 * E5; quantize keeps it in C minor; the metro's beat plays it.
 * @returns {Patch}
 */
export function arpPatch() {
    const code = [
        'if i == 2 then s.t = v return end',
        'local arp = {0, 3, 7, 10, 12, 10, 7, 3}',
        'out(1, 48 + (s.t or 0) + arp[v])'
    ].join('\n');
    return {
        nodes: [
            { id: 1, type: 'metro', params: { ms: 250 }, x: 30, y: 40 },
            { id: 2, type: 'counter', params: { lo: 1, hi: 8, step: 1 }, x: 230, y: 40 },
            { id: 3, type: 'lua', params: { code }, x: 450, y: 30 },
            { id: 4, type: 'quantize', params: { scale: 'minor', root: 0 }, x: 760, y: 40 },
            { id: 5, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 980, y: 40 },
            { id: 6, type: 'encoder', params: { n: 5 }, x: 30, y: 300 },
            { id: 7, type: 'accum', params: { lo: 0, hi: 12, start: 0 }, x: 230, y: 280 },
            { id: 8, type: 'display', params: { label: 'step', slot: 1, lo: 1, hi: 8 }, x: 760, y: 220 },
            { id: 9, type: 'display', params: { label: 'transpose', slot: 2, lo: 0, hi: 12 }, x: 450, y: 300 }
        ],
        wires: [
            [1, 1, 2, 1],
            [1, 1, 5, 1],
            [2, 1, 3, 1],
            [2, 1, 8, 1],
            [3, 1, 4, 1],
            [4, 1, 5, 2],
            [6, 1, 7, 1],
            [7, 1, 3, 2],
            [7, 1, 9, 1]
        ]
    };
}

/**
 * A 16-step note sequencer with the screen as its face. K1 starts and stops
 * it. The steps are drawn across the middle as bars as tall as their notes,
 * and played from the eight keys under E5-E12 (two pages of eight; the keys
 * follow the playing page, their LEDs show the steps; E4 picks a page to
 * edit instead, and back to auto). Press a key to turn its step on or off,
 * then turn E1 to set its note; E1 alone transposes.
 * Notes snap to C minor. E2 sends a filter cutoff CC, E3 resonance; each is
 * named over its encoder, with the playing step's number beside them.
 * @returns {Patch}
 */
export function sequencerPatch() {
    return {
        nodes: [
            { id: 1, type: 'key', params: { n: 1 }, x: 20, y: 20 },
            { id: 2, type: 'toggle', params: {}, x: 190, y: 20 },
            { id: 3, type: 'key_label', params: { label: 'run', where: 'bottom', col: 1, span: 1 }, x: 400, y: 0 },
            { id: 4, type: 'metro', params: { ms: 150 }, x: 400, y: 190 },
            { id: 5, type: 'counter', params: { lo: 1, hi: 16, step: 1 }, x: 590, y: 190 },
            {
                id: 6,
                type: 'steps',
                params: {
                    steps: 16,
                    note: 60,
                    lo: 48,
                    hi: 72,
                    keys: 'K5-K8 K10-K13',
                    where: 'middle top',
                    col: 1,
                    span: 4
                },
                x: 800,
                y: 120
            },
            { id: 7, type: 'quantize', params: { scale: 'minor', root: 0 }, x: 1080, y: 230 },
            { id: 8, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 1300, y: 150 },
            { id: 9, type: 'encoder', params: { n: 1 }, x: 590, y: 30 },
            {
                id: 10,
                type: 'enc_label',
                params: { label: 'note', where: 'top', col: 1, span: 1, lo: 48, hi: 72 },
                x: 1300,
                y: 330
            },
            {
                id: 11,
                type: 'number',
                params: { label: 'step', where: 'middle bottom', col: 4, span: 1 },
                x: 1080,
                y: 430
            },
            { id: 12, type: 'encoder', params: { n: 2 }, x: 20, y: 470 },
            { id: 13, type: 'accum', params: { lo: 0, hi: 127, start: 80 }, x: 190, y: 460 },
            { id: 14, type: 'midi_cc', params: { cc: 74, ch: 1 }, x: 400, y: 470 },
            {
                id: 15,
                type: 'enc_label',
                params: { label: 'cutoff', where: 'top', col: 2, span: 1, lo: 0, hi: 127 },
                x: 590,
                y: 440
            },
            {
                id: 16,
                type: 'knob',
                params: { label: 'cut', where: 'middle bottom', col: 2, span: 1, lo: 0, hi: 127 },
                x: 800,
                y: 470
            },
            { id: 17, type: 'encoder', params: { n: 3 }, x: 20, y: 720 },
            { id: 18, type: 'accum', params: { lo: 0, hi: 127, start: 30 }, x: 190, y: 710 },
            { id: 19, type: 'midi_cc', params: { cc: 71, ch: 1 }, x: 400, y: 720 },
            {
                id: 20,
                type: 'enc_label',
                params: { label: 'res', where: 'top', col: 3, span: 1, lo: 0, hi: 127 },
                x: 590,
                y: 690
            },
            {
                id: 21,
                type: 'knob',
                params: { label: 'res', where: 'middle bottom', col: 3, span: 1, lo: 0, hi: 127 },
                x: 800,
                y: 720
            },
            { id: 22, type: 'text', params: { text: 'page', where: 'top', col: 4, span: 1 }, x: 1300, y: 560 },
            { id: 23, type: 'encoder', params: { n: 4 }, x: 400, y: 330 }
        ],
        wires: [
            [1, 1, 2, 1],
            [2, 1, 3, 1],
            [2, 1, 4, 1],
            [4, 1, 5, 1],
            [5, 1, 6, 1],
            [6, 1, 8, 1],
            [6, 2, 7, 1],
            [7, 1, 8, 2],
            [7, 1, 10, 1],
            [6, 3, 11, 1],
            [9, 1, 6, 3],
            [23, 1, 6, 4],
            [12, 1, 13, 1],
            [13, 1, 14, 1],
            [13, 1, 15, 1],
            [13, 1, 16, 1],
            [17, 1, 18, 1],
            [18, 1, 19, 1],
            [18, 1, 20, 1],
            [18, 1, 21, 1]
        ]
    };
}

/**
 * The screen as a controller's face: E1-E4 send four CCs (cutoff,
 * resonance, attack, release), each named over its encoder with a knob or
 * slider under it that follows the value; K1 toggles sustain (CC 64),
 * labelled hold, lit while it's on.
 * @returns {Patch}
 */
export function controllerPatch() {
    const lanes = [
        { n: 1, cc: 74, label: 'cutoff', short: 'cut', start: 64, show: 'knob' },
        { n: 2, cc: 71, label: 'reso', short: 'res', start: 20, show: 'knob' },
        { n: 3, cc: 73, label: 'attack', short: 'atk', start: 10, show: 'slider' },
        { n: 4, cc: 72, label: 'release', short: 'rel', start: 50, show: 'slider' }
    ];
    /** @type {Patch['nodes']} */
    const nodes = [];
    /** @type {Patch['wires']} */
    const wires = [];
    lanes.forEach((l, k) => {
        const id = 1 + k * 5;
        const y = k * 240;
        nodes.push(
            { id, type: 'encoder', params: { n: l.n }, x: 20, y: y + 20 },
            { id: id + 1, type: 'accum', params: { lo: 0, hi: 127, start: l.start }, x: 190, y: y + 10 },
            { id: id + 2, type: 'midi_cc', params: { cc: l.cc, ch: 1 }, x: 400, y: y + 20 },
            {
                id: id + 3,
                type: 'enc_label',
                params: { label: l.label, where: 'top', col: l.n, span: 1, lo: 0, hi: 127 },
                x: 600,
                y
            },
            {
                id: id + 4,
                type: l.show,
                params: { label: l.short, where: 'middle', col: l.n, span: 1, lo: 0, hi: 127 },
                x: 820,
                y
            }
        );
        wires.push([id, 1, id + 1, 1], [id + 1, 1, id + 2, 1], [id + 1, 1, id + 3, 1], [id + 1, 1, id + 4, 1]);
    });
    nodes.push(
        { id: 21, type: 'key', params: { n: 1 }, x: 1060, y: 20 },
        { id: 22, type: 'toggle', params: {}, x: 1230, y: 20 },
        { id: 23, type: 'math', params: { op: '*', b: 127 }, x: 1230, y: 160 },
        { id: 24, type: 'midi_cc', params: { cc: 64, ch: 1 }, x: 1440, y: 170 },
        { id: 25, type: 'key_label', params: { label: 'hold', where: 'bottom', col: 1, span: 1 }, x: 1440, y: 0 }
    );
    wires.push([21, 1, 22, 1], [22, 1, 23, 1], [23, 1, 24, 1], [22, 1, 25, 1]);
    return { nodes, wires };
}

/**
 * One set of encoders, two jobs: K2 toggles edit mode (its label lit). In
 * play mode E1 and E2 send cutoff and resonance; in edit mode E1 sets the
 * notes of a 16-step sequencer (press a step key under E5-E12, then turn)
 * and E2 picks the page the keys show. route blocks do the switching. K1
 * starts and stops the sequencer.
 * @returns {Patch}
 */
export function modesPatch() {
    return {
        nodes: [
            { id: 1, type: 'key', params: { n: 1 }, x: 20, y: 20 },
            { id: 2, type: 'toggle', params: {}, x: 190, y: 20 },
            { id: 3, type: 'key_label', params: { label: 'run', where: 'bottom', col: 1, span: 1 }, x: 400, y: 0 },
            { id: 4, type: 'metro', params: { ms: 150 }, x: 400, y: 170 },
            { id: 5, type: 'counter', params: { lo: 1, hi: 16, step: 1 }, x: 590, y: 170 },
            {
                id: 6,
                type: 'steps',
                params: {
                    steps: 16,
                    note: 60,
                    lo: 48,
                    hi: 72,
                    keys: 'K5-K8 K10-K13',
                    where: 'middle top',
                    col: 1,
                    span: 4
                },
                x: 1010,
                y: 120
            },
            { id: 7, type: 'quantize', params: { scale: 'minor', root: 0 }, x: 1290, y: 220 },
            { id: 8, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 1500, y: 150 },
            { id: 9, type: 'key', params: { n: 2 }, x: 20, y: 330 },
            { id: 10, type: 'toggle', params: {}, x: 190, y: 330 },
            { id: 11, type: 'key_label', params: { label: 'edit', where: 'bottom', col: 2, span: 1 }, x: 400, y: 330 },
            { id: 12, type: 'encoder', params: { n: 1 }, x: 20, y: 500 },
            { id: 13, type: 'route', params: {}, x: 590, y: 490 },
            { id: 14, type: 'accum', params: { lo: 0, hi: 127, start: 80 }, x: 800, y: 470 },
            { id: 15, type: 'midi_cc', params: { cc: 74, ch: 1 }, x: 1010, y: 480 },
            {
                id: 16,
                type: 'enc_label',
                params: { label: 'cutoff', where: 'top', col: 1, span: 1, lo: 0, hi: 127 },
                x: 1010,
                y: 600
            },
            {
                id: 17,
                type: 'knob',
                params: { label: 'cut', where: 'middle bottom', col: 1, span: 1, lo: 0, hi: 127 },
                x: 1290,
                y: 560
            },
            { id: 18, type: 'encoder', params: { n: 2 }, x: 20, y: 760 },
            { id: 19, type: 'route', params: {}, x: 590, y: 750 },
            { id: 20, type: 'accum', params: { lo: 0, hi: 127, start: 30 }, x: 800, y: 790 },
            { id: 21, type: 'midi_cc', params: { cc: 71, ch: 1 }, x: 1010, y: 820 },
            {
                id: 22,
                type: 'enc_label',
                params: { label: 'res', where: 'top', col: 2, span: 1, lo: 0, hi: 127 },
                x: 1010,
                y: 940
            },
            {
                id: 23,
                type: 'knob',
                params: { label: 'res', where: 'middle bottom', col: 2, span: 1, lo: 0, hi: 127 },
                x: 1290,
                y: 860
            },
            {
                id: 24,
                type: 'number',
                params: { label: 'step', where: 'middle bottom', col: 4, span: 1 },
                x: 1500,
                y: 360
            }
        ],
        wires: [
            [1, 1, 2, 1],
            [2, 1, 3, 1],
            [2, 1, 4, 1],
            [4, 1, 5, 1],
            [5, 1, 6, 1],
            [6, 2, 7, 1],
            [7, 1, 8, 2],
            [6, 1, 8, 1],
            [6, 3, 24, 1],
            [9, 1, 10, 1],
            [10, 1, 11, 1],
            [10, 1, 13, 2],
            [10, 1, 19, 2],
            [12, 1, 13, 1],
            [13, 1, 14, 1],
            [14, 1, 15, 1],
            [14, 1, 16, 1],
            [14, 1, 17, 1],
            [13, 2, 6, 3],
            [18, 1, 19, 1],
            [19, 1, 20, 1],
            [20, 1, 21, 1],
            [20, 1, 22, 1],
            [20, 1, 23, 1],
            [19, 2, 6, 4]
        ]
    };
}

/**
 * Small wirings for the patching guide, each a patch of its own that the
 * guide adds to the canvas.
 * @type {{ name: string, title: string, chain: string, text: string, patch: Patch }[]}
 */
export const RECIPES = [
    {
        name: 'cc',
        title: 'An encoder sends a CC',
        chain: 'encoder → value → midi cc (and enc label)',
        text: 'An encoder sends steps (+1, −2…), not a position: value adds them up and keeps the total in its range. The enc label names it on the screen, over E1.',
        patch: {
            nodes: [
                { id: 1, type: 'encoder', params: { n: 1 }, x: 0, y: 0 },
                { id: 2, type: 'accum', params: { lo: 0, hi: 127, start: 64 }, x: 170, y: 0 },
                { id: 3, type: 'midi_cc', params: { cc: 74, ch: 1 }, x: 380, y: 0 },
                {
                    id: 4,
                    type: 'enc_label',
                    params: { label: 'cutoff', where: 'top', col: 1, span: 1, lo: 0, hi: 127 },
                    x: 380,
                    y: 110
                }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [2, 1, 4, 1]
            ]
        }
    },
    {
        name: 'note',
        title: 'A key plays a note and lights up',
        chain: 'key → midi note, key → key led',
        text: 'A key sends 1 when pressed and 0 when let go: midi note plays while it gets 1, key led lights at the value (0 to 1) as its brightness. One output can feed any number of inputs.',
        patch: {
            nodes: [
                { id: 1, type: 'key', params: { n: 5 }, x: 0, y: 0 },
                { id: 2, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 190, y: 0 },
                { id: 3, type: 'key_led', params: { n: 5, colour: 'cyan' }, x: 190, y: 150 }
            ],
            wires: [
                [1, 1, 2, 1],
                [1, 1, 3, 1]
            ]
        }
    },
    {
        name: 'switch',
        title: 'A key as an on/off switch',
        chain: 'key → toggle → key led, toggle → math (× 127) → midi cc',
        text: "toggle flips between 0 and 1 on each press (a release's 0 does nothing), so the key latches. math scales the 1 to a CC's 127, here sustain (CC 64).",
        patch: {
            nodes: [
                { id: 1, type: 'key', params: { n: 6 }, x: 0, y: 0 },
                { id: 2, type: 'toggle', params: {}, x: 170, y: 0 },
                { id: 3, type: 'key_led', params: { n: 6, colour: 'amber' }, x: 360, y: 0 },
                { id: 4, type: 'math', params: { op: '*', b: 127 }, x: 360, y: 130 },
                { id: 5, type: 'midi_cc', params: { cc: 64, ch: 1 }, x: 570, y: 130 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [2, 1, 4, 1],
                [4, 1, 5, 1]
            ]
        }
    },
    {
        name: 'lfo',
        title: 'An LFO moves a CC',
        chain: 'lfo → scale → midi cc, scale → watch',
        text: 'An LFO sends 0 to 1, fifty times a second; scale maps it to the range you want (here 20 to 100). MIDI outputs send at most once a tick, so it can not flood a synth. watch shows the values on the canvas while it runs.',
        patch: {
            nodes: [
                { id: 1, type: 'lfo', params: { rate: 0.5, shape: 'sine' }, x: 0, y: 0 },
                { id: 2, type: 'scale', params: { in_lo: 0, in_hi: 1, out_lo: 20, out_hi: 100 }, x: 190, y: 0 },
                { id: 3, type: 'midi_cc', params: { cc: 1, ch: 1 }, x: 400, y: 0 },
                { id: 4, type: 'watch', params: {}, x: 400, y: 110 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [2, 1, 4, 1]
            ]
        }
    },
    {
        name: 'random',
        title: 'Random notes on a beat',
        chain: 'metro → random → quantize → midi note (2), metro → midi note (1)',
        text: "The metro's 1 picks a random note and then plays it: wires leave an output in the order they were made, so the note reaches midi note's input 2 before the beat reaches input 1. quantize keeps it in a scale.",
        patch: {
            nodes: [
                { id: 1, type: 'metro', params: { ms: 250 }, x: 0, y: 0 },
                { id: 2, type: 'random', params: { lo: 48, hi: 72 }, x: 180, y: 90 },
                { id: 3, type: 'quantize', params: { scale: 'minor pent.', root: 0 }, x: 380, y: 90 },
                { id: 4, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 600, y: 0 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [3, 1, 4, 2],
                [1, 1, 4, 1]
            ]
        }
    },
    {
        name: 'clock',
        title: 'Follow a MIDI clock',
        chain: 'clock in → counter → steps → midi note',
        text: 'clock in turns the MIDI clock a DAW or drum machine sends into beats: div 6 is sixteenths (24 clocks to a quarter note). The counter counts them into steps, so the sequencer plays in time and starts where the clock starts.',
        patch: {
            nodes: [
                { id: 1, type: 'clock', params: { div: '6' }, x: 0, y: 0 },
                { id: 2, type: 'counter', params: { lo: 1, hi: 16, step: 1 }, x: 180, y: 0 },
                {
                    id: 3,
                    type: 'steps',
                    params: {
                        steps: 16,
                        note: 60,
                        lo: 48,
                        hi: 72,
                        keys: 'K5-K8 K10-K13',
                        where: 'middle top',
                        col: 1,
                        span: 4
                    },
                    x: 380,
                    y: 0
                },
                { id: 4, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 640, y: 0 }
            ],
            wires: [
                [1, 1, 2, 1],
                [1, 2, 2, 2],
                [2, 1, 3, 1],
                [3, 2, 4, 2],
                [3, 1, 4, 1]
            ]
        }
    },
    {
        name: 'pages',
        title: 'Pages from two keys (or an encoder)',
        chain: 'key K9 → steps page, key K14 → math (× −1) → steps page',
        text: "The page input counts steps: a positive number is the next page, a negative one the previous, 0 nothing. A key sends 1 on press (next) and 0 on release (ignored); math × −1 makes the other key's press a −1 (previous). An encoder wired straight in works too. Not through a value block: it sends its total, always positive, on every press and release, so each click would turn two pages forward.",
        patch: {
            nodes: [
                { id: 1, type: 'metro', params: { ms: 150 }, x: 0, y: 0 },
                {
                    id: 2,
                    type: 'steps',
                    params: { steps: 32, advance: 'beat', keys: 'K5-K8 K10-K13', where: 'middle top', col: 1, span: 4 },
                    x: 420,
                    y: 0
                },
                { id: 3, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 700, y: 0 },
                { id: 4, type: 'key', params: { n: 9 }, x: 0, y: 150 },
                { id: 5, type: 'key', params: { n: 14 }, x: 0, y: 260 },
                { id: 6, type: 'math', params: { op: '*', b: -1 }, x: 190, y: 250 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 2, 3, 2],
                [2, 1, 3, 1],
                [4, 1, 2, 4],
                [5, 1, 6, 1],
                [6, 1, 2, 4]
            ]
        }
    },
    {
        name: 'length',
        title: 'A sequence whose length you turn',
        chain: 'metro → steps (input 1 is: beat), encoder → value (1..64) → steps length',
        text: "With 'input 1 is' set to beat, each beat moves to the next step and wraps at the length, so no counter is needed. The length input takes a number of steps, so it goes through a value block (here 1 to 64, starting at 16); number shows it on the screen.",
        patch: {
            nodes: [
                { id: 1, type: 'metro', params: { ms: 150 }, x: 0, y: 0 },
                {
                    id: 2,
                    type: 'steps',
                    params: { steps: 16, advance: 'beat', keys: 'K5-K8 K10-K13', where: 'middle top', col: 1, span: 4 },
                    x: 420,
                    y: 0
                },
                { id: 3, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 700, y: 0 },
                { id: 4, type: 'encoder', params: { n: 4 }, x: 0, y: 200 },
                { id: 5, type: 'accum', params: { lo: 1, hi: 64, start: 16 }, x: 190, y: 190 },
                {
                    id: 6,
                    type: 'number',
                    params: { label: 'length', where: 'middle bottom', col: 4, span: 1 },
                    x: 700,
                    y: 200
                }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 2, 3, 2],
                [2, 1, 3, 1],
                [4, 1, 5, 1],
                [5, 1, 2, 5],
                [5, 1, 6, 1]
            ]
        }
    },
    {
        name: 'mix',
        title: 'An LFO around a knob',
        chain: 'lfo → scale → math a, encoder → value → math b, math → midi cc',
        text: "math's input 1 computes and sends, its input 2 only sets b: put the source that should send (the LFO) on input 1 and the setting (the encoder) on input 2. Here the LFO sways ±20 around where E2 is.",
        patch: {
            nodes: [
                { id: 1, type: 'lfo', params: { rate: 0.3, shape: 'triangle' }, x: 0, y: 0 },
                { id: 2, type: 'scale', params: { in_lo: 0, in_hi: 1, out_lo: -20, out_hi: 20 }, x: 180, y: 0 },
                { id: 3, type: 'encoder', params: { n: 2 }, x: 0, y: 190 },
                { id: 4, type: 'accum', params: { lo: 20, hi: 107, start: 64 }, x: 180, y: 190 },
                { id: 5, type: 'math', params: { op: '+', b: 64 }, x: 400, y: 60 },
                { id: 6, type: 'midi_cc', params: { cc: 71, ch: 1 }, x: 600, y: 60 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 5, 1],
                [3, 1, 4, 1],
                [4, 1, 5, 2],
                [5, 1, 6, 1]
            ]
        }
    },
    {
        name: 'var',
        title: 'A tempo shared without a wire',
        chain: 'encoder → value → set var "tempo" … get var "tempo" → metro (bpm), number',
        text: "set var stores a value under a name and every get var with that name sends it on, anywhere in the patch. Here E3 sets a tempo (60 to 200 BPM) that a metro's input 2 follows, four beats to a quarter note; K16's LED blinks with it.",
        patch: {
            nodes: [
                { id: 1, type: 'encoder', params: { n: 3 }, x: 0, y: 0 },
                { id: 2, type: 'accum', params: { lo: 60, hi: 200, start: 120 }, x: 170, y: 0 },
                { id: 3, type: 'var_set', params: { name: 'tempo' }, x: 380, y: 0 },
                { id: 4, type: 'var_get', params: { name: 'tempo' }, x: 0, y: 190 },
                {
                    id: 5,
                    type: 'number',
                    params: { label: 'tempo', where: 'middle top', col: 3, span: 1 },
                    x: 190,
                    y: 300
                },
                { id: 6, type: 'metro', params: { ms: 500, per: '4' }, x: 190, y: 170 },
                { id: 7, type: 'key_led', params: { n: 16, colour: 'green' }, x: 400, y: 170 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [4, 1, 5, 1],
                [4, 1, 6, 2],
                [6, 1, 7, 1]
            ]
        }
    },
    {
        name: 'route',
        title: 'One key, two jobs for an encoder',
        chain: 'key → toggle → route (2), encoder → route (1) → two values',
        text: 'route sends input 1 out of output 1 while input 2 is 0, out of output 2 otherwise. A toggle on a key picks the output, so E1 sends one CC or the other. The modes example does this for a sequencer.',
        patch: {
            nodes: [
                { id: 1, type: 'key', params: { n: 2 }, x: 0, y: 0 },
                { id: 2, type: 'toggle', params: {}, x: 170, y: 0 },
                { id: 3, type: 'key_label', params: { label: 'alt', where: 'bottom', col: 2, span: 1 }, x: 380, y: 0 },
                { id: 4, type: 'encoder', params: { n: 1 }, x: 0, y: 170 },
                { id: 5, type: 'route', params: {}, x: 380, y: 160 },
                { id: 6, type: 'accum', params: { lo: 0, hi: 127, start: 64 }, x: 580, y: 100 },
                { id: 7, type: 'midi_cc', params: { cc: 74, ch: 1 }, x: 790, y: 100 },
                { id: 8, type: 'accum', params: { lo: 0, hi: 127, start: 64 }, x: 580, y: 260 },
                { id: 9, type: 'midi_cc', params: { cc: 71, ch: 1 }, x: 790, y: 260 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [2, 1, 5, 2],
                [4, 1, 5, 1],
                [5, 1, 6, 1],
                [6, 1, 7, 1],
                [5, 2, 8, 1],
                [8, 1, 9, 1]
            ]
        }
    },
    {
        name: 'channel',
        title: 'A channel you turn, kept at power-off',
        chain: 'encoder → value (1..16) → set var ch (keep); get var ch → midi cc ch, value set',
        text: "A midi cc's ch has an input of its own (it shows while you draw a wire). E4 turns a value from 1 to 16 into the set var ch, with keep ticked: the channel is kept on the device (only when it changed, at most once a minute) and comes back when the patch starts, even after a power cut. get var ch sends it to the CC's ch and to the value's set input, so turning E4 goes on from the kept channel.",
        patch: {
            nodes: [
                { id: 1, type: 'encoder', params: { n: 1 }, x: 0, y: 0 },
                { id: 2, type: 'accum', params: { lo: 0, hi: 127, start: 64 }, x: 170, y: 0 },
                { id: 3, type: 'midi_cc', params: { cc: 74, ch: 1 }, x: 620, y: 0 },
                { id: 4, type: 'encoder', params: { n: 4 }, x: 0, y: 190 },
                { id: 5, type: 'accum', params: { lo: 1, hi: 16, start: 1 }, x: 170, y: 190 },
                { id: 6, type: 'var_set', params: { name: 'ch', keep: 'yes' }, x: 400, y: 190 },
                { id: 7, type: 'var_get', params: { name: 'ch' }, x: 0, y: 380 },
                {
                    id: 8,
                    type: 'enc_label',
                    params: { label: 'ch', where: 'top', col: 4, span: 1, lo: 1, hi: 16 },
                    x: 620,
                    y: 190
                }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [4, 1, 5, 1],
                [5, 1, 6, 1],
                [7, 1, 3, 3],
                [7, 1, 5, 2],
                [7, 1, 8, 1]
            ]
        }
    },
    {
        name: 'shift',
        title: 'A shift key: hold K4 for settings',
        chain: 'key K4 → page (hold); E1 on page 1 → a CC, E1 on page 2 → its channel',
        text: "A block's page setting puts it on one page: it acts and shows only while that page is shown, and always means every page. page in hold mode shows page 2 while K4 is held. E1 is two encoder blocks, one on each page, each with its own value, so the CC doesn't jump when you come back: on page 1 it turns the cutoff, on page 2 (K4 held) the channel, with its own label over E1.",
        patch: {
            nodes: [
                { id: 1, type: 'key', params: { n: 4, page: 'always' }, x: 0, y: 0 },
                { id: 2, type: 'page', params: { mode: 'hold', page: 2, pages: 2 }, x: 170, y: 0 },
                {
                    id: 3,
                    type: 'key_label',
                    params: { label: 'shift', where: 'bottom', col: 4, span: 1, page: 'always' },
                    x: 400,
                    y: 0
                },
                { id: 4, type: 'encoder', params: { n: 1, page: '1' }, x: 0, y: 200 },
                { id: 5, type: 'accum', params: { lo: 0, hi: 127, start: 64 }, x: 170, y: 200 },
                { id: 6, type: 'midi_cc', params: { cc: 74, ch: 1 }, x: 400, y: 200 },
                {
                    id: 7,
                    type: 'enc_label',
                    params: { label: 'cutoff', where: 'top', col: 1, span: 1, lo: 0, hi: 127, page: '1' },
                    x: 620,
                    y: 200
                },
                { id: 8, type: 'encoder', params: { n: 1, page: '2' }, x: 0, y: 420 },
                { id: 9, type: 'accum', params: { lo: 1, hi: 16, start: 1 }, x: 170, y: 420 },
                {
                    id: 10,
                    type: 'enc_label',
                    params: { label: 'ch', where: 'top', col: 1, span: 1, lo: 1, hi: 16, page: '2' },
                    x: 620,
                    y: 420
                }
            ],
            wires: [
                [1, 1, 2, 1],
                [1, 1, 3, 1],
                [4, 1, 5, 1],
                [5, 1, 6, 1],
                [5, 1, 7, 1],
                [8, 1, 9, 1],
                [9, 1, 6, 3],
                [9, 1, 10, 1]
            ]
        }
    },
    {
        name: 'bars',
        title: 'Thin bars for E5–E8',
        chain: 'encoders E5–E8 → values → bars (inputs 1–4) and midi cc',
        text: 'bars draws up to four thin bars side by side, one per input, in one column of the screen. Here E5 to E8 each turn a value that sends a CC and moves its bar; the bar just moved shows its number under them for a moment. A second bars block in column 4, fed by E9–E12, puts all eight on half the screen.',
        patch: {
            nodes: [
                ...[5, 6, 7, 8].flatMap((e, i) => [
                    { id: 1 + i * 3, type: 'encoder', params: { n: e }, x: 0, y: i * 130 },
                    { id: 2 + i * 3, type: 'accum', params: { lo: 0, hi: 127, start: 0 }, x: 170, y: i * 130 },
                    { id: 3 + i * 3, type: 'midi_cc', params: { cc: 20 + i, ch: 1 }, x: 400, y: i * 130 }
                ]),
                {
                    id: 13,
                    type: 'bars',
                    params: {
                        label: 'E5-E8',
                        bars: 4,
                        style: 'frame',
                        where: 'middle',
                        col: 3,
                        span: 1,
                        lo: 0,
                        hi: 127
                    },
                    x: 620,
                    y: 120
                }
            ],
            wires: [0, 1, 2, 3].flatMap((i) => [
                /** @type {[number, number, number, number]} */ ([1 + i * 3, 1, 2 + i * 3, 1]),
                /** @type {[number, number, number, number]} */ ([2 + i * 3, 1, 3 + i * 3, 1]),
                /** @type {[number, number, number, number]} */ ([2 + i * 3, 1, 13, i + 1])
            ])
        }
    },
    {
        name: 'gfader',
        title: 'A grid fader sends a CC',
        chain: 'fader → midi cc',
        text: 'A fader is a column (or row) of keys from lo to hi: a press sends the value of that key. Its size and place are its x, y, width and height, or drag it in the grid button. It sends its start value when the patch starts.',
        patch: {
            nodes: [
                {
                    id: 1,
                    type: 'gfader',
                    params: { lo: 0, hi: 127, start: 64, style: 'fill', orient: 'auto', x: 1, y: 1, w: 1, h: 8 },
                    x: 0,
                    y: 0
                },
                { id: 2, type: 'midi_cc', params: { cc: 74, ch: 1 }, x: 260, y: 0 }
            ],
            wires: [[1, 1, 2, 1]]
        }
    },
    {
        name: 'gbutton',
        title: 'Grid buttons play notes and toggle a CC',
        chain: 'button (momentary) → midi note; button (toggle) → math (× 127) → midi cc',
        text: 'A momentary button sends 1 while held and 0 when let go, just what midi note wants for its gate. A toggle flips between 1 and 0 on each press; math × 127 makes that a CC value (127 on, 0 off).',
        patch: {
            nodes: [
                { id: 1, type: 'gbutton', params: { mode: 'momentary', x: 1, y: 1, w: 1, h: 1 }, x: 0, y: 0 },
                { id: 2, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 260, y: 0 },
                { id: 3, type: 'gbutton', params: { mode: 'toggle', x: 2, y: 1, w: 1, h: 1 }, x: 0, y: 160 },
                { id: 4, type: 'math', params: { op: '*', b: 127 }, x: 260, y: 160 },
                { id: 5, type: 'midi_cc', params: { cc: 64, ch: 1 }, x: 460, y: 160 }
            ],
            wires: [
                [1, 1, 2, 1],
                [3, 1, 4, 1],
                [4, 1, 5, 1]
            ]
        }
    },
    {
        name: 'gback',
        title: 'A button that shows what the host says',
        chain: 'midi in cc → button input; button (toggle) → math (× 127) → midi cc',
        text: "A button's input lights it without sending. Wire a midi in cc for the same CC into it, and the button shows the state your DAW sends back, even when it was changed there.",
        patch: {
            nodes: [
                { id: 1, type: 'midi_in_cc', params: { cc: 20, ch: 1 }, x: 0, y: 0 },
                { id: 2, type: 'gbutton', params: { mode: 'toggle', x: 1, y: 1, w: 1, h: 1 }, x: 230, y: 0 },
                { id: 3, type: 'math', params: { op: '*', b: 127 }, x: 430, y: 0 },
                { id: 4, type: 'midi_cc', params: { cc: 20, ch: 1 }, x: 630, y: 0 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [3, 1, 4, 1]
            ]
        }
    },
    {
        name: 'gsteps',
        title: 'A step grid plays notes',
        chain: 'metro → steps (input 1 is: beat) → midi note (note, then gate)',
        text: "Each beat moves the steps one column on. A step with a key lit plays that row's note: the note goes to midi note's input 2 first, then the gate to its input 1. Press a key to put its step there, press it again to clear it.",
        patch: {
            nodes: [
                { id: 1, type: 'metro', params: { ms: 200, per: '1' }, x: 0, y: 0 },
                {
                    id: 2,
                    type: 'gsteps',
                    params: { steps: 8, advance: 'beat', note: 48, scale: 'minor pent.', x: 1, y: 1, w: 8, h: 5 },
                    x: 230,
                    y: 0
                },
                { id: 3, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 520, y: 0 }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 2, 3, 2],
                [2, 1, 3, 1]
            ]
        }
    },
    {
        name: 'gkeys',
        title: 'A keyboard with an octave fader',
        chain: 'fader (−24..24, dot) → keys (transpose)',
        text: 'keys plays MIDI by itself, several notes at once, so it needs no midi note block. A fader of five keys from −24 to 24 sends −24, −12, 0, 12 or 24: octaves, into its transpose input.',
        patch: {
            nodes: [
                {
                    id: 1,
                    type: 'gfader',
                    params: { lo: -24, hi: 24, start: 0, style: 'dot', orient: 'horizontal', x: 1, y: 8, w: 5, h: 1 },
                    x: 0,
                    y: 0
                },
                {
                    id: 2,
                    type: 'gkeys',
                    params: {
                        note: 48,
                        row: 5,
                        scale: 'major',
                        send: 'midi',
                        ch: 1,
                        vel: 100,
                        x: 1,
                        y: 1,
                        w: 16,
                        h: 7
                    },
                    x: 260,
                    y: 0
                }
            ],
            wires: [[1, 1, 2, 1]]
        }
    }
];

/**
 * A mixer on a 16x8 grid: four channel faders (two keys wide, seven tall)
 * on CC 7 of channels 1-4, each with a mute toggle under it (CC 20 on its
 * channel, 127 or 0, for a DAW to map), and a master fader on CC 7 of
 * channel 16.
 * @returns {Patch}
 */
export function gridMixerPatch() {
    /** @type {Patch['nodes']} */
    const nodes = [];
    /** @type {Patch['wires']} */
    const wires = [];
    for (let k = 0; k < 4; k++) {
        const id = 1 + k * 5;
        const y = k * 260;
        nodes.push(
            {
                id,
                type: 'gfader',
                params: { lo: 0, hi: 127, start: 96, style: 'fill', orient: 'auto', x: 1 + k * 2, y: 1, w: 2, h: 7 },
                x: 20,
                y
            },
            { id: id + 1, type: 'midi_cc', params: { cc: 7, ch: k + 1 }, x: 260, y },
            {
                id: id + 2,
                type: 'gbutton',
                params: { mode: 'toggle', x: 1 + k * 2, y: 8, w: 2, h: 1 },
                x: 20,
                y: y + 150
            },
            { id: id + 3, type: 'math', params: { op: '*', b: 127 }, x: 260, y: y + 130 },
            { id: id + 4, type: 'midi_cc', params: { cc: 20, ch: k + 1 }, x: 460, y: y + 130 }
        );
        wires.push([id, 1, id + 1, 1], [id + 2, 1, id + 3, 1], [id + 3, 1, id + 4, 1]);
    }
    nodes.push(
        {
            id: 21,
            type: 'gfader',
            params: { lo: 0, hi: 127, start: 100, style: 'fill', orient: 'auto', x: 10, y: 1, w: 3, h: 8 },
            x: 700,
            y: 20
        },
        { id: 22, type: 'midi_cc', params: { cc: 7, ch: 16 }, x: 940, y: 20 }
    );
    wires.push([21, 1, 22, 1]);
    return { nodes, wires };
}

/**
 * A 16-step sequencer on a 16x8 grid: a step grid on the top seven rows
 * (C minor pentatonic from C3), played by a metro, and a length fader on
 * the bottom row (dot style, 1 to 16 steps).
 * @returns {Patch}
 */
export function gridSequencerPatch() {
    return {
        nodes: [
            { id: 1, type: 'metro', params: { ms: 150, per: '1' }, x: 20, y: 20 },
            {
                id: 2,
                type: 'gsteps',
                params: { steps: 16, advance: 'beat', note: 48, scale: 'minor pent.', x: 1, y: 1, w: 16, h: 7 },
                x: 260,
                y: 0
            },
            { id: 3, type: 'midi_note', params: { note: 60, vel: 100, ch: 1 }, x: 560, y: 20 },
            {
                id: 4,
                type: 'gfader',
                params: { lo: 1, hi: 16, start: 16, style: 'dot', orient: 'horizontal', x: 1, y: 8, w: 16, h: 1 },
                x: 20,
                y: 300
            }
        ],
        wires: [
            [1, 1, 2, 1],
            [2, 2, 3, 2],
            [2, 1, 3, 1],
            [4, 1, 2, 3]
        ]
    };
}

/**
 * A keyboard on a 16x8 grid: an isomorphic keyboard on the top seven rows
 * (from C2, rows a fourth apart), an octave fader on the bottom left (five
 * keys, -2 to +2 octaves) and a mod wheel fader (CC 1) on the bottom right.
 * @returns {Patch}
 */
export function gridKeysPatch() {
    return {
        nodes: [
            {
                id: 1,
                type: 'gkeys',
                params: { note: 36, row: 5, scale: 'major', send: 'midi', ch: 1, vel: 100, x: 1, y: 1, w: 16, h: 7 },
                x: 260,
                y: 0
            },
            {
                id: 2,
                type: 'gfader',
                params: { lo: -24, hi: 24, start: 0, style: 'dot', orient: 'horizontal', x: 1, y: 8, w: 5, h: 1 },
                x: 20,
                y: 0
            },
            {
                id: 3,
                type: 'gfader',
                params: { lo: 0, hi: 127, start: 0, style: 'fill', orient: 'horizontal', x: 7, y: 8, w: 10, h: 1 },
                x: 20,
                y: 330
            },
            { id: 4, type: 'midi_cc', params: { cc: 1, ch: 1 }, x: 260, y: 360 }
        ],
        wires: [
            [2, 1, 1, 1],
            [3, 1, 4, 1]
        ]
    };
}

/**
 * Ripples on a 16x8 grid: the top seven rows drop stones (G pentatonic
 * echoes); on the bottom row a rain toggle starts a metro that drops them
 * at random, and a fader sets how fast the rings spread.
 * @returns {Patch}
 */
export function gridRipplesPatch() {
    return {
        nodes: [
            {
                id: 1,
                type: 'gripples',
                params: {
                    note: 43,
                    scale: 'pentatonic',
                    step: 2,
                    echoes: 4,
                    speed: 6,
                    len: 200,
                    send: 'midi',
                    ch: 1,
                    vel: 100,
                    x: 1,
                    y: 1,
                    w: 16,
                    h: 7
                },
                x: 520,
                y: 0
            },
            { id: 2, type: 'gbutton', params: { mode: 'toggle', x: 1, y: 8, w: 2, h: 1 }, x: 20, y: 20 },
            { id: 3, type: 'metro', params: { ms: 900, per: '1' }, x: 260, y: 20 },
            {
                id: 4,
                type: 'gfader',
                params: { lo: 2, hi: 16, start: 6, style: 'fill', orient: 'horizontal', x: 4, y: 8, w: 13, h: 1 },
                x: 20,
                y: 260
            }
        ],
        wires: [
            [2, 1, 3, 1],
            [3, 1, 1, 1],
            [4, 1, 1, 2]
        ]
    };
}

/** The examples the drawer offers, by name. */
export const EXAMPLES = /** @type {Record<string, () => Patch>} */ ({
    basics: examplePatch,
    sequencer: sequencerPatch,
    controller: controllerPatch,
    modes: modesPatch,
    arp: arpPatch,
    'grid mixer': gridMixerPatch,
    'grid sequencer': gridSequencerPatch,
    'grid keys': gridKeysPatch,
    'grid ripples': gridRipplesPatch
});

/** The examples menu, in order: name, label; the device comes from patchDevice. */
export const EXAMPLE_MENU = [
    ['basics', 'basics'],
    ['sequencer', 'sequencer'],
    ['controller', 'controller'],
    ['modes', 'modes'],
    ['arp', 'arp (lua)'],
    ['grid mixer', 'mixer'],
    ['grid sequencer', 'sequencer'],
    ['grid keys', 'keys'],
    ['grid ripples', 'ripples']
];
