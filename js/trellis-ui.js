// trellis's preset editor: a preset file of achene's trellis script
// (pset_trellis_N.lua) as a form, its banks' slots, tracks and steps, its
// scenes, song and assign; saved back to the device in trellis's own format
// (js/trellis-preset.js). Opened from a preset's file menu ("edit preset").
// Mixed into diiiApp (diii.js); `this` is the app.

import { hasExactFiles } from './backup.js';
import {
    KINDS,
    LETTERS,
    MAX_STEPS,
    NB,
    NP,
    NS,
    RANDOM_WHAT,
    SCALE_NAMES,
    SLOT_FIELDS,
    SONG_MAX,
    STEP_DIVS,
    keyModes,
    laneAt,
    newTrack,
    noteName,
    parsePreset,
    patternOf,
    serializePreset,
    setLane,
    switchPattern
} from './trellis-preset.js';

/** a preset of trellis: pset_trellis_<n>.lua */
export const TRELLIS_PRESET = /^pset_trellis_(\d+)\.lua$/;

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
        this.trellis = { fileName, preset, view: 1, pattern: {}, page: {}, lane: {}, dirty: false };
        this.trellisModal().style.display = 'flex';
        this.renderTrellis();
    },

    /** the editor's dialog, made the first time */
    trellisModal() {
        if (this.trellisModalEl) return this.trellisModalEl;
        const modal = el('div', 'modal tp-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'trellis preset');
        modal.append(el('div', 'modal-content tp-content'));
        modal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.closeTrellisPreset();
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
        this.trellis.dirty = true;
        const mark = this.trellisModalEl?.querySelector('.tp-dirty');
        if (mark) mark.hidden = false;
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
        const n = TRELLIS_PRESET.exec(fileName)?.[1];
        this.outputLine(
            `trellis: saved ${fileName}. On achene, load preset ${n} (K15, E1 to ${n}, K2) to play it; ` +
                'if trellis has it loaded now, load it again before saving from trellis, or trellis writes its own over it.'
        );
        this.refreshFileList?.();
        this.renderTrellis();
    },

    renderTrellis() {
        const t = this.trellis;
        if (!t) return;
        const content = this.trellisModal().querySelector('.tp-content');
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
        save.title = 'write the preset to the device, as the number picked';
        save.addEventListener('click', () => this.saveTrellisPreset(`pset_trellis_${slot.value}.lua`));
        const close = el('button', 'editor-close-btn', '✕');
        close.type = 'button';
        close.title = 'close (Esc)';
        close.setAttribute('aria-label', 'close');
        close.addEventListener('click', () => this.closeTrellisPreset());
        const dirty = el('span', 'tp-dirty', '● unsaved');
        dirty.hidden = !t.dirty;
        content.append(
            el('div', 'reference-header tp-header', [
                el('h2', 'firmware-title', `trellis · ${t.fileName}`),
                el('span', 'tp-version', `written by trellis ${t.preset.version}`),
                dirty,
                el('div', 'repl-actions-spacer'),
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
        main.append(
            el('div', 'tp-bank-head', [
                el('label', 'tp-field tp-name-field', [el('span', '', `bank ${LETTERS[b - 1]}`), name]),
                type
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
            card.append(el('div', 'tp-slot-head', [el('span', 'tp-slot-id', `E${i + 4} · K${i + 4}`), name]));
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
            btn.addEventListener('click', () => {
                setLane(pat, 'on', k, 1 - laneAt(pat, 'on', k));
                this.trellisChanged();
                redraw();
            });
            cell.append(btn);
            on.append(cell);
        }
        for (const [lane, label, lo, hi] of /** @type {const} */ ([
            ['note', 'note', 0, 127],
            ['vel', 'velocity', 1, 127],
            ['gate', 'gate (1/8s)', 1, MAX_STEPS],
            ['prob', 'chance %', 0, 100]
        ])) {
            const tr = row(label);
            for (let k = first; k <= last; k++) {
                const input = el('input', 'tp-step-input');
                input.type = 'number';
                input.min = String(lo);
                input.max = String(hi);
                input.value = String(laneAt(pat, lane, k));
                if (lane === 'note') input.title = noteName(laneAt(pat, lane, k));
                input.addEventListener('change', () => {
                    const v = Math.min(hi, Math.max(lo, Math.round(Number(input.value)) || lo));
                    setLane(pat, lane, k, v);
                    this.trellisChanged();
                    redraw();
                });
                tr.append(el('td', '', [input]));
            }
            if (lane === 'note') {
                const names = row('');
                for (let k = first; k <= last; k++)
                    names.append(el('td', 'tp-note-name', noteName(laneAt(pat, 'note', k))));
            }
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
                btn.addEventListener('click', () => {
                    setLane(pat, `d${l}`, k, v ^ 128);
                    this.trellisChanged();
                    redraw();
                });
                tr.append(el('td', '', [btn]));
            }
            grid.append(tr);
        }
        for (const [lane, label, lo, hi] of /** @type {const} */ ([
            [`d${picked}`, `lane ${picked} vel`, 1, 127],
            [`q${picked}`, `lane ${picked} chance %`, 0, 100]
        ])) {
            const tr = el('tr', 'tp-lane-values', [el('th', '', label)]);
            for (let k = first; k <= last; k++) {
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
                tr.append(el('td', '', [input]));
            }
            grid.append(tr);
        }
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
            for (let k = 1; k <= NS; k++) {
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
        const list = el('ol', 'tp-song');
        p.song.forEach((entry, j) => {
            const scene = field(
                { label: 'scene', lo: 1, hi: NS, as: (v) => `S${v}${p.scenes[v] ? '' : ' (empty)'}` },
                entry[0],
                (v) => {
                    entry[0] = v;
                    this.trellisChanged();
                    redraw();
                }
            );
            const bars = field({ label: 'bars', lo: 1, hi: 99 }, entry[1], (v) => {
                entry[1] = v;
                this.trellisChanged();
            });
            const button = (/** @type {string} */ label, /** @type {string} */ title, /** @type {() => void} */ fn) => {
                const b = el('button', 'repl-action-btn', label);
                b.type = 'button';
                b.title = title;
                b.addEventListener('click', () => {
                    fn();
                    this.trellisChanged();
                    redraw();
                });
                return b;
            };
            list.append(
                el('li', 'tp-song-entry', [
                    scene,
                    bars,
                    j > 0 ? button('↑', 'earlier', () => p.song.splice(j - 1, 0, ...p.song.splice(j, 1))) : null,
                    j < p.song.length - 1
                        ? button('↓', 'later', () => p.song.splice(j + 1, 0, ...p.song.splice(j, 1)))
                        : null,
                    button('delete', 'take it out', () => p.song.splice(j, 1))
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
