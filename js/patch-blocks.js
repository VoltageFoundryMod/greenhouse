// @ts-check
// The patch editor's blocks and the Lua it generates (docs/VISUAL-EDITOR.md).
// Each block here matches a B.type in lua/blocks.lua: same name, inputs,
// outputs and parameters.

/** Version of lua/blocks.lua this diii carries; the device gets it when older. */
export const RUNTIME_VERSION = 4;

/**
 * @typedef {object} Param
 * @property {'int' | 'number' | 'text' | 'select' | 'code'} type
 * @property {string} label shown in the node
 * @property {number | string} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string[]} [options] for select
 *
 * @typedef {object} Block
 * @property {string} label
 * @property {'achene' | 'grid' | 'source' | 'process' | 'math' | 'memory' | 'output' | 'custom'} group palette section;
 *   achene and grid blocks show only for those devices
 * @property {number} inputs
 * @property {number} outputs
 * @property {string} doc one line, for the palette's tooltip
 * @property {Record<string, Param>} params
 */

const COLOURS = ['white', 'red', 'amber', 'green', 'cyan', 'blue', 'pink'];

/** @type {Record<string, Block>} */
export const BLOCKS = {
    encoder: {
        label: 'encoder',
        group: 'achene',
        inputs: 0,
        outputs: 1,
        doc: 'an achene encoder: each turn sends its steps (+1, -2, ...)',
        params: { n: { type: 'int', label: 'E', default: 5, min: 1, max: 12 } }
    },
    key: {
        label: 'key',
        group: 'achene',
        inputs: 0,
        outputs: 1,
        doc: 'an achene key: 1 when pressed, 0 when released',
        params: { n: { type: 'int', label: 'K', default: 5, min: 1, max: 16 } }
    },
    lfo: {
        label: 'lfo',
        group: 'source',
        inputs: 0,
        outputs: 1,
        doc: 'a slow wave, 0 to 1, sent 50 times a second',
        params: {
            rate: { type: 'number', label: 'Hz', default: 0.5, min: 0.01, max: 20, step: 0.05 },
            shape: { type: 'select', label: 'shape', default: 'sine', options: ['sine', 'triangle', 'saw', 'square'] }
        }
    },
    accum: {
        label: 'value',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'adds what comes in and keeps it between lo and hi: turns encoder steps into a value',
        params: {
            lo: { type: 'number', label: 'lo', default: 0 },
            hi: { type: 'number', label: 'hi', default: 127 },
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
            in_lo: { type: 'number', label: 'in lo', default: 0 },
            in_hi: { type: 'number', label: 'in hi', default: 1 },
            out_lo: { type: 'number', label: 'out lo', default: 0 },
            out_hi: { type: 'number', label: 'out hi', default: 127 }
        }
    },
    toggle: {
        label: 'toggle',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'flips between 0 and 1 on each press',
        params: {}
    },
    midi_cc: {
        label: 'midi cc',
        group: 'output',
        inputs: 1,
        outputs: 0,
        doc: 'sends the value as a MIDI CC (0..127)',
        params: {
            cc: { type: 'int', label: 'cc', default: 20, min: 0, max: 127 },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16 }
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
            vel: { type: 'int', label: 'vel', default: 100, min: 1, max: 127 },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16 }
        }
    },
    key_led: {
        label: 'key led',
        group: 'achene',
        inputs: 1,
        outputs: 0,
        doc: 'lights an achene key: the value (0..1) is the brightness',
        params: {
            n: { type: 'int', label: 'K', default: 5, min: 1, max: 16 },
            colour: { type: 'select', label: 'colour', default: 'amber', options: COLOURS }
        }
    },
    display: {
        label: 'display',
        group: 'achene',
        inputs: 1,
        outputs: 0,
        doc: "a labelled bar on achene's screen, in one of 8 places",
        params: {
            label: { type: 'text', label: 'label', default: 'value' },
            slot: { type: 'int', label: 'place', default: 1, min: 1, max: 8 },
            lo: { type: 'number', label: 'lo', default: 0 },
            hi: { type: 'number', label: 'hi', default: 127 }
        }
    },
    enc_push: {
        label: 'enc push',
        group: 'achene',
        inputs: 0,
        outputs: 1,
        doc: "an achene encoder's push: 1 pressed, 0 released",
        params: { n: { type: 'int', label: 'E', default: 1, min: 1, max: 12 } }
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
        doc: 'lights a grid key: the value (0..1) is the level',
        params: {
            x: { type: 'int', label: 'x', default: 1, min: 1, max: 16 },
            y: { type: 'int', label: 'y', default: 1, min: 1, max: 16 }
        }
    },
    metro: {
        label: 'metro',
        group: 'source',
        inputs: 1,
        outputs: 1,
        doc: 'a steady beat: 1 on each beat, 0 halfway; input: 0 stops it, anything else starts it',
        params: { ms: { type: 'int', label: 'ms', default: 500, min: 20, max: 10000 } }
    },
    clock: {
        label: 'clock in',
        group: 'source',
        inputs: 0,
        outputs: 2,
        doc: 'MIDI clock in: output 1 beats every div clocks (24 = a quarter); output 2 is 1 on start, 0 on stop',
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
            cc: { type: 'int', label: 'cc', default: 74, min: 0, max: 127 },
            ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16 }
        }
    },
    midi_in_note: {
        label: 'midi in note',
        group: 'source',
        inputs: 0,
        outputs: 2,
        doc: 'incoming notes: output 1 the note number, output 2 1 on and 0 off',
        params: { ch: { type: 'int', label: 'ch', default: 1, min: 1, max: 16 } }
    },
    counter: {
        label: 'counter',
        group: 'process',
        inputs: 2,
        outputs: 1,
        doc: 'input 1 (not 0): the next step, wrapping; input 2 (not 0): back to lo',
        params: {
            lo: { type: 'int', label: 'lo', default: 1 },
            hi: { type: 'int', label: 'hi', default: 8 },
            step: { type: 'int', label: 'step', default: 1 }
        }
    },
    random: {
        label: 'random',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'a whole number from lo to hi each time the input is not 0',
        params: {
            lo: { type: 'int', label: 'lo', default: 48 },
            hi: { type: 'int', label: 'hi', default: 72 }
        }
    },
    quantize: {
        label: 'quantize',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'the nearest note of a scale',
        params: {
            scale: {
                type: 'select',
                label: 'scale',
                default: 'major',
                options: ['major', 'minor', 'dorian', 'pentatonic', 'minor pent.', 'chromatic']
            },
            root: { type: 'int', label: 'root', default: 0, min: 0, max: 11 }
        }
    },
    slew: {
        label: 'slew',
        group: 'process',
        inputs: 1,
        outputs: 1,
        doc: 'glides to each new value over a time (seconds)',
        params: { time: { type: 'number', label: 's', default: 0.5, min: 0, max: 30, step: 0.1 } }
    },
    gate: {
        label: 'gate',
        group: 'process',
        inputs: 2,
        outputs: 1,
        doc: 'passes input 1 while input 2 is open (not 0); starts open',
        params: {}
    },
    math: {
        label: 'math',
        group: 'math',
        inputs: 2,
        outputs: 1,
        doc: 'two numbers: input 1 computes and sends (a op b), input 2 sets b without sending; until then b is the field',
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
                options: ['sin', 'cos', 'tan', 'abs', 'neg', 'sqrt', 'exp', 'log', 'floor', 'ceil', 'round']
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
        doc: 'stores a value under a name; every get var with that name sends it on (no wire needed)',
        params: { name: { type: 'text', label: 'name', default: 'x' } }
    },
    var_get: {
        label: 'get var',
        group: 'memory',
        inputs: 0,
        outputs: 1,
        doc: 'sends the value each time a set var with the same name stores one',
        params: { name: { type: 'text', label: 'name', default: 'x' } }
    },
    print: {
        label: 'print',
        group: 'output',
        inputs: 1,
        outputs: 0,
        doc: "prints values in diii's console, at most 10 a second",
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
    text = text.replace(/[^ -~]|["\\]/g, '').slice(0, 20);
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
 *
 * @typedef {object} Patch
 * @property {PatchNode[]} nodes
 * @property {[number, number, number, number][]} wires from, output, to, input
 */

/** The lines that rebuild a patch live on a device with the runtime loaded. */
/** @param {Patch} patch */
export function liveLines(patch) {
    return [
        'B.clear()',
        ...patch.nodes.map((n) => `B.node(${n.id}, "${n.type}", ${luaParams(n.type, n.params)})`),
        ...patch.wires.map((w) => `B.wire(${w.join(', ')})`),
        'B.start()'
    ];
}

/**
 * A patch as a script file: the editor's copy in --@patch comment lines,
 * then the Lua that runs it. Every line stays well under iii's 512.
 * @param {string} name @param {Patch} patch
 */
export function patchFile(name, patch) {
    const json = JSON.stringify({ v: 1, nodes: patch.nodes, wires: patch.wires });
    const lines = [
        `-- diii patch: ${name.replace(/[^ -~]/g, '')}`,
        '-- made in the patch drawer; open it there to change it'
    ];
    for (let i = 0; i < json.length; i += 300) lines.push(`--@patch ${json.slice(i, i + 300)}`);
    lines.push('require("blocks.lua")', 'B.patch{', '  nodes = {');
    for (const n of patch.nodes) lines.push(`    {${n.id}, "${n.type}", ${luaParams(n.type, n.params)}},`);
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
        return { nodes: data.nodes, wires: data.wires };
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
 * A step sequencer: a metro steps a counter through 8 steps; a lua block
 * turns each step into a note of an arpeggio, transposed by E5; quantize
 * keeps it in C minor; the metro's beat plays it.
 * @returns {Patch}
 */
export function sequencerPatch() {
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

/** The examples the drawer offers, by name. */
export const EXAMPLES = /** @type {Record<string, () => Patch>} */ ({
    basics: examplePatch,
    sequencer: sequencerPatch
});
