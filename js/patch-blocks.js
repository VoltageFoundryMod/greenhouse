// @ts-check
// The patch editor's blocks and the Lua it generates (docs/VISUAL-EDITOR.md).
// Each block here matches a B.type in lua/blocks.lua: same name, inputs,
// outputs and parameters.

/** Version of lua/blocks.lua this diii carries; the device gets it when older. */
export const RUNTIME_VERSION = 1;

/**
 * @typedef {object} Param
 * @property {'int' | 'number' | 'text' | 'select'} type
 * @property {string} label shown in the node
 * @property {number | string} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string[]} [options] for select
 *
 * @typedef {object} Block
 * @property {string} label
 * @property {'achene' | 'source' | 'process' | 'output'} group palette section
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
        inputs: 1,
        outputs: 0,
        doc: 'note on when the value is not 0, note off when it is',
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
    let text = String(value ?? param.default);
    if (param.type === 'select' && !param.options?.includes(text)) text = String(param.default);
    // printable ASCII without quotes or backslashes, so it's always valid Lua
    text = text.replace(/[^ -~]|["\\]/g, '').slice(0, 20);
    return `"${text}"`;
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
