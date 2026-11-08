// @ts-check
// The patch editor's blocks and the Lua it generates (docs/VISUAL-EDITOR.md).
// Each block here matches a B.type in lua/blocks.lua: same name, inputs,
// outputs and parameters.

/** Version of lua/blocks.lua this diii carries; the device gets it when older. */
export const RUNTIME_VERSION = 5;

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
 * @property {'achene' | 'screen' | 'grid' | 'source' | 'process' | 'math' | 'memory' | 'output' | 'custom'} group palette section;
 *   achene and grid blocks show only for those devices
 * @property {number} inputs
 * @property {number} outputs
 * @property {string} doc one line, for the palette's tooltip
 * @property {Record<string, Param>} params
 * @property {'watch'} [view] something drawn on the block (the watch's value and graph)
 */

const COLOURS = ['white', 'red', 'amber', 'green', 'cyan', 'blue', 'pink'];

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
        span: { type: 'int', label: 'width', default: span, min: 1, max: 4 }
    };
}

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
        doc: "a labelled bar on achene's screen, in one of 8 places (two columns of four); the screen blocks place things more freely",
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
    route: {
        label: 'route',
        group: 'process',
        inputs: 2,
        outputs: 2,
        doc: 'input 1 goes out of output 1 while input 2 is 0, out of output 2 otherwise: one control, two jobs (a toggle on input 2 picks which)',
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
    enc_label: {
        label: 'enc label',
        group: 'screen',
        inputs: 1,
        outputs: 0,
        doc: 'a name over an encoder (top row) with its value as a line; turning shows the number for a moment',
        params: {
            label: { type: 'text', label: 'label', default: 'cutoff' },
            ...place('top', 1),
            lo: { type: 'number', label: 'lo', default: 0 },
            hi: { type: 'number', label: 'hi', default: 127 }
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
            ...place('middle', 1),
            lo: { type: 'number', label: 'lo', default: 0 },
            hi: { type: 'number', label: 'hi', default: 127 }
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
            ...place('middle', 1),
            lo: { type: 'number', label: 'lo', default: 0 },
            hi: { type: 'number', label: 'hi', default: 127 }
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
            lo: { type: 'number', label: 'lo', default: 0 },
            hi: { type: 'number', label: 'hi', default: 1 }
        }
    },
    steps: {
        label: 'steps',
        group: 'screen',
        inputs: 4,
        outputs: 3,
        doc: "a step sequencer of up to 32 steps, each with a note, drawn as bars. Input 1 is the playing step (a counter): it sends the step's note (output 2) and, if the step is on, a gate (output 1); output 3 is the step number. Its keys show the playing page: a press turns a step on or off; an encoder wired to input 3 then sets that step's note (for 2 seconds after the press, or while the key is held); otherwise it transposes them all. Input 2 (a step number) turns a step on or off. Input 4 picks the page the keys show (an encoder or a key steps through auto, page 1, page 2...), so a step on another page can be edited without waiting for it",
        params: {
            steps: { type: 'int', label: 'steps', default: 8, min: 1, max: 32 },
            note: { type: 'int', label: 'note', default: 60, min: 0, max: 127 },
            lo: { type: 'int', label: 'lo', default: 48, min: 0, max: 127 },
            hi: { type: 'int', label: 'hi', default: 72, min: 0, max: 127 },
            keys: {
                type: 'select',
                label: 'keys',
                default: 'K5-K8 K10-K13',
                options: ['none', 'K1-K4', 'K5-K8', 'K10-K13', 'K5-K8 K10-K13']
            },
            ...place('middle top', 4)
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
        doc: 'passes values on unchanged and shows them here on the block, the latest and a little graph, while the patch runs (10 times a second at most)',
        view: 'watch',
        params: {}
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
        title: 'Share a value without a wire',
        chain: 'encoder → value → set var "tempo" … get var "tempo" → number',
        text: 'set var stores a value under a name and every get var with that name sends it on, anywhere in the patch: handy when a wire would cross the whole canvas.',
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
                    y: 170
                }
            ],
            wires: [
                [1, 1, 2, 1],
                [2, 1, 3, 1],
                [4, 1, 5, 1]
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
    }
];

/** The examples the drawer offers, by name. */
export const EXAMPLES = /** @type {Record<string, () => Patch>} */ ({
    basics: examplePatch,
    sequencer: sequencerPatch,
    controller: controllerPatch,
    modes: modesPatch,
    arp: arpPatch
});
