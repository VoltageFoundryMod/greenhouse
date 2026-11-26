// @ts-check
// trellis's preset files (pset_trellis_N.lua, achene's scripts/trellis.lua):
// read into an object, and written back exactly as trellis's save_preset()
// writes them, for the preset editor (js/trellis-ui.js).
//
// Nothing is shared with achene at build time: the fields, their order,
// ranges and defaults below follow trellis.lua (FILE, default_slot,
// SLOT_MT, PARAMS, Q.FIELDS, Q.LANES, Q.DEF, save_preset) as of trellis
// 1.7.0. When trellis's format changes, change it here too (achene's
// docs/TRELLIS-DEV.md lists this file).

export const NB = 8; // banks
export const NS = 8; // slots a bank
export const NP = 8; // patterns a track
export const MAX_STEPS = 128;
export const SONG_MAX = 32;
export const SCENES = 16; // trellis's PF.NSC (8 until trellis 1.10.0)
export const LETTERS = 'ABCDEFGH';
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** a note number as trellis shows it (60: C4, its note_name) */
export const noteName = (/** @type {number} */ n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

const offOn = (/** @type {number} */ v) => (v === 1 ? 'on' : 'off');
const noYes = (/** @type {number} */ v) => (v === 1 ? 'yes' : 'no');
const offIf0 = (/** @type {number} */ v) => (v === 0 ? 'off' : String(v));

export const E_TYPES = ['off', 'cc', 'pb', 'pb+', 'pb-', 'press'];
export const K_TYPES = ['off', 'cc', 'note', 'prog', 'mod', 'bpm', 'arp'];
export const CHORDS = ['none', 'maj', 'min', '7', 'maj7', 'm7', 'sus2', 'sus4', '5', 'oct'];
export const MODS = ['off', 'lfo', 'motion'];
export const WAVES = ['sine', 'tri', 'saw', 'ramp', 'square', 's&h', 'drift'];
export const RATES = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
export const LFO_DIVS = [
    '8bar',
    '4bar',
    '2bar',
    '1bar',
    '1/2',
    '1/4.',
    '1/4',
    '1/4t',
    '1/8.',
    '1/8',
    '1/8t',
    '1/16',
    '1/16t'
];
export const TIMES = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20];

/** a key's modes for its type (none: no mode) */
export function keyModes(/** @type {string} */ type) {
    if (type === 'bpm') return ['set', 'up', 'down'];
    if (type === 'arp') return ['on', 'latch'];
    if (type === 'note') return ['mom', 'tog'];
    if (type === 'cc') return ['mom', 'tog', 'step'];
    return null;
}

/**
 * @typedef {Record<string, any>} Slot  a slot's saved fields, by name
 * @typedef {object} SlotField
 * @property {string} id      the field's name here
 * @property {string} label   as trellis's edit page says it
 * @property {'e' | 'k' | 'mod' | 'state'} group  encoder, key, its modulation, or not edited
 * @property {number} [lo]
 * @property {number} [hi]
 * @property {readonly (string | number)[]} [list]
 * @property {(s: Slot) => boolean} [when]  shown when true
 * @property {(v: any) => string} [as]      how the value reads
 */

const eOn = (/** @type {Slot} */ s) => s.etype !== 'off';
const kOn = (/** @type {Slot} */ s) => !['off', 'mod', 'bpm', 'arp'].includes(s.ktype);
const kIs = (/** @type {string} */ t) => (/** @type {Slot} */ s) => s.ktype === t;
const isLfo = (/** @type {Slot} */ s) => eOn(s) && s.mod === 'lfo';
const isMotion = (/** @type {Slot} */ s) => eOn(s) && s.mod === 'motion';

/**
 * A slot's fields in the preset file's order (trellis's FILE), with their
 * edit page settings (PARAMS.e, PARAMS.k).
 * @type {SlotField[]}
 */
export const SLOT_FIELDS = [
    { id: 'etype', label: 'type', group: 'e', list: E_TYPES },
    { id: 'ech', label: 'chan', group: 'e', lo: 1, hi: 16, when: eOn },
    { id: 'ecc', label: 'cc', group: 'e', lo: 0, hi: 127, when: (s) => s.etype === 'cc' },
    { id: 'emin', label: 'min', group: 'e', lo: 0, hi: 127, when: eOn },
    { id: 'emax', label: 'max', group: 'e', lo: 0, hi: 127, when: eOn },
    { id: 'espeed', label: 'speed', group: 'e', lo: 1, hi: 16, when: eOn },
    { id: 'etime', label: 'glide', group: 'e', list: TIMES, when: eOn, as: (v) => (v === 0 ? 'off' : `${v}s`) },
    { id: 'ktype', label: 'type', group: 'k', list: K_TYPES },
    { id: 'kmode', label: 'mode', group: 'k', when: (s) => keyModes(s.ktype) !== null },
    { id: 'kch', label: 'chan', group: 'k', lo: 1, hi: 16, when: kOn },
    { id: 'knum', label: 'number', group: 'k', lo: 0, hi: 127, when: (s) => ['cc', 'note', 'prog'].includes(s.ktype) },
    { id: 'koff', label: 'off', group: 'k', lo: 0, hi: 127, when: kIs('cc') },
    { id: 'kon', label: 'on', group: 'k', lo: 0, hi: 127, when: kIs('cc') },
    { id: 'ksteps', label: 'steps', group: 'k', lo: 2, hi: 10, when: (s) => s.ktype === 'cc' && s.kmode === 'step' },
    { id: 'kvel', label: 'vel', group: 'k', lo: 1, hi: 127, when: kIs('note') },
    { id: 'kinv', label: 'invert', group: 'k', lo: 0, hi: 1, when: kIs('cc'), as: noYes },
    { id: 'place', label: 'place', group: 'state', lo: 0, hi: 1 },
    { id: 'kstate', label: 'key state', group: 'state' },
    { id: 'name', label: 'name', group: 'state' },
    { id: 'mod', label: 'mod', group: 'e', list: MODS, when: eOn },
    { id: 'lwave', label: 'wave', group: 'mod', list: WAVES, when: isLfo },
    {
        id: 'lrate',
        label: 'rate',
        group: 'mod',
        list: RATES,
        when: (s) => isLfo(s) && s.lsync === 0,
        as: (v) => `${v}Hz`
    },
    { id: 'lsync', label: 'sync', group: 'mod', lo: 0, hi: 1, when: isLfo, as: (v) => (v === 1 ? 'clock' : 'free') },
    { id: 'ldiv', label: 'rate', group: 'mod', list: LFO_DIVS, when: (s) => isLfo(s) && s.lsync === 1 },
    { id: 'ldepth', label: 'depth', group: 'mod', lo: 0, hi: 100, when: isLfo, as: (v) => `${v}%` },
    { id: 'lpolar', label: 'polar', group: 'mod', list: ['pos', 'neg', 'both'], when: isLfo },
    { id: 'lrun', label: 'run', group: 'mod', lo: 0, hi: 1, when: isLfo, as: offOn },
    { id: 'mplay', label: 'play', group: 'mod', list: ['loop', 'once'], when: isMotion },
    { id: 'mauto', label: 'auto', group: 'mod', lo: 0, hi: 1, when: isMotion, as: noYes },
    { id: 'mdata', label: 'take', group: 'state' },
    { id: 'extcc', label: 'ext cc', group: 'e', lo: -1, hi: 127, when: eOn, as: (v) => (v < 0 ? 'off' : String(v)) },
    { id: 'pc2', label: 'chan 2', group: 'k', lo: 0, hi: 16, when: kIs('prog'), as: offIf0 },
    { id: 'pn2', label: 'prog 2', group: 'k', lo: 0, hi: 127, when: (s) => s.ktype === 'prog' && s.pc2 > 0 },
    { id: 'pc3', label: 'chan 3', group: 'k', lo: 0, hi: 16, when: kIs('prog'), as: offIf0 },
    { id: 'pn3', label: 'prog 3', group: 'k', lo: 0, hi: 127, when: (s) => s.ktype === 'prog' && s.pc3 > 0 },
    { id: 'kbpm', label: 'tempo', group: 'k', lo: 40, hi: 300, when: (s) => s.ktype === 'bpm' && s.kmode === 'set' },
    { id: 'kby', label: 'by', group: 'k', lo: 1, hi: 10, when: (s) => s.ktype === 'bpm' && s.kmode !== 'set' },
    { id: 'chord', label: 'chord', group: 'k', list: CHORDS, when: kIs('note') },
    { id: 'kto', label: 'to', group: 'k', list: ['out', 'arp'], when: kIs('note') }
];

/** slot i (1-8) of bank b (1-8) as trellis starts it (default_slot and SLOT_MT) */
export function defaultSlot(/** @type {number} */ b, /** @type {number} */ i) {
    return /** @type {Slot} */ ({
        etype: 'cc', ech: b, ecc: 15 + i, emin: 0, emax: 127, espeed: 2, etime: 0,
        ktype: 'cc', kmode: 'mom', kch: b, knum: 23 + i, koff: 0, kon: 127, ksteps: 4, kvel: 100, kinv: 0,
        place: 0, kstate: 0, name: '', mod: 'off',
        lwave: 'sine', lrate: 0.5, lsync: 0, ldiv: '1bar', ldepth: 50, lpolar: 'both', lrun: 1,
        mplay: 'loop', mauto: 1, mdata: '',
        extcc: -1, pc2: 0, pn2: 0, pc3: 0, pn3: 0, kbpm: 120, kby: 1, chord: 'none', kto: 'out'
    }); // prettier-ignore
}

// ------------------------------------------------------------------ tracks

export const KINDS = ['slots', 'melodic', 'drums'];
export const STEP_DIVS = ['1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32'];
export const SCALE_NAMES = [
    'chrom',
    'major',
    'minor',
    'dorian',
    'phryg',
    'lydian',
    'mixo',
    'harm min',
    'pent',
    'm pent'
];
/** the saved settings, in the file's order (Q.FIELDS) */
export const TRACK_FIELDS = ['kind', 'ch', 'len', 'div', 'tr', 'scale', 'root', 'swing', 'rch', 'rdens', 'rrange',
    'mute', 'lvl', 'rwhat', 'rleap', 'rmode', 'pat', 'kf']; // prettier-ignore
/** the lanes, a byte a step (Q.LANES) */
export const LANES = ['on', 'note', 'vel', 'gate', 'prob', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8',
    'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']; // prettier-ignore
/** a lane's every step as it starts (Q.FILL; 100 for the others) */
const FILL = /** @type {Record<string, number>} */ ({ on: 0, note: 60, vel: 100, gate: 4 });
/** the kit: a byte a lane (note, channel; Euclidean hits and rotate) */
export const KIT = ['dn', 'dc', 'eh', 'er'];
const KIT_DEF = /** @type {Record<string, number[]>} */ ({
    dn: [36, 38, 42, 46, 39, 45, 50, 49],
    dc: [0, 0, 0, 0, 0, 0, 0, 0],
    eh: [0, 0, 0, 0, 0, 0, 0, 0],
    er: [0, 0, 0, 0, 0, 0, 0, 0]
});
export const RANDOM_WHAT = { melodic: ['steps', 'notes', 'vel', 'gate', 'chance'], drums: ['steps', 'vel', 'chance'] };

// ------------------------------------------------------------------ trellis.cfg

/** where notes coming in go (trellis's P.KDESTS) */
export const KDESTS = ['arp', 'follow', 'off', ...Array.from({ length: 16 }, (_, c) => `ch ${c + 1}`)];
export const SYNC_PPQN = [1, 2, 3, 4, 6, 8, 12, 24];
export const WIDTHS = [1, 2, 5, 10, 15, 20, 30, 50, 100];
export const FOLLOWS = ['auto', 'received', 'sent', 'off'];
export const ARP_MODES = ['up', 'down', 'up-dn', 'rand', 'order'];
export const SAVERS = [0, 1, 2, 5, 10, 30];

/**
 * trellis.cfg's settings in write_cfg's order, each with its default and
 * what it may be: [key, default, lo, hi] for a number, [key, default, list]
 * for one of a list. `preset` (the one loaded at power-up) comes first.
 * @type {[string, string | number, ...any[]][]}
 */
export const CFG_FIELDS = [
    ['bpm', 120, 40, 300], ['src', 'int', ['int', 'ext']], ['out', 1, 0, 1], ['bpb', 4, 2, 12],
    ['oppqn', 2, SYNC_PPQN], ['oms', 15, WIDTHS], ['follow', 'auto', FOLLOWS], ['ippqn', 2, SYNC_PPQN],
    ['tut', 0, 0, 1], ['ttu', 0, 0, 1], ['ttt', 0, 0, 1], ['tclk', 0, 0, 1],
    ['arp', 0, 0, 1], ['amode', 'up', ARP_MODES], ['adiv', '1/16', STEP_DIVS], ['aoct', 1, 1, 4],
    ['agate', 50, 5, 100], ['alatch', 0, 0, 1], ['ach', 1, 1, 16],
    ['split', -1, -1, 127], ['klo', 'arp', KDESTS], ['khi', 'arp', KDESTS], ['kroot', 60, 0, 127],
    ['saver', 5, SAVERS]
]; // prettier-ignore

/** trellis.cfg's text as settings; what's missing or out of range takes trellis's default */
export function parseCfg(/** @type {string} */ text) {
    const c = parseLuaValue(text);
    if (!c || typeof c !== 'object') throw new Error('not a table');
    /** @type {Record<string, any>} */
    const out = { preset: typeof c.preset === 'number' ? c.preset : null };
    for (const [key, def, a, b] of CFG_FIELDS) {
        const v = c[key];
        if (Array.isArray(a)) out[key] = a.includes(v) ? v : def;
        else out[key] = typeof v === 'number' ? Math.min(b, Math.max(a, Math.round(v))) : def;
    }
    // before trellis 1.14.0 the arp's "in" said whether notes played it
    if (c.klo === undefined && c.ain === 0) out.klo = out.khi = 'off';
    return out;
}

/** settings as trellis.cfg's text, as trellis writes it (write_cfg) */
export function serializeCfg(/** @type {Record<string, any>} */ c) {
    const f = [`preset = ${c.preset === null ? 'nil' : c.preset}`];
    for (const [key] of CFG_FIELDS) {
        const v = c[key];
        f.push(`${key} = ${typeof v === 'string' ? quote(v) : v}`);
    }
    return `{${f.join(', ')}}`;
}

/**
 * Trig conditions, in the chance lanes past 100 (trellis 1.12.0, Q.CONDS):
 * 100 + i is CONDS[i - 1], [a, b] playing on the a-th pass of every b
 * (1:2 ... 8:8), then [1, 0] the first pass only (1st), [0, 0] all but it (!1st).
 */
export const CONDS = /** @type {[number, number][]} */ ([]);
for (let b = 2; b <= 8; b++) for (let a = 1; a <= b; a++) CONDS.push([a, b]);
CONDS.push([1, 0], [0, 0]);
/** a chance lane's highest value (Q.TOP) */
export const CHANCE_TOP = 100 + CONDS.length;

/** a chance lane's value as trellis shows it: "50%", "1:2", "1st", "!1st" */
export function chanceName(/** @type {number} */ v) {
    if (v <= 100) return `${v}%`;
    const [a, b] = CONDS[v - 101];
    if (b > 0) return `${a}:${b}`;
    return a === 1 ? '1st' : '!1st';
}

/** what was typed in a chance field ("50", "50%", "1:2", "1st", "!1st") as its value, or null */
export function parseChance(/** @type {string} */ text) {
    const s = text.trim().toLowerCase();
    const pct = /^(\d+)\s*%?$/.exec(s);
    if (pct) return Math.min(100, Number(pct[1]));
    const ab = /^(\d)\s*:\s*(\d)$/.exec(s);
    if (ab) {
        const i = CONDS.findIndex(([a, b]) => a === Number(ab[1]) && b === Number(ab[2]));
        return i < 0 ? null : 101 + i;
    }
    if (s === '1st') return 101 + CONDS.findIndex(([a, b]) => a === 1 && b === 0);
    if (s === '!1st' || s === 'not 1st') return 101 + CONDS.findIndex(([a, b]) => a === 0 && b === 0);
    return null;
}

/**
 * A track's settings, its lanes as byte arrays, its other patterns and kit.
 * @typedef {object} Pattern
 * @property {number} len
 * @property {Record<string, Uint8Array>} lanes  only the edited ones (others start as defaultLane)
 * @typedef {Record<string, any> & { lanes: Record<string, Uint8Array>, pats: Record<number, Pattern>,
 *   kit: Record<string, Uint8Array> }} Track
 */

/** a lane as it starts: 128 steps */
export function defaultLane(/** @type {string} */ lane) {
    return new Uint8Array(MAX_STEPS).fill(FILL[lane] ?? 100);
}

/** bank b's track as trellis makes it (Q.new) */
export function newTrack(/** @type {number} */ b) {
    /** @type {Track} */
    const t = {
        kind: 'slots', ch: b, len: 16, div: '1/16', tr: 0, scale: 'chrom', root: 0, swing: 50, rch: 100,
        rdens: 50, rrange: 12, mute: 0, lvl: 100, rwhat: 'steps', rleap: 0, rmode: 'dub', pat: 1, kf: 0,
        lanes: {}, pats: {}, kit: {}
    }; // prettier-ignore
    for (const k of KIT) t.kit[k] = Uint8Array.from(KIT_DEF[k]);
    return t;
}

/** a lane's step k (1-based), its default where the lane isn't edited */
export function laneAt(/** @type {Track | Pattern} */ t, /** @type {string} */ lane, /** @type {number} */ k) {
    return (t.lanes[lane] ?? defaultLane(lane))[k - 1];
}

/** sets step k of a lane, keeping lanes that end up as they start out of the file */
export function setLane(/** @type {Track | Pattern} */ t, /** @type {string} */ lane, /** @type {number} */ k, /** @type {number} */ v) {
    const a = t.lanes[lane] ? t.lanes[lane].slice() : defaultLane(lane);
    a[k - 1] = v;
    if (sameBytes(a, defaultLane(lane))) delete t.lanes[lane];
    else t.lanes[lane] = a;
} // prettier-ignore

/**
 * Pattern n of a track, to read and edit: the one playing is the track's
 * own lanes and length (as in trellis); another is t.pats[n], made empty
 * (with the playing one's length) when it has none yet. An empty one
 * isn't written to the file.
 * @param {Track} t
 * @param {number} n
 * @returns {Track | Pattern}
 */
export function patternOf(t, n) {
    if (n === t.pat) return t;
    t.pats[n] ??= { len: t.len, lanes: {} };
    return t.pats[n];
}

/** pattern n playing (trellis's Q.switch): the one playing kept in t.pats */
export function switchPattern(/** @type {Track} */ t, /** @type {number} */ n) {
    if (n === t.pat) return;
    const next = t.pats[n] ?? { len: t.len, lanes: {} };
    t.pats[t.pat] = { len: t.len, lanes: t.lanes };
    t.lanes = next.lanes;
    t.len = next.len;
    delete t.pats[n];
    t.pat = n;
}

// ------------------------------------------------------------------ preset

/**
 * @typedef {object} Scene
 * @property {number[]} pat   each bank's pattern, 0: not a track
 * @property {number[]} mute
 * @typedef {object} Preset
 * @property {string} version   the trellis that wrote it
 * @property {string[]} names   the banks'
 * @property {Slot[]} slots     64, bank by bank
 * @property {Record<number, Track>} tracks  the banks that have one (1-8)
 * @property {number[]} assign  the performance page's eight picks (1-64, 0: none)
 * @property {Record<number, Scene>} scenes  1-16
 * @property {[number, number][]} song  scene, bars
 * @property {number} son       the song on
 */

/** an empty preset, as trellis's init (shift + K2 on the presets page) */
export function emptyPreset() {
    /** @type {Preset} */
    const p = { version: '1.7.0', names: Array(NB).fill(''), slots: [], tracks: {}, assign: Array(NS).fill(0), scenes: {}, song: [], son: 0 }; // prettier-ignore
    for (let b = 1; b <= NB; b++) for (let i = 1; i <= NS; i++) p.slots.push(defaultSlot(b, i));
    return p;
}

// ------------------------------------------------------------------ reading

/**
 * Lua table constructors and literals, as preset files hold them: the
 * value after `return`. Tables come back as { array: [], hash: {} }-free
 * plain forms: a Map-free object with numeric keys for [n] = and list
 * items, string keys for name =.
 * @param {string} text
 */
export function parseLuaValue(text) {
    let i = 0;
    const fail = (/** @type {string} */ msg) => {
        const line = text.slice(0, i).split('\n').length;
        throw new Error(`line ${line}: ${msg}`);
    };
    const skip = () => {
        for (;;) {
            while (i < text.length && /\s/.test(text[i])) i++;
            if (text.startsWith('--', i)) {
                const long = /^--\[(=*)\[/.exec(text.slice(i, i + 20));
                if (long) {
                    const end = text.indexOf(`]${long[1]}]`, i);
                    i = end < 0 ? text.length : end + long[1].length + 2;
                } else {
                    const nl = text.indexOf('\n', i);
                    i = nl < 0 ? text.length : nl + 1;
                }
                continue;
            }
            return;
        }
    };
    /** @returns {any} */
    const value = () => {
        skip();
        const c = text[i];
        if (c === '{') return table();
        if (c === '"' || c === "'") return string();
        if (/[-\d.]/.test(c)) return number();
        for (const [word, v] of /** @type {[string, any][]} */ ([
            ['true', true],
            ['false', false],
            ['nil', null]
        ])) {
            if (text.startsWith(word, i) && !/\w/.test(text[i + word.length] ?? '')) {
                i += word.length;
                return v;
            }
        }
        return fail(`unexpected ${JSON.stringify(text.slice(i, i + 10))}`);
    };
    const number = () => {
        const m = /^-?(0[xX][\da-fA-F]+|(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)/.exec(text.slice(i));
        if (!m) return fail('bad number');
        i += m[0].length;
        return Number(m[0]);
    };
    const string = () => {
        const q = text[i++];
        let out = '';
        while (i < text.length && text[i] !== q) {
            let c = text[i++];
            if (c === '\\') {
                c = text[i++];
                const simple = /** @type {Record<string, string>} */ ({
                    n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n'
                }); // prettier-ignore
                if (c in simple) out += simple[c];
                else if (/\d/.test(c)) {
                    let d = c;
                    while (d.length < 3 && /\d/.test(text[i])) d += text[i++];
                    out += String.fromCharCode(Number(d));
                } else if (c === 'x') {
                    out += String.fromCharCode(parseInt(text.slice(i, i + 2), 16));
                    i += 2;
                } else if (c === 'z') {
                    while (/\s/.test(text[i])) i++;
                } else fail(`bad escape \\${c}`);
            } else out += c;
        }
        if (text[i] !== q) fail('unfinished string');
        i++;
        return out;
    };
    const table = () => {
        i++; // {
        /** @type {Record<string | number, any>} */
        const t = {};
        let n = 0;
        for (;;) {
            skip();
            if (text[i] === '}') {
                i++;
                return t;
            }
            let key;
            if (text[i] === '[') {
                i++;
                key = value();
                skip();
                if (text[i] !== ']') fail('expected ]');
                i++;
                skip();
                if (text[i] !== '=') fail('expected =');
                i++;
                t[key] = value();
            } else {
                const m = /^[A-Za-z_]\w*/.exec(text.slice(i));
                const after = m ? text.slice(i + m[0].length).match(/^\s*=(?!=)/) : null;
                if (m && after) {
                    i += m[0].length + after[0].length;
                    t[m[0]] = value();
                } else {
                    t[++n] = value();
                }
            }
            skip();
            if (text[i] === ',' || text[i] === ';') i++;
            else if (text[i] !== '}') fail('expected , or }');
        }
    };
    skip();
    if (text.startsWith('return', i)) i += 6;
    const v = value();
    skip();
    if (i < text.length) fail('more after the table');
    return v;
}

/** a Lua table's list part, 1..n, as an array */
const list = (/** @type {any} */ t) => {
    /** @type {any[]} */
    const out = [];
    if (t && typeof t === 'object') for (let k = 1; k in t; k++) out.push(t[k]);
    return out;
};

const unhex = (/** @type {any} */ s) => {
    if (typeof s !== 'string' || s.length % 2 || !/^[\da-fA-F]*$/.test(s)) return null;
    const a = new Uint8Array(s.length / 2);
    for (let k = 0; k < a.length; k++) a[k] = parseInt(s.slice(2 * k, 2 * k + 2), 16);
    return a;
};

const hex = (/** @type {Uint8Array} */ a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');

const sameBytes = (/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b) =>
    a.length === b.length && a.every((v, k) => v === b[k]);

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
    Math.min(hi, Math.max(lo, Math.round(v)));

/** a lane from a file: hex, up to 128 steps; shorter ones padded as they start */
function readLane(/** @type {any} */ v, /** @type {string} */ lane) {
    const a = unhex(v);
    if (!a || a.length === 0 || a.length > MAX_STEPS) return null;
    if (a.length === MAX_STEPS) return a;
    const full = defaultLane(lane);
    full.set(a);
    return full;
}

/**
 * A preset file's text into a Preset, the way trellis reads one: each
 * value where it's the right type and in range, defaults elsewhere (an
 * older preset, or one edited by hand).
 * @param {string} text
 * @returns {Preset}
 */
export function parsePreset(text) {
    const d = parseLuaValue(text);
    if (!d || typeof d !== 'object') throw new Error('not a trellis preset (no table)');
    const p = emptyPreset();
    if (typeof d.version === 'string') p.version = d.version;
    const names = list(d.names);
    for (let b = 0; b < NB; b++) if (typeof names[b] === 'string') p.names[b] = names[b];
    const slots = list(d.slots);
    for (let x = 0; x < NB * NS; x++) {
        const saved = list(slots[x]);
        const s = p.slots[x];
        SLOT_FIELDS.forEach((f, k) => {
            let v = saved[k];
            if (f.id === 'mdata' && typeof v === 'string') v = unhex(v) ? v.toLowerCase() : '';
            if (v !== undefined && v !== null && typeof v === typeof s[f.id]) s[f.id] = v;
        });
    }
    const tracks = d.tracks && typeof d.tracks === 'object' ? d.tracks : {};
    for (let b = 1; b <= NB; b++) if (tracks[b] && typeof tracks[b] === 'object') p.tracks[b] = readTrack(b, tracks[b]);
    const assign = list(d.assign);
    for (let k = 0; k < NS; k++) {
        const x = assign[k];
        p.assign[k] = Number.isInteger(x) && x >= 1 && x <= NB * NS ? x : 0;
    }
    const scenes = d.scenes && typeof d.scenes === 'object' ? d.scenes : {};
    for (let k = 1; k <= SCENES; k++) {
        const sc = scenes[k];
        if (!sc || typeof sc !== 'object' || typeof sc.pat !== 'object' || typeof sc.mute !== 'object') continue;
        const pat = list(sc.pat), mute = list(sc.mute); // prettier-ignore
        p.scenes[k] = {
            pat: Array.from({ length: NB }, (_, b) => (typeof pat[b] === 'number' ? clamp(pat[b], 0, NP) : 0)),
            mute: Array.from({ length: NB }, (_, b) => (mute[b] === 1 ? 1 : 0))
        };
    }
    for (const e of list(d.song)) {
        const v = list(e);
        if (typeof v[0] === 'number' && typeof v[1] === 'number' && p.song.length < SONG_MAX)
            p.song.push([clamp(v[0], 1, SCENES), clamp(v[1], 1, 99)]);
    }
    p.son = d.son === 1 ? 1 : 0;
    return p;
}

/** a track from a preset (Q.make) */
function readTrack(/** @type {number} */ b, /** @type {any} */ x) {
    const t = newTrack(b);
    for (const k of TRACK_FIELDS) if (typeof x[k] === typeof t[k]) t[k] = x[k];
    if (!KINDS.includes(t.kind)) t.kind = 'slots';
    if (!STEP_DIVS.includes(t.div)) t.div = '1/16';
    if (!SCALE_NAMES.includes(t.scale)) t.scale = 'chrom';
    t.root = clamp(t.root, 0, 11);
    t.swing = clamp(t.swing, 50, 75);
    t.mute = t.mute === 1 ? 1 : 0;
    t.lvl = clamp(t.lvl, 0, 100);
    t.rch = clamp(t.rch, 0, 100);
    t.rdens = clamp(t.rdens, 0, 100);
    t.rrange = clamp(t.rrange, 1, 48);
    t.rleap = clamp(t.rleap, 0, 12);
    if (!RANDOM_WHAT.melodic.includes(t.rwhat)) t.rwhat = 'steps';
    if (t.rmode !== 'repl') t.rmode = 'dub';
    t.kf = t.kf === 1 ? 1 : 0;
    t.ch = clamp(t.ch, 1, 16);
    t.len = clamp(t.len, 1, MAX_STEPS);
    t.tr = clamp(t.tr, -48, 48);
    t.pat = clamp(t.pat, 1, NP);
    for (const l of LANES) {
        const a = readLane(x[l], l);
        if (a && !sameBytes(a, defaultLane(l))) t.lanes[l] = a;
    }
    const pats = x.pats && typeof x.pats === 'object' ? x.pats : {};
    for (let n = 1; n <= NP; n++) {
        const y = pats[n];
        if (n === t.pat || !y || typeof y !== 'object') continue;
        /** @type {Pattern} */
        const pat = { len: typeof y.len === 'number' ? clamp(y.len, 1, MAX_STEPS) : t.len, lanes: {} };
        for (const l of LANES) {
            const a = readLane(y[l], l);
            if (a) pat.lanes[l] = a;
        }
        if (Object.keys(pat.lanes).length) t.pats[n] = pat;
    }
    for (const k of KIT) {
        const a = unhex(x[k]);
        if (a && a.length === 8) t.kit[k] = a;
    }
    return t;
}

// ------------------------------------------------------------------ writing

/** a string as Lua's %q writes it */
function quote(/** @type {string} */ s) {
    let out = '"';
    for (let k = 0; k < s.length; k++) {
        const c = s[k];
        const code = s.charCodeAt(k);
        if (c === '"' || c === '\\') out += `\\${c}`;
        else if (c === '\n') out += '\\\n';
        else if (c === '\r') out += '\\r';
        else if (c === '\0') out += /\d/.test(s[k + 1] ?? '') ? '\\000' : '\\0';
        else if (code < 32 || code === 127) out += /\d/.test(s[k + 1] ?? '') ? `\\${String(code).padStart(3, '0')}` : `\\${code}`;
        else out += c;
    }
    return `${out}"`;
} // prettier-ignore

/** C's %.5g */
function g5(/** @type {number} */ v) {
    if (v === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(v)));
    if (e < -4 || e >= 5) {
        const [m, x] = v.toExponential(4).split('e');
        const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
        const n = Number(x);
        return `${mant}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
    }
    const s = v.toFixed(Math.max(0, 4 - e));
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** a value as trellis's ser() writes it */
function ser(/** @type {any} */ v) {
    if (typeof v === 'string') return quote(v);
    if (typeof v === 'boolean') return String(v);
    if (Number.isInteger(v)) return String(v);
    return g5(v);
}

// trellis 1.7.0's save_preset(), its header word for word
const HEADER = [
    '-- trellis.lua preset. A slot: encoder type, channel, cc, min, max,',
    '-- speed, time; key type, mode, channel, number, off, on, steps,',
    '-- velocity, invert; encoder place (0-1), key state, name; mod;',
    '-- LFO wave, rate, sync, division, depth, polarity, run; motion',
    '-- play, autoplay, samples (hex, 25 a second); ext CC; program 2 and 3',
    '-- (channel, number); bpm key\'s tempo and step; a note key\'s chord and',
    '-- where it goes (out, arp). tracks: the banks\'',
    '-- sequencer settings; their steps\' on, note, velocity and gate (in',
    '-- eighths of a step), hex, a byte a step. assign: the performance',
    '-- page\'s eight picked slots (1-64, 0 for none). scenes: each bank\'s',
    '-- pattern (0: not a track) and mute. song: its scenes and their bars;',
    '-- son: on. A track\'s pat: its',
    '-- pattern playing; pats: its others (length and edited lanes). version: the trellis',
    '-- that wrote it, for a later one to read an older format by'
]; // prettier-ignore

/**
 * A Preset as trellis's save_preset() writes it, byte for byte.
 * @param {Preset} p
 */
export function serializePreset(p) {
    const out = HEADER.map((l) => `${l}\n`);
    out.push(`return {\nversion = ${quote(p.version)},\nnames = {`);
    out.push(`${p.names.map(quote).join(', ')}},\n`);
    out.push('slots = {\n');
    p.slots.forEach((s, x) => {
        if (x % NS === 0) out.push(`-- bank ${LETTERS[x / NS]}\n`);
        out.push(`{${SLOT_FIELDS.map((f) => ser(s[f.id])).join(',')}},\n`);
    });
    out.push('},\ntracks = {\n');
    for (let b = 1; b <= NB; b++) {
        const t = p.tracks[b];
        if (!t) continue;
        const f = TRACK_FIELDS.map((k) => `${k} = ${ser(t[k])}`);
        for (const l of LANES) if (t.lanes[l] && !sameBytes(t.lanes[l], defaultLane(l))) f.push(`${l} = ${quote(hex(t.lanes[l]))}`);
        const ps = [];
        for (let n = 1; n <= NP; n++) {
            const pat = t.pats[n];
            if (!pat || !LANES.some((l) => pat.lanes[l])) continue; // empty: trellis keeps none
            const g = [`len = ${pat.len}`];
            for (const l of LANES) if (pat.lanes[l]) g.push(`${l} = ${quote(hex(pat.lanes[l]))}`);
            ps.push(`[${n}] = {${g.join(', ')}}`);
        }
        if (ps.length) f.push(`pats = {${ps.join(', ')}}`);
        for (const k of KIT) f.push(`${k} = ${quote(hex(t.kit[k]))}`);
        out.push(`[${b}] = {${f.join(', ')}},\n`);
    }
    out.push(`},\nassign = {${p.assign.join(', ')}},\nscenes = {`);
    for (let k = 1; k <= SCENES; k++) {
        const sc = p.scenes[k];
        if (sc) out.push(`[${k}] = {pat = {${sc.pat.join(', ')}}, mute = {${sc.mute.join(', ')}}}, `);
    }
    out.push('},\nsong = {');
    for (const [s, bars] of p.song) out.push(`{${s}, ${bars}}, `);
    out.push(`}, son = ${p.son}}\n`);
    return out.join('');
} // prettier-ignore
