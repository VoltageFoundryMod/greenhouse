// trellis's preset editor: a preset file of achene's trellis script
// (pset_trellis_N.lua) as a form, its banks' slots, tracks and steps, its
// scenes, song and assign; saved back to the device in trellis's own format
// (js/trellis-preset.js). Opened from a preset's file menu ("edit preset").
// Mixed into diiiApp (diii.js); `this` is the app.

import { hasExactFiles } from './backup.js';
import {
    CFG_FIELDS,
    CHANCE_TOP,
    KINDS,
    LETTERS,
    MAX_STEPS,
    NB,
    NP,
    NS,
    RANDOM_WHAT,
    SCALE_NAMES,
    SCENES,
    SLOT_FIELDS,
    SONG_MAX,
    STEP_DIVS,
    chanceName,
    keyModes,
    laneAt,
    emptyPreset,
    newTrack,
    noteName,
    parseCfg,
    parseChance,
    parsePreset,
    patternOf,
    serializeCfg,
    serializePreset,
    setLane,
    switchPattern
} from './trellis-preset.js';

/** a preset of trellis: pset_trellis_<n>.lua */
export const TRELLIS_PRESET = /^pset_trellis_(\d+)\.lua$/;
/** trellis's settings file (setup's pages) */
export const TRELLIS_CFG = 'trellis.cfg';

const onOff = (/** @type {number} */ v) => (v === 1 ? 'on' : 'off');
/** setup's pages as the settings dialog groups them: [key, label, as?] (CFG_FIELDS has the ranges) */
const CFG_GROUPS = [
    ['clock', [['bpm', 'bpm'], ['src', 'clock'], ['out', 'send clock', onOff], ['bpb', 'beats a bar']]],
    ['sync jacks', [['oppqn', 'out', (v) => `${v} ppq`], ['oms', 'width', (v) => `${v} ms`], ['follow', 'out follows'], ['ippqn', 'in', (v) => `${v} ppq`]]],
    ['MIDI thru', [['tut', 'USB › TRS', onOff], ['ttu', 'TRS › USB', onOff], ['ttt', 'TRS › TRS', onOff], ['tclk', 'clock too', onOff]]],
    ['arpeggiator', [['arp', 'arp', onOff], ['amode', 'mode'], ['adiv', 'rate'], ['aoct', 'octaves'], ['agate', 'gate', (v) => `${v}%`], ['alatch', 'latch', onOff], ['ach', 'channel']]],
    ['the keys (notes coming in)', [['split', 'split', (v) => (v < 0 ? 'off' : noteName(v))], ['klo', 'low (all, no split)'], ['khi', 'high'], ['kroot', 'follow root', noteName]]],
    ['screensaver', [['saver', 'after', (v) => (v === 0 ? 'off' : `${v} min`)]]]
]; // prettier-ignore

// what trellis_reload(n) said after a save, for the console
const RELOAD_SAYS = {
    loaded: () => 'achene plays it now.',
    replaced: () => "achene plays it now, in place of changes made on achene that weren't saved.",
    listed: (n) => `To play it, load preset ${n} on achene (K15, E1 to ${n}, K2).`,
    bad: () => "trellis couldn't load it; it plays what it had.",
    none: (n) =>
        `On achene, load preset ${n} (K15, E1 to ${n}, K2) to play it; if trellis has it loaded now, ` +
        'load it again before saving from trellis, or trellis writes its own over it.'
};

// as trellis draws them (COLOURS)
const COLOURS = ['#ff7800', '#008cff', '#28dc3c', '#e628a0', '#ffdc00', '#00dcc8', '#963cff', '#ff281e'];
// what names may hold on the device (trellis's N.CHARS), and how long
const NAME_CHARS = ' abcdefghijklmnopqrstuvwxyz0123456789-+./#&!?';
const PAGE = 16; // steps shown at a time

/**
 * A track's settings as its bank's settings page has them (trellis's
 * PARAMS.t), but for the length, the kit and the patterns, drawn apart.
 * @type {{ id: string, label: string, lo?: number, hi?: number, list?: readonly (string|number)[],
 *   when?: (t: any) => boolean, as?: (v: any) => string, opts?: (t: any) => readonly string[] }[]}
 */
const TRACK_SETTINGS = [
    { id: 'ch', label: 'channel', lo: 1, hi: 16 },
    { id: 'div', label: 'step', list: STEP_DIVS },
    { id: 'swing', label: 'swing', lo: 50, hi: 75, as: (v) => `${v}%` },
    { id: 'tr', label: 'transpose', lo: -48, hi: 48, when: (t) => t.kind === 'melodic' },
    { id: 'scale', label: 'scale', list: SCALE_NAMES, when: (t) => t.kind === 'melodic' },
    { id: 'root', label: 'root', lo: 0, hi: 11, when: (t) => t.kind === 'melodic', as: (v) => 'C C# D D# E F F# G G# A A# B'.split(' ')[v] },
    { id: 'kf', label: 'follow keys', lo: 0, hi: 1, when: (t) => t.kind === 'melodic', as: (v) => (v === 1 ? 'on' : 'off') },
    { id: 'lvl', label: 'level', lo: 0, hi: 100, as: (v) => `${v}%` },
    { id: 'mute', label: 'muted', lo: 0, hi: 1, as: (v) => (v === 1 ? 'yes' : 'no') },
    { id: 'rmode', label: 'rec', list: ['dub', 'repl'] },
    { id: 'rwhat', label: 'randomise', opts: (t) => (t.kind === 'drums' ? RANDOM_WHAT.drums : RANDOM_WHAT.melodic) },
    { id: 'rch', label: 'chance', lo: 0, hi: 100, as: (v) => `${v}%` },
    { id: 'rdens', label: 'density', lo: 0, hi: 100, as: (v) => `${v}%` },
    { id: 'rrange', label: 'range', lo: 1, hi: 48, when: (t) => t.kind === 'melodic' },
    { id: 'rleap', label: 'leap', lo: 0, hi: 12, when: (t) => t.kind === 'melodic', as: (v) => (v === 0 ? 'any' : String(v)) }
]; // prettier-ignore

/** an element with a class, and children or text */
function el(/** @type {string} */ tag, /** @type {string} */ cls = '', /** @type {any} */ content = null) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (typeof content === 'string') e.textContent = content;
    else if (Array.isArray(content)) for (const c of content) if (c) e.append(c);
    return e;
}

/**
 * A field: a select for a list (or a short range with names), else a
 * number input. onChange(value) gets numbers back as numbers.
 * @param {{ label: string, lo?: number, hi?: number, list?: readonly (string|number)[], as?: (v: any) => string }} spec
 * @param {any} value
 * @param {(v: any) => void} onChange
 * @param {readonly (string|number)[] | null} [list]
 */
function field(spec, value, onChange, list = null) {
    const wrap = el('label', 'tp-field');
    if (spec.label) wrap.append(el('span', '', spec.label));
    // a range with names for its values (off, any, a note) is a list too
    const options = list ?? spec.list ?? (spec.as ? range(spec.lo, spec.hi) : null);
    if (options) {
        const select = el('select');
        for (const o of options) {
            const opt = el('option', '', spec.as ? spec.as(o) : String(o));
            opt.value = String(o);
            if (o === value) opt.selected = true;
            select.append(opt);
        }
        select.addEventListener('change', () => {
            const o = options[select.selectedIndex];
            onChange(o);
        });
        wrap.append(select);
    } else {
        const input = el('input');
        input.type = 'number';
        input.min = String(spec.lo);
        input.max = String(spec.hi);
        input.value = String(value);
        input.addEventListener('change', () => {
            const v = Math.round(Number(input.value));
            const ok = Number.isFinite(v) ? Math.min(spec.hi, Math.max(spec.lo, v)) : value;
            input.value = String(ok);
            onChange(ok);
        });
        wrap.append(input);
    }
    return wrap;
}

const range = (/** @type {number} */ lo, /** @type {number} */ hi) =>
    Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);

// a step being painted: pressing one turns it on or off, and dragging over
// others while the button's held sets them the same way; the change is
// kept (and the editor drawn again) once it's let go
/** @type {{ to: boolean, done: () => void } | null} */
let painting = null;
if (typeof window !== 'undefined')
    window.addEventListener('pointerup', () => {
        const p = painting;
        painting = null;
        p?.done();
    });

/** a step button that paints (above); `set` changes it, `done` keeps the strokes */
function paintable(
    /** @type {HTMLElement} */ btn,
    /** @type {() => boolean} */ isOn,
    /** @type {(on: boolean) => void} */ set,
    /** @type {() => void} */ done
) {
    const put = (/** @type {boolean} */ on) => {
        if (isOn() === on) return;
        set(on);
        btn.classList.toggle('on', on);
    };
    btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // a touch captures the pointer: let go, so the next steps hear it
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
        painting = { to: !isOn(), done };
        put(painting.to);
    });
    btn.addEventListener('pointerenter', () => {
        if (painting) put(painting.to);
    });
    // Enter or Space (a click with no pointer) toggles it
    btn.addEventListener('click', (e) => {
        if (e.detail !== 0) return;
        set(!isOn());
        done();
    });
}

/** a small button: label, tooltip, what it does; disabled says why it can't */
function button(/** @type {string} */ label, /** @type {string} */ title, /** @type {() => void} */ fn, disabled = '') {
    const b = el('button', 'repl-action-btn tp-small', label);
    b.type = 'button';
    b.title = disabled || title;
    b.disabled = Boolean(disabled);
    b.addEventListener('click', fn);
    return b;
}

/**
 * A number input you can drag: up raises it, down lowers it, a step every
 * few pixels (shift: by `big`, an octave for a note), and the mouse wheel
 * does the same. onMove(v) follows it as it goes; once let go (or the
 * wheel rests) the input's own change handler takes the value. A click
 * without moving still puts the cursor in it, for typing.
 * @param {HTMLInputElement} input
 * @param {{ big?: number, px?: number, onMove?: (v: number) => void }} [opts]
 */
// `show` and `read`: a field that shows its number as a name (a chance's
// "1:2"), with its range in `lo` and `hi`
function draggable(
    input,
    { big = 10, px = 4, onMove, show = String, read = Number, lo = Number(input.min), hi = Number(input.max) } = {}
) {
    // prettier-ignore
    const clamp = (/** @type {number} */ v) => Math.min(hi, Math.max(lo, v));
    const set = (/** @type {number} */ v) => {
        if (show(v) === input.value) return;
        input.value = show(v);
        onMove?.(v);
    };
    const commit = () => input.dispatchEvent(new Event('change'));
    let startY = 0, start = 0, moved = false, /** @type {number | null} */ id = null; // prettier-ignore
    input.classList.add('tp-drag');
    input.title ||= 'drag up or down, or scroll (shift: faster); click to type';
    input.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        startY = e.clientY;
        start = read(input.value) ?? lo;
        moved = false;
        id = e.pointerId;
        input.setPointerCapture(id);
    });
    input.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const dy = startY - e.clientY;
        if (!moved && Math.abs(dy) < 3) return;
        if (!moved) {
            moved = true;
            input.blur();
        }
        e.preventDefault();
        set(clamp(start + Math.trunc(dy / px) * (e.shiftKey ? big : 1)));
    });
    const end = (/** @type {PointerEvent} */ e) => {
        if (e.pointerId !== id) return;
        input.releasePointerCapture(e.pointerId);
        id = null;
        if (moved) commit();
    };
    input.addEventListener('pointerup', end);
    input.addEventListener('pointercancel', end);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let rest;
    input.addEventListener(
        'wheel',
        (e) => {
            e.preventDefault();
            set(clamp((read(input.value) ?? lo) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? big : 1)));
            clearTimeout(rest);
            rest = setTimeout(commit, 400);
        },
        { passive: false }
    );
}

/** a name as the device can show it: lowercase, its characters, its length */
const deviceName = (/** @type {string} */ s, /** @type {number} */ max) =>
    [...s.toLowerCase()]
        .filter((c) => NAME_CHARS.includes(c))
        .join('')
        .slice(0, max);

export const trellisUiMethods = {
    /** "edit preset" in a trellis preset's file menu */
    async openTrellisPreset(fileName) {
        let text;
        try {
            text = await this.readRemoteFile(fileName);
        } catch (error) {
            this.outputLine(`trellis: couldn't read ${fileName}: ${error.message}`);
            return;
        }
        let preset;
        try {
            preset = parsePreset(text);
        } catch (error) {
            this.outputLine(`trellis: ${fileName} isn't a preset trellis can read (${error.message})`);
            return;
        }
        this.trellisOpen(fileName, preset);
    },

    /** "edit settings" in trellis.cfg's file menu: setup's pages as a form */
    async openTrellisCfg() {
        let text;
        try {
            text = await this.readRemoteFile(TRELLIS_CFG);
        } catch (error) {
            this.outputLine(`trellis: couldn't read ${TRELLIS_CFG}: ${error.message}`);
            return;
        }
        let cfg;
        try {
            cfg = parseCfg(text);
        } catch (error) {
            this.outputLine(`trellis: ${TRELLIS_CFG} isn't settings trellis can read (${error.message})`);
            return;
        }
        this.trellisCfg = { cfg, dirty: false };
        this.trellisCfgModal().style.display = 'flex';
        this.renderTrellisCfg();
    },

    trellisCfgModal() {
        if (this.trellisCfgModalEl) return this.trellisCfgModalEl;
        const modal = el('div', 'modal tp-modal tc-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'trellis settings');
        modal.append(el('div', 'modal-content tp-content'));
        document.addEventListener('keydown', (event) => {
            if (modal.style.display !== 'flex') return;
            if (event.key === 'Escape') this.closeTrellisCfg();
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                this.saveTrellisCfg();
            }
        });
        document.body.append(modal);
        this.trellisCfgModalEl = modal;
        return modal;
    },

    closeTrellisCfg() {
        if (this.trellisCfg?.dirty && !confirm('Close without saving the changes to the settings?')) return;
        this.trellisCfgModal().style.display = 'none';
        this.trellisCfg = null;
    },

    renderTrellisCfg() {
        const s = this.trellisCfg;
        if (!s) return;
        const content = this.trellisCfgModal().querySelector('.tp-content');
        content.replaceChildren();
        const save = el('button', 'repl-action-btn', 'save');
        save.type = 'button';
        save.title = 'write trellis.cfg; a running trellis takes the settings at once (Ctrl+S)';
        save.addEventListener('click', () => this.saveTrellisCfg());
        const close = el('button', 'editor-close-btn', '✕');
        close.type = 'button';
        close.title = 'close (Esc)';
        close.setAttribute('aria-label', 'close');
        close.addEventListener('click', () => this.closeTrellisCfg());
        const dirty = el('span', 'tp-dirty', '● unsaved');
        dirty.hidden = !s.dirty;
        content.append(
            el('div', 'reference-header tp-header', [
                el('h2', 'firmware-title', `trellis · settings (${TRELLIS_CFG})`),
                dirty,
                el('div', 'repl-actions-spacer'),
                save,
                close
            ])
        );
        const main = el('div', 'tp-main tc-main');
        main.append(
            el(
                'p',
                'tp-note',
                'Setup’s pages (shift + K15 on achene): kept apart from the presets. ' +
                    (s.cfg.preset === null
                        ? 'No preset is loaded at power-up (the defaults).'
                        : `Preset ${s.cfg.preset} is loaded at power-up: the one loaded or saved last on achene.`)
            )
        );
        const spec = Object.fromEntries(CFG_FIELDS.map((f) => [f[0], f]));
        for (const [title, fields] of CFG_GROUPS) {
            const box = el('div', 'tp-group tp-track-settings', [el('div', 'tp-group-title', title)]);
            for (const [key, label, as] of fields) {
                const [, , a, b] = spec[key];
                const list = Array.isArray(a) ? a : null;
                box.append(
                    field({ label, lo: list ? 0 : a, hi: list ? 0 : b, list, as }, s.cfg[key], (v) => {
                        s.cfg[key] = v;
                        s.dirty = true;
                        dirty.hidden = false;
                    })
                );
            }
            main.append(box);
        }
        content.append(main);
    },

    /**
     * A data file (not Lua: trellis.cfg is a bare table) written as a script
     * writes one, with fs_write_file: an upload is compiled first, and fails.
     * Sent in pieces, as the console takes lines of 512 bytes at most, then
     * read back. Whether it's on the device as given.
     */
    async writeDataFile(/** @type {string} */ name, /** @type {string} */ text) {
        const lines = ["__gh_w = ''"];
        for (let i = 0; i < text.length; i += 200)
            lines.push(`__gh_w = __gh_w .. ${this.luaQuote(text.slice(i, i + 200))}`);
        lines.push(
            `fs_write_file(${this.luaQuote(name)}, __gh_w) ` +
                `print(fs_read_file(${this.luaQuote(name)}) == __gh_w and 'written' or 'not written') __gh_w = nil`
        );
        try {
            const out = await this.executeLuaCapture(lines);
            if (out.map((l) => String(l).trim()).includes('written')) return true;
            this.outputLine(`${name}: the device didn't keep it (${out.join(' ')})`);
        } catch (error) {
            this.outputLine(`${name}: ${error.message}`);
        }
        return false;
    },

    async saveTrellisCfg() {
        const s = this.trellisCfg;
        if (!s) return;
        const text = serializeCfg(s.cfg);
        if (!(await this.writeDataFile(TRELLIS_CFG, text))) {
            alert(`${TRELLIS_CFG} wasn't written; the console says why.`);
            return;
        }
        s.dirty = false;
        // trellis 1.15.0 and later takes them at once
        let did = 'none';
        try {
            const lines = await this.executeLuaCapture('print(trellis_cfg and trellis_cfg() or "none")');
            did = lines.map((l) => String(l).trim()).find((l) => l === 'ok' || l === 'bad' || l === 'none') ?? 'none';
        } catch {
            did = 'none';
        }
        this.outputLine(
            `trellis: saved ${TRELLIS_CFG}. ` +
                (did === 'ok'
                    ? 'trellis uses the settings now.'
                    : did === 'bad'
                      ? "trellis couldn't read it."
                      : 'trellis takes them the next time it starts.')
        );
        this.refreshFileList?.();
        this.renderTrellisCfg();
    },

    /** the editor's dialog, made the first time */
    trellisModal() {
        if (this.trellisModalEl) return this.trellisModalEl;
        const modal = el('div', 'modal tp-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'trellis preset');
        modal.append(el('div', 'modal-content tp-content'));
        // the keys anywhere on the page while it's open (after a click on a
        // step the focus isn't inside it)
        document.addEventListener('keydown', (event) => {
            if (modal.style.display !== 'flex') return;
            if (event.key === 'Escape') this.closeTrellisPreset();
            if (!(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            // a number or name being typed keeps its own undo
            const target = /** @type {HTMLElement} */ (event.target);
            const typing = target.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (target).type !== 'button';
            if (key === 's') {
                event.preventDefault();
                const to = /** @type {HTMLSelectElement | null} */ (modal.querySelector('.tp-save-to'));
                if (to) this.saveTrellisPreset(`pset_trellis_${to.value}.lua`);
            } else if (!typing && (key === 'z' || key === 'y')) {
                event.preventDefault();
                this.trellisUndo(key === 'y' || event.shiftKey ? 1 : -1);
            }
        });
        document.body.append(modal);
        this.trellisModalEl = modal;
        return modal;
    },

    closeTrellisPreset() {
        if (this.trellis?.dirty && !confirm('Close without saving the changes to this preset?')) return;
        this.trellisModal().style.display = 'none';
        this.trellis = null;
    },

    trellisChanged() {
        const t = this.trellis;
        t.dirty = true;
        const mark = this.trellisModalEl?.querySelector('.tp-dirty');
        if (mark) mark.hidden = false;
        // the undo history: the preset as text after each change (the
        // serializer is exact, so a step back is the file as it was)
        const now = serializePreset(t.preset);
        if (t.history[t.at] !== now) {
            // the steps undone are dropped (and the saved one, if among them)
            if (t.savedAt > t.at) t.savedAt = -1;
            t.history.splice(t.at + 1);
            t.history.push(now);
            if (t.history.length > 200) {
                t.history.shift();
                t.savedAt--;
            }
            t.at = t.history.length - 1;
        }
        this.trellisUndoButtons();
    },

    /** a step back (-1) or forward (1) in the undo history */
    trellisUndo(/** @type {number} */ d) {
        const t = this.trellis;
        const at = t?.at + d;
        if (!t || at < 0 || at >= t.history.length) return;
        t.at = at;
        t.preset = parsePreset(t.history[at]);
        t.dirty = at !== t.savedAt;
        this.renderTrellis();
    },

    trellisUndoButtons() {
        const t = this.trellis;
        const m = this.trellisModalEl;
        if (!t || !m) return;
        const undo = /** @type {HTMLButtonElement | null} */ (m.querySelector('.tp-undo'));
        const redo = /** @type {HTMLButtonElement | null} */ (m.querySelector('.tp-redo'));
        if (undo) undo.disabled = t.at <= 0;
        if (redo) redo.disabled = t.at >= t.history.length - 1;
    },

    /** a new preset, empty, as the first number with no preset on the device */
    trellisNew() {
        const t = this.trellis;
        if (t?.dirty && !confirm('Start a new preset? The changes to this one aren’t saved.')) return;
        const used = new Set(
            (this.fileEntries ?? []).map((e) => Number(TRELLIS_PRESET.exec(e.name)?.[1] ?? 0)).filter(Boolean)
        );
        let n = 1;
        while (used.has(n) && n < 16) n++;
        const preset = emptyPreset();
        if (t) preset.version = t.preset.version;
        this.trellisOpen(`pset_trellis_${n}.lua`, preset, true);
    },

    /** the editor on a preset (fresh: not on the device yet) */
    trellisOpen(/** @type {string} */ fileName, preset, fresh = false) {
        const first = serializePreset(preset);
        this.trellis = {
            fileName, preset, fresh, view: 1, pattern: {}, page: {}, lane: {}, dirty: fresh,
            history: [first], at: 0, savedAt: fresh ? -1 : 0
        }; // prettier-ignore
        this.trellisModal().style.display = 'flex';
        this.renderTrellis();
    },

    async saveTrellisPreset(fileName) {
        const text = serializePreset(this.trellis.preset);
        const keepOld = await hasExactFiles(this.backupApi());
        if (!(await this.uploadChecked(fileName, text, { keepOld }))) {
            alert(`${fileName} wasn't written; the console says why.`);
            return;
        }
        this.trellis.fileName = fileName;
        this.trellis.dirty = false;
        this.trellis.fresh = false;
        this.trellis.savedAt = this.trellis.at;
        const n = TRELLIS_PRESET.exec(fileName)?.[1];
        // trellis 1.11.0 and later loads it again if it's the preset playing
        // (trellis_reload returns what it did); older or not running: "none"
        let did = 'none';
        try {
            const lines = await this.executeLuaCapture(
                `print(trellis_reload and trellis_reload(${Number(n)}) or "none")`
            );
            did = lines.map((l) => String(l).trim()).find((l) => Object.hasOwn(RELOAD_SAYS, l)) ?? 'none';
        } catch {
            did = 'none';
        }
        this.outputLine(`trellis: saved ${fileName}. ${RELOAD_SAYS[did](n)}`);
        this.refreshFileList?.();
        this.renderTrellis();
    },

    renderTrellis() {
        const t = this.trellis;
        if (!t) return;
        const content = this.trellisModal().querySelector('.tp-content');
        // an edit redraws the editor: keep where it was scrolled to, unless
        // another bank or page is shown
        const keep =
            t.shown === t.view
                ? {
                      top: content.querySelector('.tp-main')?.scrollTop ?? 0,
                      left: content.querySelector('.tp-steps-wrap')?.scrollLeft ?? 0
                  }
                : null;
        t.shown = t.view;
        content.replaceChildren();
        const n = Number(TRELLIS_PRESET.exec(t.fileName)?.[1] ?? 1);

        // header: the file, save (to its number or another), close
        const slot = el('select', 'tp-save-to');
        slot.setAttribute('aria-label', 'save as preset number');
        for (let k = 1; k <= 16; k++) {
            const o = el('option', '', `preset ${k}`);
            o.value = String(k);
            o.selected = k === n;
            slot.append(o);
        }
        const save = el('button', 'repl-action-btn', 'save');
        save.type = 'button';
        save.title = 'write the preset to the device, as the number picked (Ctrl+S)';
        save.addEventListener('click', () => this.saveTrellisPreset(`pset_trellis_${slot.value}.lua`));
        const undo = button('↶ undo', 'undo the last change (Ctrl+Z)', () => this.trellisUndo(-1));
        undo.classList.add('tp-undo');
        const redo = button('↷ redo', 'redo (Ctrl+Shift+Z or Ctrl+Y)', () => this.trellisUndo(1));
        redo.classList.add('tp-redo');
        undo.disabled = t.at <= 0;
        redo.disabled = t.at >= t.history.length - 1;
        const fresh = button('new', 'start a new preset, empty, as the first free number', () => this.trellisNew());
        const close = el('button', 'editor-close-btn', '✕');
        close.type = 'button';
        close.title = 'close (Esc)';
        close.setAttribute('aria-label', 'close');
        close.addEventListener('click', () => this.closeTrellisPreset());
        const dirty = el('span', 'tp-dirty', '● unsaved');
        dirty.hidden = !t.dirty;
        const clip = this.trellisClip;
        const copied = el('span', 'tp-clip', clip ? `copied: ${clip.what}` : '');
        copied.title = 'what paste puts in';
        content.append(
            el('div', 'reference-header tp-header', [
                el('h2', 'firmware-title', `trellis · ${t.fresh ? 'new preset' : t.fileName}`),
                el('span', 'tp-version', t.fresh ? 'not on achene yet' : `written by trellis ${t.preset.version}`),
                dirty,
                el('div', 'repl-actions-spacer'),
                copied,
                undo,
                redo,
                fresh,
                slot,
                save,
                close
            ])
        );

        // the banks down the side, then the performance page's
        const nav = el('nav', 'tp-nav');
        for (let b = 1; b <= NB; b++) {
            const track = t.preset.tracks[b];
            const kind = track && track.kind !== 'slots' ? track.kind : 'slots';
            const item = el('button', `tp-nav-item${t.view === b ? ' active' : ''}`, [
                el('span', 'tp-letter', LETTERS[b - 1]),
                el(
                    'span',
                    `tp-nav-name${t.preset.names[b - 1] ? '' : ' unnamed'}`,
                    t.preset.names[b - 1] || `bank ${LETTERS[b - 1]}`
                ),
                el('span', 'tp-nav-kind', kind === 'slots' ? '' : kind)
            ]);
            item.style.setProperty('--bank', COLOURS[b - 1]);
            item.type = 'button';
            item.addEventListener('click', () => {
                t.view = b;
                this.renderTrellis();
            });
            nav.append(item);
        }
        const perf = el('button', `tp-nav-item${t.view === 'perform' ? ' active' : ''}`, [
            el('span', 'tp-letter', '▶'),
            el('span', 'tp-nav-name', 'scenes, song')
        ]);
        perf.type = 'button';
        perf.addEventListener('click', () => {
            t.view = 'perform';
            this.renderTrellis();
        });
        nav.append(perf);

        const main = el('div', 'tp-main');
        if (t.view === 'perform') this.renderTrellisPerform(main);
        else this.renderTrellisBank(main, t.view);
        content.append(el('div', 'tp-body', [nav, main]));
        if (keep) {
            main.scrollTop = keep.top;
            const steps = main.querySelector('.tp-steps-wrap');
            if (steps) steps.scrollLeft = keep.left;
        }
    },

    // ---------------------------------------------------------------- a bank

    renderTrellisBank(main, b) {
        const p = this.trellis.preset;
        const track = p.tracks[b];
        const kind = track ? track.kind : 'slots';
        const name = el('input', 'tp-name');
        name.value = p.names[b - 1];
        name.maxLength = 10;
        name.placeholder = `bank ${LETTERS[b - 1]}`;
        name.addEventListener('input', () => {
            const v = deviceName(name.value, 10);
            if (v !== name.value) name.value = v;
            p.names[b - 1] = v;
            this.trellisChanged();
        });
        const type = field({ label: 'type', list: KINDS }, kind, (v) => {
            p.tracks[b] ??= newTrack(b);
            p.tracks[b].kind = v;
            if (v === 'drums' && !RANDOM_WHAT.drums.includes(p.tracks[b].rwhat)) p.tracks[b].rwhat = 'steps';
            this.trellisChanged();
            this.renderTrellis();
        });
        const clip = this.trellisClip;
        const copyBank = button('copy bank', 'its name, its eight slots and its track', () => {
            this.trellisClip = {
                kind: 'bank',
                what: `bank ${LETTERS[b - 1]}`,
                name: p.names[b - 1],
                slots: p.slots.slice((b - 1) * NS, b * NS).map((x) => structuredClone(x)),
                track: p.tracks[b] ? structuredClone(p.tracks[b]) : null
            };
            this.renderTrellis();
        });
        const pasteBank = button(
            'paste bank',
            `bank ${clip?.kind === 'bank' ? clip.what.slice(5) : ''}'s name, slots and track, over this one's`,
            () => {
                p.names[b - 1] = clip.name;
                clip.slots.forEach((x, i) => (p.slots[(b - 1) * NS + i] = structuredClone(x)));
                if (clip.track) p.tracks[b] = structuredClone(clip.track);
                else delete p.tracks[b];
                this.trellisChanged();
                this.renderTrellis();
            },
            clip?.kind === 'bank' ? '' : 'copy a bank first'
        );
        main.append(
            el('div', 'tp-bank-head', [
                el('label', 'tp-field tp-name-field', [el('span', '', `bank ${LETTERS[b - 1]}`), name]),
                type,
                el('div', 'repl-actions-spacer'),
                copyBank,
                pasteBank
            ])
        );
        if (kind === 'slots') {
            const grid = el('div', 'tp-slots');
            for (let i = 1; i <= NS; i++) grid.append(this.trellisSlotCard(b, i));
            main.append(grid);
            if (track)
                main.append(
                    el(
                        'p',
                        'tp-note',
                        'This bank also keeps a track, from when it was one: turn its type back to see it.'
                    )
                );
        } else {
            this.renderTrellisTrack(main, b, track);
        }
    },

    trellisSlotCard(b, i) {
        const p = this.trellis.preset;
        const x = (b - 1) * NS + i - 1;
        const s = p.slots[x];
        const card = el('section', 'tp-slot');
        const draw = () => {
            card.replaceChildren();
            const name = el('input', 'tp-slot-name');
            name.value = s.name;
            name.maxLength = 8;
            name.placeholder = 'name';
            name.title = 'its name on the play screen (8 characters; none: what it sends)';
            name.addEventListener('input', () => {
                const v = deviceName(name.value, 8);
                if (v !== name.value) name.value = v;
                s.name = v;
                this.trellisChanged();
            });
            const clip = this.trellisClip;
            const copy = button('copy', 'this slot: its encoder, key, LFO or motion and name', () => {
                this.trellisClip = { kind: 'slot', what: `slot ${LETTERS[b - 1]}${i}`, slot: structuredClone(s) };
                this.renderTrellis();
            });
            const paste = button(
                'paste',
                `${clip?.kind === 'slot' ? clip.what : 'the slot copied'} over this one`,
                () => {
                    Object.assign(s, structuredClone(clip.slot));
                    this.trellisChanged();
                    this.renderTrellis();
                },
                clip?.kind === 'slot' ? '' : 'copy a slot first'
            );
            card.append(
                el('div', 'tp-slot-head', [el('span', 'tp-slot-id', `E${i + 4} · K${i + 4}`), name, copy, paste])
            );
            const change = (/** @type {string} */ id) => (/** @type {any} */ v) => {
                s[id] = v;
                if (id === 'ktype') {
                    const modes = keyModes(v);
                    if (modes && !modes.includes(s.kmode)) s.kmode = modes[0];
                }
                this.trellisChanged();
                draw();
            };
            for (const [group, title] of /** @type {const} */ ([
                ['e', 'encoder'],
                ['mod', s.mod === 'lfo' ? 'its LFO' : 'its motion'],
                ['k', 'key']
            ])) {
                const fields = SLOT_FIELDS.filter((f) => f.group === group && (!f.when || f.when(s)));
                if (!fields.length) continue;
                const box = el('div', 'tp-group', [el('div', 'tp-group-title', title)]);
                for (const f of fields) {
                    let spec = f;
                    let list = null;
                    if (f.id === 'kmode') list = keyModes(s.ktype);
                    if (f.id === 'knum') {
                        spec = { ...f, label: s.ktype === 'note' ? 'note' : s.ktype === 'prog' ? 'program' : 'cc' };
                        if (s.ktype === 'note') spec.as = (v) => `${noteName(v)} (${v})`;
                    }
                    box.append(field(spec, s[f.id], change(f.id), list));
                }
                if (group === 'mod' && s.mod === 'motion')
                    box.append(
                        el('p', 'tp-note', s.mdata ? `a take of ${(s.mdata.length / 50).toFixed(1)} s` : 'no take yet')
                    );
                card.append(box);
            }
        };
        draw();
        return card;
    },

    // ---------------------------------------------------------------- a track

    renderTrellisTrack(main, b, track) {
        const t = this.trellis;
        const viewed = t.pattern[b] ?? track.pat;
        const pat = patternOf(track, viewed);

        // the settings
        const settings = el('div', 'tp-group tp-track-settings', [el('div', 'tp-group-title', 'track')]);
        for (const s of TRACK_SETTINGS) {
            if (s.when && !s.when(track)) continue;
            settings.append(
                field(s, track[s.id], (v) => {
                    track[s.id] = v;
                    this.trellisChanged();
                    this.renderTrellis();
                }, s.opts ? s.opts(track) : null)
            ); // prettier-ignore
        }
        main.append(settings);

        // the patterns: the one shown, the one playing
        const bar = el('div', 'tp-patterns');
        for (let n = 1; n <= NP; n++) {
            const has = n === track.pat || Object.keys(track.pats[n]?.lanes ?? {}).length > 0;
            const btn = el(
                'button',
                `tp-pat${n === viewed ? ' active' : ''}${has ? ' has' : ''}`,
                `P${n}${n === track.pat ? ' ▶' : ''}`
            );
            btn.type = 'button';
            btn.title = n === track.pat ? 'the pattern playing' : has ? 'a pattern with steps' : 'an empty pattern';
            btn.addEventListener('click', () => {
                t.pattern[b] = n;
                this.renderTrellis();
            });
            bar.append(btn);
        }
        if (viewed !== track.pat) {
            const play = el('button', 'repl-action-btn', 'make it the one playing');
            play.type = 'button';
            play.title = 'trellis loads the preset on this pattern';
            play.addEventListener('click', () => {
                switchPattern(track, viewed);
                this.trellisChanged();
                this.renderTrellis();
            });
            bar.append(play);
        }
        const clip = this.trellisClip;
        bar.append(
            button(`copy P${viewed}`, 'its steps and length, to paste into another pattern', () => {
                this.trellisClip = {
                    kind: 'pattern',
                    what: `P${viewed} of ${LETTERS[b - 1]}`,
                    trackKind: track.kind,
                    len: pat.len,
                    lanes: structuredClone(pat.lanes)
                };
                this.renderTrellis();
            }),
            button(
                `paste into P${viewed}`,
                `${clip?.kind === 'pattern' ? clip.what : 'the pattern copied'} over P${viewed}: its steps and length`,
                () => {
                    const target = patternOf(track, viewed);
                    target.len = clip.len;
                    target.lanes = structuredClone(clip.lanes);
                    this.trellisChanged();
                    this.renderTrellis();
                },
                clip?.kind !== 'pattern'
                    ? 'copy a pattern first'
                    : clip.trackKind !== track.kind
                      ? `a ${clip.trackKind} pattern doesn't fit a ${track.kind} track`
                      : ''
            )
        );
        const len = field({ label: 'length (steps)', lo: 1, hi: MAX_STEPS }, pat.len, (v) => {
            pat.len = v;
            this.trellisChanged();
            this.renderTrellis();
        });
        bar.append(len);
        main.append(bar);

        // the steps, a page at a time
        const pages = Math.ceil(pat.len / PAGE);
        const page = Math.min(t.page[b] ?? 1, pages);
        const first = (page - 1) * PAGE + 1;
        const last = Math.min(pat.len, first + PAGE - 1);
        const nav = el('div', 'tp-pages');
        for (let k = 1; k <= pages; k++) {
            const btn = el(
                'button',
                `tp-page${k === page ? ' active' : ''}`,
                `${(k - 1) * PAGE + 1}–${Math.min(pat.len, k * PAGE)}`
            );
            btn.type = 'button';
            btn.addEventListener('click', () => {
                t.page[b] = k;
                this.renderTrellis();
            });
            nav.append(btn);
        }
        main.append(nav);
        const grid = el('table', 'tp-steps');
        const head = el('tr', '', [el('th', '', 'step')]);
        for (let k = first; k <= last; k++) head.append(el('th', (k - 1) % 4 === 0 ? 'tp-beat' : '', String(k)));
        grid.append(head);
        const redraw = () => this.renderTrellis();
        if (track.kind === 'melodic') this.trellisMelodicRows(grid, pat, first, last, redraw);
        else this.trellisDrumRows(grid, b, track, pat, first, last, redraw);
        main.append(el('div', 'tp-steps-wrap', [grid]));
        if (track.kind === 'drums') main.append(this.trellisKit(track));
    },

    trellisMelodicRows(grid, pat, first, last, redraw) {
        const row = (/** @type {string} */ label) => {
            const tr = el('tr', '', [el('th', '', label)]);
            grid.append(tr);
            return tr;
        };
        const on = row('on');
        for (let k = first; k <= last; k++) {
            const cell = el('td');
            const btn = el('button', `tp-cell${laneAt(pat, 'on', k) === 1 ? ' on' : ''}`);
            btn.type = 'button';
            btn.setAttribute('aria-label', `step ${k}`);
            btn.title = 'click to turn on or off; drag across steps to paint them';
            paintable(
                btn,
                () => laneAt(pat, 'on', k) === 1,
                (v) => setLane(pat, 'on', k, v ? 1 : 0),
                () => {
                    this.trellisChanged();
                    redraw();
                }
            );
            cell.append(btn);
            on.append(cell);
        }
        /** @type {HTMLElement[]} */
        const names = [];
        for (const [lane, label, lo, hi] of /** @type {const} */ ([
            ['note', 'note', 0, 127],
            ['vel', 'velocity', 1, 127],
            ['gate', 'gate (1/8s)', 1, MAX_STEPS],
            ['prob', 'chance', 0, CHANCE_TOP]
        ])) {
            const tr = row(label);
            if (lane === 'note') {
                // the names row goes under the notes; made first, so a drag can follow
                for (let k = first; k <= last; k++)
                    names.push(el('td', 'tp-note-name', noteName(laneAt(pat, 'note', k))));
            }
            for (let k = first; k <= last; k++) {
                if (lane === 'prob') {
                    tr.append(el('td', '', [this.trellisChance(pat, lane, k, redraw)]));
                    continue;
                }
                const input = el('input', 'tp-step-input');
                input.type = 'number';
                input.min = String(lo);
                input.max = String(hi);
                input.value = String(laneAt(pat, lane, k));
                input.addEventListener('change', () => {
                    const v = Math.min(hi, Math.max(lo, Math.round(Number(input.value)) || lo));
                    setLane(pat, lane, k, v);
                    this.trellisChanged();
                    redraw();
                });
                draggable(input, {
                    big: lane === 'note' ? 12 : 10,
                    onMove: lane === 'note' ? (v) => (names[k - first].textContent = noteName(v)) : undefined
                });
                tr.append(el('td', '', [input]));
            }
            if (lane === 'note') row('').append(...names);
        }
    },

    trellisDrumRows(grid, b, track, pat, first, last, redraw) {
        const picked = this.trellis.lane[b] ?? 1;
        for (let l = 1; l <= 8; l++) {
            const label = el('button', `tp-lane${l === picked ? ' active' : ''}`, `${l} · ${track.kit.dn[l - 1]}`);
            label.type = 'button';
            label.title = `lane ${l}: note ${track.kit.dn[l - 1]} (${noteName(track.kit.dn[l - 1])}); its velocities and chances below`;
            label.addEventListener('click', () => {
                this.trellis.lane[b] = l;
                redraw();
            });
            const tr = el('tr', '', [el('th', '', [label])]);
            for (let k = first; k <= last; k++) {
                const v = laneAt(pat, `d${l}`, k);
                const btn = el('button', `tp-cell${v >= 128 ? ' on' : ''}`);
                btn.type = 'button';
                if (v >= 128) btn.style.opacity = String(0.35 + (0.65 * (v - 128)) / 127);
                btn.setAttribute('aria-label', `lane ${l} step ${k}`);
                btn.title = 'click for a hit or none; drag across steps to paint them';
                paintable(
                    btn,
                    () => laneAt(pat, `d${l}`, k) >= 128,
                    (on) => setLane(pat, `d${l}`, k, (laneAt(pat, `d${l}`, k) & 127) | (on ? 128 : 0)),
                    () => {
                        this.trellisChanged();
                        redraw();
                    }
                );
                tr.append(el('td', '', [btn]));
            }
            grid.append(tr);
        }
        for (const [lane, label, lo, hi] of /** @type {const} */ ([
            [`d${picked}`, `lane ${picked} vel`, 1, 127],
            [`q${picked}`, `lane ${picked} chance`, 0, CHANCE_TOP]
        ])) {
            const tr = el('tr', 'tp-lane-values', [el('th', '', label)]);
            for (let k = first; k <= last; k++) {
                if (lane.startsWith('q')) {
                    tr.append(el('td', '', [this.trellisChance(pat, lane, k, redraw)]));
                    continue;
                }
                const raw = laneAt(pat, lane, k);
                const input = el('input', 'tp-step-input');
                input.type = 'number';
                input.min = String(lo);
                input.max = String(hi);
                input.value = String(lane.startsWith('d') ? raw % 128 : raw);
                input.addEventListener('change', () => {
                    const v = Math.min(hi, Math.max(lo, Math.round(Number(input.value)) || lo));
                    setLane(pat, lane, k, lane.startsWith('d') ? (raw & 128) + v : v);
                    this.trellisChanged();
                    redraw();
                });
                draggable(input);
                tr.append(el('td', '', [input]));
            }
            grid.append(tr);
        }
    },

    /**
     * step k's chance or trig condition (a chance lane past 100): typed as
     * "50", "1:2", "1st" or "!1st", or dragged, 0% up through the conditions
     */
    trellisChance(pat, lane, k, redraw) {
        const input = el('input', 'tp-step-input tp-chance');
        input.type = 'text';
        input.value = chanceName(laneAt(pat, lane, k));
        input.addEventListener('change', () => {
            const v = parseChance(input.value);
            if (v !== null) {
                setLane(pat, lane, k, v);
                this.trellisChanged();
            }
            redraw();
        });
        draggable(input, { show: chanceName, read: parseChance, lo: 0, hi: CHANCE_TOP });
        input.title =
            'chance 0-100%, or past 100% a condition: 1:2 plays on the first pass of every two, ' +
            '1st on the first pass only, !1st on all but it. Drag, scroll, or type';
        return input;
    },

    /** a drums track's kit: each lane's note and channel */
    trellisKit(track) {
        const box = el('div', 'tp-group tp-kit', [el('div', 'tp-group-title', 'kit')]);
        for (let l = 1; l <= 8; l++) {
            const note = field(
                { label: `lane ${l} · ${noteName(track.kit.dn[l - 1])}`, lo: 0, hi: 127 },
                track.kit.dn[l - 1],
                (v) => {
                    track.kit.dn = track.kit.dn.slice();
                    track.kit.dn[l - 1] = v;
                    this.trellisChanged();
                    this.renderTrellis();
                }
            );
            const ch = field(
                { label: 'chan', lo: 0, hi: 16, as: (v) => (v === 0 ? 'track' : String(v)) },
                track.kit.dc[l - 1],
                (v) => {
                    track.kit.dc = track.kit.dc.slice();
                    track.kit.dc[l - 1] = v;
                    this.trellisChanged();
                }
            );
            const label = note.querySelector('span');
            draggable(/** @type {HTMLInputElement} */ (note.querySelector('input')), {
                big: 12,
                onMove: (v) => {
                    if (label) label.textContent = `lane ${l} · ${noteName(v)}`;
                }
            });
            box.append(el('div', 'tp-kit-lane', [note, ch]));
        }
        return box;
    },

    // ---------------------------------------------------------------- performance

    renderTrellisPerform(main) {
        const p = this.trellis.preset;
        const redraw = () => this.renderTrellis();
        const tracks = range(1, NB).filter((b) => p.tracks[b] && p.tracks[b].kind !== 'slots');

        // scenes: each track's pattern and mute
        const scenes = el('div', 'tp-group', [el('div', 'tp-group-title', 'scenes (the performance page, K2 once)')]);
        if (!tracks.length)
            scenes.append(
                el('p', 'tp-note', 'Scenes hold the tracks’ patterns and mutes: this preset has no tracks yet.')
            );
        else {
            const table = el('table', 'tp-scenes');
            table.append(
                el('tr', '', [
                    el('th', '', ''),
                    ...tracks.map((b) => el('th', '', `${LETTERS[b - 1]} ${p.names[b - 1]}`))
                ])
            );
            // the first eight, and one empty row past the highest stored, so
            // the list grows as scenes are stored
            let rows = this.trellis.allScenes ? SCENES : 8;
            for (let k = 1; k <= SCENES; k++) if (p.scenes[k]) rows = Math.max(rows, Math.min(SCENES, k + 1));
            for (let k = 1; k <= rows; k++) {
                const sc = p.scenes[k];
                const stored = el('input');
                stored.type = 'checkbox';
                stored.checked = Boolean(sc);
                stored.title = 'stored (an empty scene does nothing when recalled)';
                stored.addEventListener('change', () => {
                    if (stored.checked)
                        p.scenes[k] = {
                            pat: range(1, NB).map((b) =>
                                p.tracks[b] && p.tracks[b].kind !== 'slots' ? p.tracks[b].pat : 0
                            ),
                            mute: range(1, NB).map((b) => p.tracks[b]?.mute ?? 0)
                        };
                    else delete p.scenes[k];
                    this.trellisChanged();
                    redraw();
                });
                const tr = el('tr', '', [
                    el('th', '', [el('label', 'tp-scene-id', [stored, document.createTextNode(` S${k}`)])])
                ]);
                for (const b of tracks) {
                    const td = el('td');
                    if (sc) {
                        const pat = field(
                            { label: '', lo: 0, hi: NP, as: (v) => (v === 0 ? '–' : `P${v}`) },
                            sc.pat[b - 1],
                            (v) => {
                                sc.pat[b - 1] = v;
                                this.trellisChanged();
                            }
                        );
                        const mute = el('input');
                        mute.type = 'checkbox';
                        mute.checked = sc.mute[b - 1] === 1;
                        mute.title = 'muted';
                        mute.addEventListener('change', () => {
                            sc.mute[b - 1] = mute.checked ? 1 : 0;
                            this.trellisChanged();
                        });
                        td.append(
                            el('div', 'tp-scene-cell', [
                                pat,
                                el('label', 'tp-mute', [mute, document.createTextNode(' mute')])
                            ])
                        );
                    }
                    tr.append(td);
                }
                table.append(tr);
            }
            scenes.append(table);
            if (rows < SCENES)
                scenes.append(
                    button(
                        `show S${rows + 1}–S${SCENES}`,
                        'the scenes past these (achene: E1 on the scenes layer)',
                        () => {
                            this.trellis.allScenes = true;
                            redraw();
                        }
                    )
                );
        }
        main.append(scenes);

        // the song: scenes in turn, each for its bars
        const song = el('div', 'tp-group', [el('div', 'tp-group-title', 'song (the scenes layer, K3)')]);
        const on = el('input');
        on.type = 'checkbox';
        on.checked = p.son === 1;
        on.addEventListener('change', () => {
            p.son = on.checked ? 1 : 0;
            this.trellisChanged();
        });
        song.append(el('label', 'tp-field tp-check', [on, document.createTextNode(' on: plays while the clock does')]));
        // a table: an entry a row, its scene and bars under one heading each
        const list = el('table', 'tp-song');
        if (p.song.length) {
            const bars = p.song.reduce((n, e) => n + e[1], 0);
            list.append(
                el('tr', '', [
                    el('th', '', '#'),
                    el('th', '', 'scene'),
                    el('th', '', 'bars'),
                    el('th', 'tp-song-total', `${bars} bar${bars === 1 ? '' : 's'} in all`)
                ])
            );
        }
        p.song.forEach((entry, j) => {
            const scene = field(
                { label: '', lo: 1, hi: SCENES, as: (v) => `S${v}${p.scenes[v] ? '' : ' (empty)'}` },
                entry[0],
                (v) => {
                    entry[0] = v;
                    this.trellisChanged();
                    redraw();
                }
            );
            const bars = field({ label: '', lo: 1, hi: 99 }, entry[1], (v) => {
                entry[1] = v;
                this.trellisChanged();
                redraw();
            });
            draggable(/** @type {HTMLInputElement} */ (bars.querySelector('input')));
            const action = (/** @type {string} */ label, /** @type {string} */ title, /** @type {() => void} */ fn) => {
                const b = el('button', 'repl-action-btn tp-small', label);
                b.type = 'button';
                b.title = title;
                b.addEventListener('click', () => {
                    fn();
                    this.trellisChanged();
                    redraw();
                });
                return b;
            };
            // (a gap where an arrow doesn't apply, so the rows line up)
            const gap = () => el('span', 'tp-song-gap');
            list.append(
                el('tr', 'tp-song-entry', [
                    el('td', 'tp-song-n', String(j + 1)),
                    el('td', '', [scene]),
                    el('td', '', [bars]),
                    el('td', 'tp-song-actions', [
                        j > 0 ? action('↑', 'earlier', () => p.song.splice(j - 1, 0, ...p.song.splice(j, 1))) : gap(),
                        j < p.song.length - 1
                            ? action('↓', 'later', () => p.song.splice(j + 1, 0, ...p.song.splice(j, 1)))
                            : gap(),
                        action('delete', 'take it out', () => p.song.splice(j, 1))
                    ])
                ])
            );
        });
        song.append(list);
        if (p.song.length < SONG_MAX) {
            const add = el('button', 'repl-action-btn', '+ add a scene');
            add.type = 'button';
            add.addEventListener('click', () => {
                const prev = p.song[p.song.length - 1];
                p.song.push([prev ? prev[0] : 1, prev ? prev[1] : 4]);
                this.trellisChanged();
                redraw();
            });
            song.append(add);
        }
        main.append(song);

        // assign: eight slots from any banks on the performance page
        const assign = el('div', 'tp-group', [el('div', 'tp-group-title', 'assign (the performance page, K2 twice)')]);
        const choices = [0, ...range(1, NB * NS)];
        const label = (/** @type {number} */ x) => {
            if (x === 0) return 'none';
            const b = Math.ceil(x / NS), i = ((x - 1) % NS) + 1; // prettier-ignore
            const name = p.slots[x - 1].name;
            return `${LETTERS[b - 1]}${i}${name ? ` ${name}` : ''}`;
        };
        const row = el('div', 'tp-assign');
        p.assign.forEach((x, k) => {
            row.append(
                field({ label: `E${k + 5}`, as: label }, x, (v) => {
                    p.assign[k] = v;
                    this.trellisChanged();
                }, choices)
            ); // prettier-ignore
        });
        assign.append(row);
        main.append(assign);
        main.append(
            el(
                'p',
                'tp-note',
                'The clock, the sync jacks, MIDI thru and the arpeggiator live in trellis.cfg, not in a preset.'
            )
        );
    }
};
