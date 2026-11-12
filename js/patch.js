// The patch drawer, graft: a visual editor for iii scripts (docs/VISUAL-EDITOR.md).
// Blocks wired on a Drawflow canvas run on the device on a runtime built
// for the patch from lua/blocks*.lua; while a patch runs, every edit goes to
// the device live, one line at a time.
// Mixed into diiiApp (diii.js); `this` is the app.

import {
    BLOCKS,
    CODE_MAX,
    EXAMPLES,
    EXAMPLE_MENU,
    RUNTIME_DEVICE_FILES,
    RUNTIME_RUN_FILE,
    RUNTIME_SOURCES,
    buildRuntime,
    defaultParams,
    examplePatch,
    liveLines,
    luaParams,
    parseRuntime,
    patchDevice,
    patchFile,
    patchProblems,
    patchTypes,
    readPatchFile
} from './patch-blocks.js';

const DRAWER_KEY = 'webdiii.patchDrawer';
const SAVED_KEY = 'webdiii.patch';
/** what a palette block carries while it's dragged onto the canvas */
const DRAG_TYPE = 'application/x-diii-block';
const LIVE_KEY = 'webdiii.patchLive';
/** offline, the device the patch is made for (the for: picker) */
const TARGET_KEY = 'webdiii.patchTarget';
const OFFLINE_TARGETS = [
    ['achene', 'achene'],
    ['grid 16x8', 'grid 16×8'],
    ['grid 8x8', 'grid 8×8'],
    ['grid 16x16', 'grid 16×16']
];
const GROUPS = [
    ['achene', 'achene'],
    ['screen', 'screen'],
    ['grid', 'grid'],
    ['source', 'sources'],
    ['process', 'process'],
    ['math', 'math'],
    ['memory', 'memory'],
    ['output', 'outputs'],
    ['custom', 'custom']
];

/** @param {string} text */
const escapeHtml = (text) =>
    String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);

/**
 * About how big a block is on the canvas, before it exists: its title, a
 * row per field (the code field is taller), and a watch's graph.
 * @param {string} type
 */
function blockSize(type) {
    const block = BLOCKS[type];
    if (!block) return { w: 180, h: 80 };
    const params = Object.values(block.params);
    const code = params.some((p) => p.type === 'code');
    return {
        w: code ? 240 : 180,
        h: 44 + params.length * 25 + (code ? 70 : 0) + (block.view ? 50 : 0) + Math.max(block.inputs, block.outputs) * 4
    };
}

/** A node's inside: its name and a field per parameter, bound by df-<name>. */
function nodeHtml(type) {
    const block = BLOCKS[type];
    const fields = Object.entries(block.params)
        .map(([key, p]) => {
            const how =
                p.type === 'select'
                    ? 'pick one'
                    : p.type === 'text'
                      ? 'type a name'
                      : p.type === 'code'
                        ? 'Lua; drag the corner to resize'
                        : 'type a number or use the arrows';
            const attrs = `df-${key} title="${escapeHtml(`${p.label}: ${how}`)}"`;
            let input;
            if (p.type === 'select') {
                const options = (p.options || []).map((o) => `<option>${escapeHtml(o)}</option>`).join('');
                input = `<select ${attrs}>${options}</select>`;
            } else if (p.type === 'text') {
                input = `<input type="text" maxlength="20" ${attrs}>`;
            } else if (p.type === 'code') {
                // its own row: code wants the width
                return (
                    `<label class="pn-field pn-code"><span>${escapeHtml(p.label)}</span>` +
                    `<textarea rows="4" spellcheck="false" maxlength="${CODE_MAX}" ${attrs}></textarea></label>`
                );
            } else {
                const range = [
                    p.min !== undefined ? `min="${p.min}"` : '',
                    p.max !== undefined ? `max="${p.max}"` : '',
                    `step="${p.step || (p.type === 'int' ? 1 : 'any')}"`
                ].join(' ');
                input = `<input type="number" ${range} ${attrs}>`;
            }
            return `<label class="pn-field"><span>${escapeHtml(p.label)}</span>${input}</label>`;
        })
        .join('');
    const tip = `${block.doc} (drag the title to move; click to select)`;
    const view =
        block.view === 'watch'
            ? '<div class="pn-watchview"><span class="pn-watch-value">–</span>' +
              '<svg class="pn-watch-graph" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline points=""/></svg></div>'
            : '';
    return `<div class="pn-title" title="${escapeHtml(tip)}">${escapeHtml(block.label)}</div>${fields}${view}`;
}

export const patchMethods = {
    initPatch() {
        this.patchEditor = null;
        this.patchRunning = false;
        /** @type {Map<number, ReturnType<typeof setTimeout>>} */
        this.patchSendTimers = new Map();
        this.patchPanelOpen = false;
        /** live: edits go to the running patch at once; otherwise they wait for apply */
        this.patchLive = true;
        /** edits waiting for apply, in order; a key makes repeated edits to one block one */
        /** @type {Map<string, () => void>} */
        this.patchPending = new Map();
        this.patchPendingSeq = 0;
        try {
            this.patchPanelOpen = window.localStorage.getItem(DRAWER_KEY) === 'open';
            this.patchLive = window.localStorage.getItem(LIVE_KEY) !== 'off';
            this.patchOfflineTarget = window.localStorage.getItem(TARGET_KEY) || 'achene';
        } catch {
            // storage blocked
        }
        this.elements.patchTargetSelect?.addEventListener('change', (event) => {
            this.patchOfflineTarget = /** @type {HTMLSelectElement} */ (event.target).value;
            try {
                window.localStorage.setItem(TARGET_KEY, this.patchOfflineTarget);
            } catch {
                // storage blocked
            }
            this.updatePatchTarget();
        });
        this.updatePatchTarget();
        this.showPatchDrawerState();
    },

    /**
     * What the patch is made for: the device connected (null for one with
     * neither achene's controls nor a grid), or offline what for: picks.
     * @returns {{ device: 'achene' | 'grid' | null, size: { x: number, y: number } }}
     */
    patchTarget() {
        const caps = this.patchCaps;
        if (caps) return { device: caps.achene ? 'achene' : caps.grid ? 'grid' : null, size: caps.size };
        const m = String(this.patchOfflineTarget || '').match(/^grid (\d+)x(\d+)$/);
        return m
            ? { device: 'grid', size: { x: Number(m[1]), y: Number(m[2]) } }
            : { device: 'achene', size: { x: 16, y: 8 } };
    },

    /** After connecting, disconnecting or picking for: everything that depends on the device. */
    updatePatchTarget() {
        const select = this.elements.patchTargetSelect;
        const caps = this.patchCaps;
        if (select) {
            select.replaceChildren();
            const options = caps ? [['', `for: ${caps.kind}`]] : OFFLINE_TARGETS.map(([v, l]) => [v, `for: ${l}`]);
            for (const [value, label] of options) select.add(new Option(label, value));
            select.disabled = Boolean(caps);
            select.value = caps ? '' : this.patchOfflineTarget || 'achene';
            select.title = caps
                ? `the device connected: the palette, examples and layout follow it`
                : 'no device connected: which device the palette, examples and layout are for';
        }
        const { device } = this.patchTarget();
        this.buildPatchPalette();
        this.fillPatchExamples();
        const button = this.elements.patchScreenBtn;
        if (button) {
            button.hidden = !device;
            button.textContent = device === 'grid' ? 'grid' : 'screen';
            button.title =
                device === 'grid'
                    ? 'the grid layout: see where the grid blocks sit, drag them into place and size'
                    : 'the screen layout: see where the screen blocks sit and drag them into place';
        }
        if (device === 'grid' && this.patchScreenOpen) this.togglePatchScreen?.(false);
        if (device !== 'grid' && this.patchGridOpen) this.togglePatchGrid?.(false);
        this.renderPatchGrid?.();
        this.filterPatchGuide?.();
    },

    /** The examples menu: those for the device (or for any device). */
    fillPatchExamples() {
        const select = this.elements.patchExampleSelect;
        if (!select) return;
        const { device } = this.patchTarget();
        select.replaceChildren(new Option('examples…', ''));
        for (const [name, label] of EXAMPLE_MENU) {
            const made = patchDevice(EXAMPLES[name]());
            if (made && device && made !== device) continue;
            select.add(new Option(label, name));
        }
    },

    /**
     * The palette: shared blocks always, a device's own blocks for the device
     * the patch is made for (connected, or offline the for: picker).
     */
    buildPatchPalette() {
        const palette = this.elements.patchPalette;
        if (!palette) return;
        palette.replaceChildren();
        const { device } = this.patchTarget();
        for (const [group, title] of GROUPS) {
            if ((group === 'achene' || group === 'screen') && device !== 'achene') continue;
            if (group === 'grid' && device !== 'grid') continue;
            const heading = document.createElement('div');
            heading.className = 'patch-palette-group';
            heading.textContent = title;
            palette.appendChild(heading);
            for (const [type, block] of Object.entries(BLOCKS)) {
                if (block.group !== group) continue;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'patch-palette-item';
                button.textContent = block.label;
                button.title = `${block.doc} (click to add, or drag it onto the canvas)`;
                button.draggable = true;
                button.addEventListener('click', () => this.addPatchNode(type));
                button.addEventListener('dragstart', (event) => {
                    if (!event.dataTransfer) return;
                    event.dataTransfer.setData(DRAG_TYPE, type);
                    event.dataTransfer.effectAllowed = 'copy';
                });
                palette.appendChild(button);
            }
        }
    },

    /**
     * The canvas is made the first time the drawer opens (it needs its size).
     * Callers share one promise: opening the drawer and pressing run at once
     * must not make two editors in one container.
     */
    ensurePatchEditor() {
        if (!this.elements.patchCanvas) return Promise.resolve(null);
        this.patchEditorReady ||= this.createPatchEditor();
        return this.patchEditorReady;
    },

    async createPatchEditor() {
        const { Drawflow } = await import('../vendor/drawflow.js');
        const editor = new Drawflow(this.elements.patchCanvas);
        editor.reroute = false;
        // a drag on a field is for the field (select text, resize the code)
        editor.draggable_inputs = false;
        editor.zoom_min = 0.3;
        editor.zoom_max = 2;
        /** blocks selected together (ids): moved and deleted as a group */
        this.patchSelection = new Set();
        // Drawflow moves only the block being dragged; move the rest of the
        // selection by the same amount. Its handler is bound in start(), so
        // wrap it before.
        const position = editor.position.bind(editor);
        editor.position = (event) => {
            const el = editor.drag ? editor.ele_selected : null;
            const id = el ? Number(String(el.id).replace('node-', '')) : NaN;
            const data = editor.drawflow.drawflow[editor.module].data;
            const before = this.patchSelection.has(id) ? { x: data[id].pos_x, y: data[id].pos_y } : null;
            position(event);
            if (!before || this.patchSelection.size < 2) return;
            const dx = data[id].pos_x - before.x;
            const dy = data[id].pos_y - before.y;
            if (!dx && !dy) return;
            for (const other of this.patchSelection) {
                if (other === id || !data[other]) continue;
                data[other].pos_x += dx;
                data[other].pos_y += dy;
                const node = document.getElementById(`node-${other}`);
                if (node) {
                    node.style.left = `${data[other].pos_x}px`;
                    node.style.top = `${data[other].pos_y}px`;
                }
                editor.updateConnectionNodes(`node-${other}`);
            }
        };
        editor.start();
        this.patchEditor = editor;
        this.bindPatchSelection(editor);
        this.bindPatchDrop(editor);
        this.bindPatchClipboard(editor);
        this.bindPatchMenu(editor);
        this.bindPatchPortTips();
        editor.on('zoom', () => this.updatePatchZoomLabel());
        // Drawflow draws a wire from its blocks' positions on screen, which
        // are all zero while the drawer is hidden: redraw them whenever the
        // canvas changes size (hidden to shown, opened, resized)
        let pending = false;
        new ResizeObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {
                pending = false;
                this.redrawPatchWires();
            });
        }).observe(this.elements.patchCanvas);

        editor.on('nodeCreated', (id) => this.onPatchChange(() => this.sendPatchNode(Number(id)), `node:${id}`));
        editor.on('nodeRemoved', (id) => {
            this.patchSelection.delete(Number(id));
            this.onPatchChange(() => this.sendPatchLine(`B.remove(${Number(id)})`));
        });
        editor.on('connectionCreated', (c) => this.onPatchChange(() => this.sendPatchWire('wire', c)));
        editor.on('connectionRemoved', (c) => this.onPatchChange(() => this.sendPatchWire('unwire', c)));
        editor.on('nodeDataChanged', (id) =>
            this.onPatchChange(
                () => this.queuePatchNode(Number(id)),
                `node:${id}`,
                () => this.sendPatchNode(Number(id))
            )
        );
        editor.on('nodeMoved', () => this.savePatchLocally());

        let saved = null;
        try {
            saved = JSON.parse(window.localStorage.getItem(SAVED_KEY) || 'null');
        } catch {
            saved = null;
        }
        this.loadPatch(saved && Array.isArray(saved.nodes) ? saved : examplePatch());
        return editor;
    },

    showPatchDrawerState() {
        const open = this.patchPanelOpen;
        this.elements.patchDrawer?.classList.toggle('open', open);
        if (this.elements.patchToggleBtn) {
            this.elements.patchToggleBtn.textContent = open ? 'graft ▾' : 'graft ▸';
            this.elements.patchToggleBtn.setAttribute('aria-expanded', String(open));
        }
        if (open) this.ensurePatchEditor().catch((error) => this.outputLine(`graft: ${error.message}`));
        this.updatePatchStatus();
    },

    async togglePatchPanel(open = !this.patchPanelOpen) {
        this.patchPanelOpen = open;
        try {
            window.localStorage.setItem(DRAWER_KEY, open ? 'open' : 'closed');
        } catch {
            // storage blocked
        }
        this.showPatchDrawerState();
    },

    /**
     * After connecting: what the device can do (achene's keys and screen, a
     * grid's LEDs), for the palette. Any iii device gets the drawer: the
     * shared blocks only need iii itself.
     */
    async detectPatchCaps() {
        let caps = { achene: false, grid: false, og: false, size: { x: 16, y: 8 }, kind: 'iii device' };
        try {
            const lines = await this.executeLuaCapture(
                'print("caps:" .. (key_led and "a" or "-") .. (grid_led and "g" or "-") .. (gh_mirror and "o" or "-")' +
                    ' .. (grid_size_x and (grid_size_x() .. "x" .. grid_size_y()) or ""))'
            );
            const m = lines
                .map((l) => String(l).trim())
                .join('')
                .match(/caps:([a-])([g-])([o-])(?:(\d+)x(\d+))?/);
            if (m) {
                const achene = m[1] === 'a';
                const grid = m[2] === 'g';
                const og = m[3] === 'o';
                const size = m[4] ? { x: Number(m[4]), y: Number(m[5]) } : { x: 16, y: 8 };
                const kind = achene
                    ? 'achene'
                    : grid
                      ? `${og ? 'parterre' : 'grid'} ${size.x}×${size.y}`
                      : 'iii device';
                caps = { achene, grid, og, size, kind };
            }
        } catch {
            // not answering: shared blocks only
        }
        this.patchCaps = caps;
        this.updatePatchTarget();
        if (this.elements.patchDrawer) this.elements.patchDrawer.hidden = false;
        this.updatePatchStatus();
    },

    /** Kept for js/achene.js: availability now comes from detectPatchCaps. */
    updatePatchAvailability() {
        this.updatePatchStatus();
    },

    updatePatchStatus() {
        const status = this.elements.patchStatus;
        const waiting = this.patchPending?.size || 0;
        const busy = this.patchBusy;
        if (status) {
            const stats = [this.patchStats, this.patchRuntimeInfo].filter(Boolean).join(' · ');
            status.textContent = busy
                ? busy
                : !this.patchRunning
                  ? 'stopped'
                  : this.patchLive
                    ? `running${stats ? ` · ${stats}` : ''} · live: edits go to the device as you make them`
                    : waiting
                      ? `running · ${waiting} edit${waiting === 1 ? '' : 's'} waiting for apply`
                      : 'running · edits wait for apply';
            status.classList.toggle('patch-busy', Boolean(busy));
        }
        const run = this.elements.patchRunBtn;
        if (run) {
            run.classList.toggle('active', this.patchRunning);
            run.classList.toggle('busy', Boolean(busy));
            run.disabled = Boolean(busy);
        }
        const live = this.elements.patchLiveBtn;
        if (live) {
            live.classList.toggle('active', this.patchLive);
            live.setAttribute('aria-pressed', String(this.patchLive));
        }
        const apply = this.elements.patchApplyBtn;
        if (apply) {
            apply.hidden = this.patchLive || !this.patchRunning;
            apply.disabled = !waiting;
            apply.textContent = waiting ? `apply (${waiting})` : 'apply';
        }
    },

    // ------------------------------------------------------------ the patch

    /**
     * Adds a block: at (clientX, clientY) when dropped there, otherwise near
     * the middle of what's visible, a little apart from the last one.
     * @param {string} type @param {number} [clientX] @param {number} [clientY]
     */
    addPatchNode(type, clientX, clientY) {
        const editor = this.patchEditor;
        const block = BLOCKS[type];
        if (!editor || !block) return;
        let x;
        let y;
        if (clientX !== undefined && clientY !== undefined) {
            [x, y] = this.patchCanvasPoint(clientX, clientY);
            x -= 20;
            y -= 12;
        } else {
            const rect = this.elements.patchCanvas.getBoundingClientRect();
            [x, y] = this.patchCanvasPoint(rect.left + rect.width / 3, rect.top + rect.height / 3);
            const size = blockSize(type);
            [x, y] = this.findFreePatchSpot(x, y, size.w, size.h);
        }
        editor.addNode(type, block.inputs, block.outputs, x, y, `pn-${type}`, defaultParams(type), nodeHtml(type));
    },

    /** The canvas as a patch: nodes with their parameters, and the wires. */
    exportPatch() {
        const data = this.patchEditor?.export()?.drawflow?.Home?.data || {};
        const nodes = [];
        const wires = [];
        for (const node of Object.values(data)) {
            const { _state: state, ...params } = node.data || {};
            nodes.push({
                id: Number(node.id),
                type: node.name,
                params,
                x: node.pos_x,
                y: node.pos_y,
                ...(state ? { state } : {})
            });
            for (const [out, port] of Object.entries(node.outputs || {})) {
                for (const c of port.connections || []) {
                    wires.push([
                        Number(node.id),
                        Number(out.replace('output_', '')),
                        Number(c.node),
                        Number(c.output.replace('input_', ''))
                    ]);
                }
            }
        }
        nodes.sort((a, b) => a.id - b.id);
        return { nodes, wires };
    },

    /** @param {{ nodes: any[], wires: number[][] }} patch */
    loadPatch(patch) {
        const editor = this.patchEditor;
        if (!editor) return;
        this.clearPatchSelection();
        /** @type {Record<string, any>} */
        const data = {};
        for (const n of patch.nodes) {
            const block = BLOCKS[n.type];
            if (!block) continue;
            /** @type {Record<string, { connections: any[] }>} */
            const inputs = {};
            /** @type {Record<string, { connections: any[] }>} */
            const outputs = {};
            for (let i = 1; i <= block.inputs; i++) inputs[`input_${i}`] = { connections: [] };
            for (let i = 1; i <= block.outputs; i++) outputs[`output_${i}`] = { connections: [] };
            data[n.id] = {
                id: n.id,
                name: n.type,
                data: { ...defaultParams(n.type), ...n.params, ...(n.state ? { _state: n.state } : {}) },
                class: `pn-${n.type}`,
                html: nodeHtml(n.type),
                typenode: false,
                inputs,
                outputs,
                pos_x: n.x ?? 40,
                pos_y: n.y ?? 40
            };
        }
        for (const [from, out, to, inp] of patch.wires) {
            const a = data[from]?.outputs[`output_${out}`];
            const b = data[to]?.inputs[`input_${inp}`];
            if (!a || !b) continue;
            a.connections.push({ node: String(to), output: `input_${inp}` });
            b.connections.push({ node: String(from), input: `output_${out}` });
        }
        editor.import({ drawflow: { Home: { data } } });
        const ids = Object.keys(data).map(Number);
        editor.nodeId = (ids.length ? Math.max(...ids) : 0) + 1;
        requestAnimationFrame(() => this.redrawPatchWires());
        this.savePatchLocally();
    },

    // ------------------------------------------------------------ zoom

    /** @param {'in' | 'out' | 'reset' | 'fit'} how */
    zoomPatch(how) {
        const editor = this.patchEditor;
        if (!editor) return;
        if (how === 'in') editor.zoom_in();
        else if (how === 'out') editor.zoom_out();
        else if (how === 'reset') editor.zoom_reset();
        else this.fitPatch();
        this.updatePatchZoomLabel();
    },

    /** Zooms and pans so the whole patch fits the canvas. */
    fitPatch() {
        const editor = this.patchEditor;
        const canvas = this.elements.patchCanvas;
        const data = editor?.drawflow.drawflow[editor.module].data || {};
        const ids = Object.keys(data);
        if (!editor || !canvas || !ids.length) return;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const id of ids) {
            const el = document.getElementById(`node-${id}`);
            const w = el?.offsetWidth || 150;
            const h = el?.offsetHeight || 80;
            x0 = Math.min(x0, data[id].pos_x);
            y0 = Math.min(y0, data[id].pos_y);
            x1 = Math.max(x1, data[id].pos_x + w);
            y1 = Math.max(y1, data[id].pos_y + h);
        }
        const W = editor.precanvas.clientWidth || canvas.clientWidth;
        const H = editor.precanvas.clientHeight || canvas.clientHeight;
        const pad = 40;
        const zoom = Math.max(
            editor.zoom_min,
            Math.min(editor.zoom_max, 1, (W - pad) / (x1 - x0), (H - pad) / (y1 - y0))
        );
        // Drawflow scales around the canvas's centre: put the patch's centre there
        editor.zoom = zoom;
        editor.zoom_last_value = zoom;
        editor.canvas_x = -((x0 + x1) / 2 - W / 2) * zoom;
        editor.canvas_y = -((y0 + y1) / 2 - H / 2) * zoom;
        editor.precanvas.style.transform = `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${zoom})`;
        editor.dispatch('zoom', zoom);
    },

    updatePatchZoomLabel() {
        const label = this.elements.patchZoomLabel;
        if (label && this.patchEditor) label.textContent = `${Math.round(this.patchEditor.zoom * 100)}%`;
    },

    // ------------------------------------------------------------ selection

    /**
     * The canvas's mouse, as in most node editors:
     * - wheel: zoom, anchored at the pointer;
     * - drag on empty space: a selection box (shift adds to the selection);
     * - click a block: select it; shift- or ctrl-click adds or removes it;
     *   dragging a selected block moves them all (editor.position, above);
     * - pan: hold space and drag, or drag with the middle button;
     * - Delete removes the selection, Esc lets go.
     * Drawflow pans on a plain drag and zooms on ctrl+wheel only, so these
     * listeners run first (capture) and stop it where they take over.
     * @param {any} editor
     */
    bindPatchSelection(editor) {
        const canvas = this.elements.patchCanvas;
        const body = this.elements.patchBody || canvas.parentElement;
        const isField = (/** @type {Element | null} */ el) => Boolean(el?.closest('input, textarea, select'));
        const nodeOf = (/** @type {Element | null} */ el) => el?.closest('.drawflow-node') || null;
        const idOf = (/** @type {Element} */ node) => Number(String(node.id).replace('node-', ''));
        let spaceHeld = false;

        // wheel: zoom around the pointer (a code field still scrolls)
        body.addEventListener(
            'wheel',
            (event) => {
                const target = /** @type {Element} */ (event.target);
                if (!canvas.contains(target)) return;
                const area = target.closest('textarea');
                if (area && area.scrollHeight > area.clientHeight) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
                this.zoomPatchAt(editor.zoom * factor, event.clientX, event.clientY);
            },
            { capture: true, passive: false }
        );

        canvas.addEventListener(
            'mousedown',
            (event) => {
                const target = /** @type {Element} */ (event.target);
                if (isField(target)) return;
                // pan: the middle button anywhere, or space + drag
                if (event.button === 1 || (event.button === 0 && spaceHeld)) {
                    event.stopPropagation();
                    event.preventDefault();
                    this.startPatchPan(event);
                    return;
                }
                if (event.button !== 0) return;
                // a wire or a delete button (×): Drawflow's (a wire's × sits
                // outside any block, so it would look like empty space)
                if (target.closest('.drawflow-delete')) return;
                if (target.closest('.connection')) {
                    this.clearPatchSelection();
                    return;
                }
                const node = nodeOf(target);
                const onPort = Boolean(target.closest('.input, .output'));
                // a drag from an input: wire it back to an output
                const input = target.closest('.input');
                if (node && input) {
                    event.stopPropagation();
                    event.preventDefault();
                    this.startPatchWireFromInput(event, input, idOf(node));
                    return;
                }
                if (node && !onPort) {
                    const id = idOf(node);
                    if (event.shiftKey || event.ctrlKey || event.metaKey) {
                        // add or remove it, and keep Drawflow from dragging it
                        event.stopPropagation();
                        event.preventDefault();
                        this.togglePatchSelected(id);
                    } else if (!this.patchSelection.has(id)) {
                        // a block outside the selection: it alone (Drawflow drags it)
                        this.clearPatchSelection();
                        this.togglePatchSelected(id);
                    }
                    return;
                }
                if (!node) {
                    event.stopPropagation();
                    event.preventDefault();
                    if (!event.shiftKey) this.clearPatchSelection();
                    this.startPatchBox(event, body);
                }
            },
            true
        );

        // space held: the next drag pans (and the page doesn't scroll)
        document.addEventListener('keydown', (event) => {
            if (event.key !== ' ' || !this.patchPanelOpen || isField(document.activeElement)) return;
            if (!canvas.matches(':hover')) return;
            event.preventDefault();
            if (!spaceHeld) {
                spaceHeld = true;
                canvas.classList.add('pn-panning');
            }
        });
        document.addEventListener('keyup', (event) => {
            if (event.key !== ' ') return;
            spaceHeld = false;
            canvas.classList.remove('pn-panning');
        });

        document.addEventListener('keydown', (event) => {
            if (!this.patchSelection.size || !this.patchPanelOpen || isField(document.activeElement)) return;
            if (event.key === 'Escape') {
                this.clearPatchSelection();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                this.removePatchSelection();
            }
        });
    },

    /** Removes the selected blocks (and their wires). */
    removePatchSelection() {
        const editor = this.patchEditor;
        if (!editor) return;
        const data = editor.drawflow.drawflow[editor.module].data;
        for (const id of this.patchSelectedIds()) if (data[id]) editor.removeNodeId(`node-${id}`);
        this.clearPatchSelection();
    },

    /** The selected blocks: the selection, or the one block Drawflow has selected. */
    patchSelectedIds() {
        const ids = new Set(this.patchSelection || []);
        const el = this.patchEditor?.node_selected;
        if (!ids.size && el) ids.add(Number(String(el.id).replace('node-', '')));
        return ids;
    },

    /**
     * The selected blocks as a patch of their own: their fields, places, and
     * the wires between them (wires to blocks left out are dropped).
     * @returns {import('./patch-blocks.js').Patch | null}
     */
    patchSelectionAsPatch() {
        const ids = this.patchSelectedIds();
        if (!ids.size) return null;
        const all = this.exportPatch();
        return {
            nodes: all.nodes.filter((n) => ids.has(n.id)),
            wires: all.wires.filter(([from, , to]) => ids.has(from) && ids.has(to))
        };
    },

    /**
     * Adds a copy of `clip` (new ids, wired the same) and selects it: with
     * its top left corner at (clientX, clientY), or offset from where the
     * copied blocks were, a little further each time.
     * @param {import('./patch-blocks.js').Patch} clip @param {{ x: number, y: number } | null} [at]
     * @param {boolean} [free] move from `at` to free space if blocks are there
     */
    pastePatch(clip, at = null, free = false) {
        const editor = this.patchEditor;
        const nodes = (clip?.nodes || []).filter((n) => BLOCKS[n.type]);
        if (!editor || !nodes.length) return;
        const x0 = Math.min(...nodes.map((n) => Number(n.x) || 0));
        const y0 = Math.min(...nodes.map((n) => Number(n.y) || 0));
        let dx;
        let dy;
        if (at) {
            const [cx, cy] = this.patchCanvasPoint(at.x, at.y);
            dx = cx - x0;
            dy = cy - y0;
        } else {
            this.patchPasteCount = (this.patchPasteCount || 0) + 1;
            dx = dy = 30 * this.patchPasteCount;
        }
        // not on top of other blocks: the nearest free space for the group
        if (!at || free) {
            const w = Math.max(...nodes.map((n) => (Number(n.x) || 0) + blockSize(n.type).w)) - x0;
            const h = Math.max(...nodes.map((n) => (Number(n.y) || 0) + blockSize(n.type).h)) - y0;
            const [fx, fy] = this.findFreePatchSpot(x0 + dx, y0 + dy, w, h);
            dx = fx - x0;
            dy = fy - y0;
        }
        /** @type {Map<number, number>} old id -> new id */
        const ids = new Map();
        for (const n of nodes) {
            const block = BLOCKS[n.type];
            const id = editor.addNode(
                n.type,
                block.inputs,
                block.outputs,
                (Number(n.x) || 0) + dx,
                (Number(n.y) || 0) + dy,
                `pn-${n.type}`,
                { ...defaultParams(n.type), ...n.params, ...(n.state ? { _state: n.state } : {}) },
                nodeHtml(n.type)
            );
            ids.set(Number(n.id), Number(id));
        }
        for (const [from, out, to, inp] of clip.wires || []) {
            if (ids.has(from) && ids.has(to)) {
                editor.addConnection(ids.get(from), ids.get(to), `output_${out}`, `input_${inp}`);
            }
        }
        this.clearPatchSelection();
        for (const id of ids.values()) this.togglePatchSelected(id);
    },

    /**
     * The right-click menu: on a block (or the selection it's in) duplicate,
     * copy, cut, delete and what it does; on empty canvas paste and select
     * all. A wire keeps Drawflow's own × for deleting it, a field the
     * browser's menu.
     * @param {any} editor
     */
    bindPatchMenu(editor) {
        const canvas = this.elements.patchCanvas;
        const body = this.elements.patchBody || canvas.parentElement;
        const menu = document.createElement('div');
        menu.className = 'patch-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        body.appendChild(menu);
        const close = () => {
            menu.hidden = true;
        };
        const ids = () => [...this.patchSelectedIds()];
        /** @param {[string, string, () => void, boolean?][]} items */
        const show = (event, items, note = '') => {
            menu.replaceChildren();
            for (const [label, keys, run, off] of items) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'patch-menu-item';
                item.setAttribute('role', 'menuitem');
                item.disabled = Boolean(off);
                item.innerHTML = `<span>${escapeHtml(label)}</span><kbd>${escapeHtml(keys)}</kbd>`;
                item.addEventListener('click', () => {
                    close();
                    run();
                });
                menu.appendChild(item);
            }
            if (note) {
                const p = document.createElement('p');
                p.className = 'patch-menu-note';
                p.textContent = note;
                menu.appendChild(p);
            }
            menu.hidden = false;
            const box = body.getBoundingClientRect();
            const x = Math.min(event.clientX - box.left, box.width - menu.offsetWidth - 6);
            const y = Math.min(event.clientY - box.top, box.height - menu.offsetHeight - 6);
            menu.style.left = `${Math.max(4, x)}px`;
            menu.style.top = `${Math.max(4, y)}px`;
        };
        canvas.addEventListener(
            'contextmenu',
            (event) => {
                const target = /** @type {Element} */ (event.target);
                if (target.closest('input, textarea, select, .connection, .drawflow-delete')) return;
                event.preventDefault();
                event.stopPropagation();
                const node = target.closest('.drawflow-node');
                if (node) {
                    const id = Number(String(node.id).replace('node-', ''));
                    if (!this.patchSelection.has(id)) {
                        this.clearPatchSelection();
                        this.togglePatchSelected(id);
                    }
                    const chosen = ids();
                    const one = chosen.length === 1 ? editor.drawflow.drawflow[editor.module].data[chosen[0]] : null;
                    const block = one ? BLOCKS[one.name] : null;
                    const copy = () => {
                        this.patchClipboard = this.patchSelectionAsPatch();
                        this.patchPasteCount = 0;
                        const clip = this.patchClipboard;
                        navigator.clipboard?.writeText(JSON.stringify({ 'diii-patch': 1, ...clip })).catch(() => {});
                    };
                    show(
                        event,
                        [
                            [
                                'duplicate',
                                'ctrl+D',
                                () => {
                                    const clip = this.patchSelectionAsPatch();
                                    this.patchPasteCount = 0;
                                    if (clip) this.pastePatch(clip);
                                }
                            ],
                            ['copy', 'ctrl+C', copy],
                            [
                                'cut',
                                'ctrl+X',
                                () => {
                                    copy();
                                    this.removePatchSelection();
                                }
                            ],
                            ['delete', 'Del', () => this.removePatchSelection()]
                        ],
                        block ? `${block.label}: ${block.doc}` : `${chosen.length} blocks selected`
                    );
                    return;
                }
                const at = { x: event.clientX, y: event.clientY };
                show(event, [
                    ['paste here', 'ctrl+V', () => this.pastePatch(this.patchClipboard, at), !this.patchClipboard],
                    [
                        'select all',
                        'ctrl+A',
                        () => {
                            this.clearPatchSelection();
                            for (const id of Object.keys(editor.drawflow.drawflow[editor.module].data)) {
                                this.togglePatchSelected(Number(id));
                            }
                        }
                    ]
                ]);
            },
            true
        );
        // any click elsewhere closes the menu, and lets go of a wire picked
        // by a right-click (its ×): first, in the capture phase, since the
        // canvas's own handlers stop clicks on empty space from going further
        document.addEventListener(
            'mousedown',
            (event) => {
                const target = /** @type {Element} */ (event.target);
                if (!menu.hidden && !menu.contains(target)) close();
                if (target.closest?.('.drawflow-delete, .connection')) return;
                for (const x of canvas.querySelectorAll('.drawflow-delete')) x.remove();
                if (editor.connection_selected) {
                    editor.connection_selected.classList.remove('selected');
                    editor.connection_selected = null;
                }
            },
            true
        );
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') close();
        });
        canvas.addEventListener('wheel', close, { passive: true });
    },

    /**
     * Copy, cut, paste and duplicate for blocks: ctrl+C / X / V / D (cmd on
     * a Mac), and ctrl+A for all of them. They act once the canvas was
     * clicked last and no field is being typed in, so copying text
     * elsewhere on the page works as usual. Copied blocks go to the system
     * clipboard as text too, so they paste into another greenhouse tab.
     * @param {any} editor
     */
    bindPatchClipboard(editor) {
        const canvas = this.elements.patchCanvas;
        const body = this.elements.patchBody || canvas.parentElement;
        let pointer = null;
        document.addEventListener(
            'mousedown',
            (event) => {
                this.patchCanvasActive = canvas.contains(/** @type {Node} */ (event.target));
            },
            true
        );
        canvas.addEventListener('mousemove', (event) => {
            pointer = { x: event.clientX, y: event.clientY };
        });
        const active = () =>
            this.patchPanelOpen &&
            this.patchCanvasActive &&
            !body.querySelector('.patch-overlay:not([hidden])') &&
            !document.activeElement?.closest('input, textarea, select, [contenteditable="true"]') &&
            !window.getSelection()?.toString();
        const MARK = 'diii-patch';
        const copy = (/** @type {ClipboardEvent} */ event) => {
            if (!active()) return false;
            const clip = this.patchSelectionAsPatch();
            if (!clip) return false;
            event.preventDefault();
            this.patchClipboard = clip;
            this.patchPasteCount = 0;
            event.clipboardData?.setData('text/plain', JSON.stringify({ [MARK]: 1, ...clip }));
            return true;
        };
        document.addEventListener('copy', copy);
        document.addEventListener('cut', (event) => {
            if (copy(event)) this.removePatchSelection();
        });
        document.addEventListener('paste', (event) => {
            if (!active()) return;
            let clip = this.patchClipboard;
            try {
                const text = JSON.parse(event.clipboardData?.getData('text/plain') || 'null');
                if (text && text[MARK] && Array.isArray(text.nodes)) clip = text;
            } catch {
                // not blocks: the last ones copied here, if any
            }
            if (!clip) return;
            event.preventDefault();
            this.pastePatch(clip, canvas.matches(':hover') ? pointer : null);
        });
        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || !active()) return;
            const key = event.key.toLowerCase();
            if (key === 'd') {
                // duplicate: next to the originals; what was copied stays
                event.preventDefault();
                const clip = this.patchSelectionAsPatch();
                if (!clip) return;
                this.patchPasteCount = 0;
                this.pastePatch(clip);
            } else if (key === 'a') {
                event.preventDefault();
                this.clearPatchSelection();
                for (const id of Object.keys(editor.drawflow.drawflow[editor.module].data)) {
                    this.togglePatchSelected(Number(id));
                }
            }
        });
    },

    /**
     * A point on screen as canvas coordinates (where a block's pos_x/pos_y
     * would put its corner). Drawflow scales around the canvas's centre.
     * @param {number} clientX @param {number} clientY
     * @returns {[number, number]}
     */
    patchCanvasPoint(clientX, clientY) {
        const editor = this.patchEditor;
        const box = editor.precanvas.getBoundingClientRect();
        return [(clientX - box.left) / editor.zoom, (clientY - box.top) / editor.zoom];
    },

    /** Blocks dragged from the palette land where they're dropped. */
    bindPatchDrop(editor) {
        const canvas = this.elements.patchCanvas;
        canvas.addEventListener('dragover', (event) => {
            if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        });
        // a code field resized from its corner moves its block's ports
        canvas.addEventListener('mouseup', (event) => {
            const target = /** @type {Element} */ (event.target);
            const node = target.closest?.('.drawflow-node');
            if (node && target.matches('textarea')) requestAnimationFrame(() => editor.updateConnectionNodes(node.id));
        });
        canvas.addEventListener('drop', (event) => {
            const type = event.dataTransfer?.getData(DRAG_TYPE);
            if (!type || !BLOCKS[type] || !editor) return;
            event.preventDefault();
            this.addPatchNode(type, event.clientX, event.clientY);
        });
    },

    /**
     * Ports get their tooltip on first hover: which input or output it is
     * (the name patch.css draws beside it) and how to wire it.
     */
    bindPatchPortTips() {
        this.elements.patchCanvas.addEventListener('mouseover', (event) => {
            const port = /** @type {Element} */ (event.target).closest?.('.input, .output');
            if (!port || port.hasAttribute('title')) return;
            const isInput = port.classList.contains('input');
            const n = [...port.classList].map((c) => /^(?:input|output)_(\d+)$/.exec(c)?.[1]).find(Boolean) || '1';
            const name = getComputedStyle(port, '::after').content.replace(/^["']|["']$/g, '');
            const label = `${isInput ? 'input' : 'output'} ${n}${name && name !== 'none' ? ` (${name})` : ''}`;
            port.setAttribute(
                'title',
                isInput
                    ? `${label}: drag from an output to here to wire them; click a wire and press Delete to remove it`
                    : `${label}: drag from here to an input to wire them; one output can feed many inputs`
            );
        });
    },

    /**
     * Zooms to `zoom`, keeping the canvas point under (clientX, clientY)
     * where it is. Drawflow scales around the canvas's centre.
     * @param {number} zoom @param {number} clientX @param {number} clientY
     */
    zoomPatchAt(zoom, clientX, clientY) {
        const editor = this.patchEditor;
        if (!editor) return;
        const z = Math.min(editor.zoom_max, Math.max(editor.zoom_min, zoom));
        const box = editor.precanvas.parentElement.getBoundingClientRect();
        const ox = editor.precanvas.clientWidth / 2;
        const oy = editor.precanvas.clientHeight / 2;
        const mx = clientX - box.left;
        const my = clientY - box.top;
        // the canvas point under the pointer, then where it must stay
        const px = ox + (mx - editor.canvas_x - ox) / editor.zoom;
        const py = oy + (my - editor.canvas_y - oy) / editor.zoom;
        editor.zoom = z;
        editor.zoom_last_value = z;
        editor.canvas_x = mx - ox - (px - ox) * z;
        editor.canvas_y = my - oy - (py - oy) * z;
        editor.precanvas.style.transform = `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${z})`;
        editor.dispatch('zoom', z);
        this.updatePatchZoomLabel();
    },

    /**
     * Drawflow draws wires from outputs only; this draws one from an input:
     * a curve follows the mouse, and letting go over another block's output
     * wires the two (as if drawn from that output).
     * @param {MouseEvent} start @param {Element} input @param {number} inId
     */
    startPatchWireFromInput(start, input, inId) {
        const editor = this.patchEditor;
        if (!editor) return;
        const portClass = (/** @type {Element} */ el, kind) =>
            [...el.classList].find((c) => new RegExp(`^${kind}_\\d+$`).test(c)) || '';
        const inClass = portClass(input, 'input');
        const r = input.getBoundingClientRect();
        const [ix, iy] = this.patchCanvasPoint(r.left + r.width / 2, r.top + r.height / 2);
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.classList.add('connection', 'pn-wire-draft');
        const path = document.createElementNS(svgNs, 'path');
        path.classList.add('main-path');
        svg.appendChild(path);
        editor.precanvas.appendChild(svg);
        const draw = (/** @type {MouseEvent} */ e) => {
            const [mx, my] = this.patchCanvasPoint(e.clientX, e.clientY);
            // from the output end (the mouse) to the input, as Drawflow curves them
            path.setAttributeNS(null, 'd', editor.createCurvature(mx, my, ix, iy, editor.curvature, 'openclose'));
        };
        draw(start);
        const up = (/** @type {MouseEvent} */ e) => {
            window.removeEventListener('mousemove', draw);
            window.removeEventListener('mouseup', up);
            svg.remove();
            const output = document.elementFromPoint(e.clientX, e.clientY)?.closest('.output');
            const outNode = output?.closest('.drawflow-node');
            if (!output || !outNode) return;
            const outId = Number(String(outNode.id).replace('node-', ''));
            if (outId === inId) return;
            editor.addConnection(outId, inId, portClass(output, 'output'), inClass);
        };
        window.addEventListener('mousemove', draw);
        window.addEventListener('mouseup', up);
    },

    /** Pans the canvas while the mouse moves (middle button, or space + drag). */
    /** @param {MouseEvent} start */
    startPatchPan(start) {
        const editor = this.patchEditor;
        if (!editor) return;
        let x = start.clientX;
        let y = start.clientY;
        this.elements.patchCanvas.classList.add('pn-panning-now');
        const move = (/** @type {MouseEvent} */ e) => {
            editor.canvas_x += e.clientX - x;
            editor.canvas_y += e.clientY - y;
            x = e.clientX;
            y = e.clientY;
            editor.precanvas.style.transform = `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${editor.zoom})`;
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            this.elements.patchCanvas.classList.remove('pn-panning-now');
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    },

    /** @param {number} id */
    togglePatchSelected(id) {
        const el = document.getElementById(`node-${id}`);
        if (this.patchSelection.delete(id)) el?.classList.remove('pn-picked');
        else {
            this.patchSelection.add(id);
            el?.classList.add('pn-picked');
        }
    },

    clearPatchSelection() {
        for (const id of this.patchSelection) document.getElementById(`node-${id}`)?.classList.remove('pn-picked');
        this.patchSelection?.clear();
    },

    /**
     * The selection box: from where the drag starts to where it ends;
     * every block it touches joins the selection.
     * @param {MouseEvent} start @param {HTMLElement} body
     */
    startPatchBox(start, body) {
        const box = document.createElement('div');
        box.className = 'patch-select-box';
        body.appendChild(box);
        const origin = body.getBoundingClientRect();
        const rect = { x0: start.clientX, y0: start.clientY, x1: start.clientX, y1: start.clientY };
        const draw = () => {
            box.style.left = `${Math.min(rect.x0, rect.x1) - origin.left}px`;
            box.style.top = `${Math.min(rect.y0, rect.y1) - origin.top}px`;
            box.style.width = `${Math.abs(rect.x1 - rect.x0)}px`;
            box.style.height = `${Math.abs(rect.y1 - rect.y0)}px`;
        };
        draw();
        const move = (/** @type {MouseEvent} */ e) => {
            rect.x1 = e.clientX;
            rect.y1 = e.clientY;
            draw();
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            box.remove();
            const l = Math.min(rect.x0, rect.x1);
            const r = Math.max(rect.x0, rect.x1);
            const t = Math.min(rect.y0, rect.y1);
            const b = Math.max(rect.y0, rect.y1);
            for (const node of this.elements.patchCanvas.querySelectorAll('.drawflow-node')) {
                const n = node.getBoundingClientRect();
                if (n.right < l || n.left > r || n.bottom < t || n.top > b) continue;
                const id = Number(String(node.id).replace('node-', ''));
                if (!this.patchSelection.has(id)) this.togglePatchSelected(id);
            }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    },

    /** Redraws every wire from where its blocks are now. */
    redrawPatchWires() {
        const editor = this.patchEditor;
        if (!editor || !this.elements.patchCanvas?.offsetWidth) return;
        const data = editor.export()?.drawflow?.Home?.data || {};
        for (const id of Object.keys(data)) editor.updateConnectionNodes(`node-${id}`);
    },

    /**
     * Opens a patch saved on the device (its --@patch lines) on the canvas.
     * @param {string} name
     */
    async openPatchFile(name) {
        if (!this.iiiDevice.isConnected) return;
        let text;
        try {
            text = await this.readRemoteFile(name);
        } catch (error) {
            this.outputLine(`graft: couldn't read ${name} (${error.message})`);
            return;
        }
        const patch = readPatchFile(text);
        if (!patch) {
            this.outputLine(`graft: ${name} isn't a patch (no --@patch lines); open it with edit instead`);
            return;
        }
        for (const problem of patchProblems(patch, this.patchTarget().device)) {
            this.outputLine(`graft: ${name}: ${problem}`);
        }
        if (!this.patchPanelOpen) await this.togglePatchPanel(true);
        await this.ensurePatchEditor();
        this.loadPatch(patch);
        this.patchFileName = name;
        this.outputLine(`graft: opened ${name}`);
        this.replacePatchOnDevice(liveLines(this.exportPatch()));
    },

    /** The "open…" list: the device's own scripts (not the runtime's or iii's). */
    fillPatchOpenList() {
        const select = this.elements.patchOpenSelect;
        if (!select) return;
        const skip = new Set([...RUNTIME_DEVICE_FILES, 'lib.lua', 'init.lua']);
        const names = (this.fileEntries || [])
            .map((entry) => entry.name)
            .filter((name) => name.endsWith('.lua') && !skip.has(name))
            .filter((name) => !this.patchFileNames || this.patchFileNames.has(name))
            .sort();
        select.replaceChildren();
        const prompt = document.createElement('option');
        prompt.value = '';
        prompt.textContent = names.length ? 'open…' : 'open… (no patches saved)';
        select.appendChild(prompt);
        for (const name of names) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
        select.value = '';
    },

    savePatchLocally() {
        if (!this.patchEditor) return;
        try {
            window.localStorage.setItem(SAVED_KEY, JSON.stringify(this.exportPatch()));
        } catch {
            // storage blocked or full
        }
        // the screen and grid layouts (js/patch-screen.js, patch-grid.js) show the change
        this.renderPatchScreen?.();
        this.renderPatchGrid?.();
    },

    /**
     * Every edit: remember it and, while the patch runs, send it to the
     * device: at once when live, otherwise when apply is pressed. Edits with
     * the same key (one block's fields) wait as one, in the place of the
     * first, and `later` is what's sent then.
     * @param {() => void} send @param {string} [key] @param {() => void} [later]
     */
    onPatchChange(send, key, later = send) {
        this.savePatchLocally();
        if (!this.patchRunning) return;
        if (this.patchLive) {
            send();
            return;
        }
        const k = key || `edit:${this.patchPendingSeq++}`;
        if (!this.patchPending.has(k)) this.patchPending.set(k, later);
        this.updatePatchStatus();
    },

    /**
     * A watch block's report from the device, "^^pw(id,value)": its latest
     * value and a graph of the last ones, drawn on the block (once a frame).
     * @param {string} line
     */
    handlePatchWatchLine(line) {
        const match = /^\^\^pw\((\d+),([^)]*)\)/.exec(line);
        if (!match) return;
        const id = Number(match[1]);
        const v = Number(match[2]);
        this.patchWatch ||= new Map();
        const w = this.patchWatch.get(id) || { values: [], text: '' };
        w.text = match[2];
        if (Number.isFinite(v)) {
            w.values.push(v);
            if (w.values.length > 60) w.values.shift();
        }
        this.patchWatch.set(id, w);
        if (this.patchWatchFrame) return;
        this.patchWatchFrame = requestAnimationFrame(() => {
            this.patchWatchFrame = 0;
            for (const [wid, entry] of this.patchWatch) {
                const node = document.getElementById(`node-${wid}`);
                if (!node) continue;
                const text = node.querySelector('.pn-watch-value');
                if (text) text.textContent = entry.text;
                const line = node.querySelector('.pn-watch-graph polyline');
                if (!line || !entry.values.length) continue;
                let lo = Math.min(...entry.values);
                let hi = Math.max(...entry.values);
                if (hi === lo) {
                    lo -= 1;
                    hi += 1;
                }
                const n = entry.values.length;
                line.setAttribute(
                    'points',
                    entry.values
                        .map((value, k) => `${(100 * (k + 60 - n)) / 59},${26 - (24 * (value - lo)) / (hi - lo)}`)
                        .join(' ')
                );
            }
        });
    },

    /**
     * Asks the running patch what its blocks remember (B.state) and keeps
     * it with them on the canvas: run, save and export carry it from there.
     */
    async fetchPatchState() {
        const editor = this.patchEditor;
        if (!editor || !this.iiiDevice.isConnected) return;
        let lines;
        try {
            lines = await this.executeLuaCapture('if B and B.state then B.state() end');
        } catch {
            return;
        }
        const data = editor.drawflow.drawflow[editor.module].data;
        for (const line of lines) {
            const [tag, id, json] = String(line).split('\t');
            if (tag !== '__webdiii_state' || !data[id]) continue;
            try {
                data[id].data._state = JSON.parse(json);
            } catch {
                // a line cut short: keep what was there
            }
        }
        this.savePatchLocally();
    },

    /** The running patch's size: its blocks and Lua's memory, for the status. */
    async fetchPatchStats() {
        try {
            const lines = await this.executeLuaCapture('if B and B.stats then B.stats() end');
            const [tag, n, kb] = String(lines.find((l) => String(l).startsWith('__webdiii_stats')) || '').split('\t');
            this.patchStats = tag ? `${n} blocks, Lua ${kb} KB` : '';
        } catch {
            this.patchStats = '';
        }
        this.updatePatchStatus();
    },

    /**
     * The nearest place for a w x h block (or group) at or after (x, y)
     * that no block covers: down the column first, then the next column.
     * @param {number} x @param {number} y @param {number} w @param {number} h
     * @returns {[number, number]}
     */
    findFreePatchSpot(x, y, w, h) {
        const editor = this.patchEditor;
        if (!editor) return [x, y];
        const zoom = editor.zoom || 1;
        const taken = Object.values(editor.drawflow.drawflow[editor.module].data).map((n) => {
            const el = document.getElementById(`node-${n.id}`);
            return {
                x: n.pos_x,
                y: n.pos_y,
                w: el ? el.getBoundingClientRect().width / zoom : 180,
                h: el ? el.getBoundingClientRect().height / zoom : 120
            };
        });
        const gap = 16;
        const clear = (/** @type {number} */ cx, /** @type {number} */ cy) =>
            taken.every(
                (t) => cx + w + gap <= t.x || t.x + t.w + gap <= cx || cy + h + gap <= t.y || t.y + t.h + gap <= cy
            );
        for (let col = 0; col < 12; col++) {
            for (let row = 0; row < 16; row++) {
                const cx = x + col * 200;
                const cy = y + row * 40;
                if (clear(cx, cy)) return [cx, cy];
            }
        }
        return [x, y];
    },

    /** A whole new patch on the canvas (opened, an example, cleared). */
    /** @param {string[]} lines */
    replacePatchOnDevice(lines) {
        if (!this.patchRunning) return;
        const send = () => {
            // blocks the runtime running lacks: build one with them and run again
            if (this.patchLacksTypes(patchTypes(this.exportPatch()))) {
                this.rerunPatch();
                return;
            }
            for (const line of lines) this.sendPatchLine(line);
        };
        if (this.patchLive) {
            send();
            return;
        }
        this.patchPending.clear();
        this.patchPending.set('all', send);
        this.updatePatchStatus();
    },

    /** Sends the edits that waited, in order. */
    applyPatchEdits() {
        const edits = [...this.patchPending.values()];
        this.patchPending.clear();
        if (this.patchRunning) for (const send of edits) send();
        this.updatePatchStatus();
        if (edits.length) this.outputLine(`graft: applied ${edits.length} edit${edits.length === 1 ? '' : 's'}`);
    },

    /** @param {boolean} on */
    setPatchLive(on) {
        this.patchLive = on;
        try {
            window.localStorage.setItem(LIVE_KEY, on ? 'on' : 'off');
        } catch {
            // storage blocked
        }
        // going live: what waited goes now
        if (on && this.patchPending.size) this.applyPatchEdits();
        this.updatePatchStatus();
    },

    // ------------------------------------------------------------ the device

    /** @param {string} line */
    sendPatchLine(line) {
        if (!this.iiiDevice.isConnected || this.uploadInProgress) return;
        this.executeLua(line).catch(() => {});
    },

    /** @param {number} id */
    sendPatchNode(id) {
        // gone already (added, then deleted before apply)
        if (!this.patchEditor?.drawflow.drawflow[this.patchEditor.module].data[id]) return;
        const node = this.patchEditor.getNodeFromId(id);
        if (!node || !BLOCKS[node.name]) return;
        // a type the runtime running lacks: build one with it and run again
        if (this.patchLacksTypes([node.name])) {
            this.rerunPatch();
            return;
        }
        // B.node replaces a node and keeps its wires
        this.sendPatchLine(`B.node(${id}, "${node.name}", ${luaParams(node.name, node.data)})`);
    },

    /** Typing in a field changes it on every key: send once it settles. */
    /** @param {number} id */
    queuePatchNode(id) {
        clearTimeout(this.patchSendTimers.get(id));
        this.patchSendTimers.set(
            id,
            setTimeout(() => {
                this.patchSendTimers.delete(id);
                this.sendPatchNode(id);
            }, 200)
        );
    },

    /** @param {'wire' | 'unwire'} verb @param {any} c a Drawflow connection */
    sendPatchWire(verb, c) {
        const out = Number(String(c.output_class).replace('output_', ''));
        const inp = Number(String(c.input_class).replace('input_', ''));
        this.sendPatchLine(`B.${verb}(${Number(c.output_id)}, ${out}, ${Number(c.input_id)}, ${inp})`);
    },

    /** The runtime's parts, read once from lua/blocks*.lua (from this module's place, so tools/ works too). */
    async runtimeParts() {
        this.patchRuntimeSource ??= (async () => {
            /** @type {Record<string, string>} */
            const texts = {};
            for (const { file } of RUNTIME_SOURCES) {
                const response = await fetch(new URL(`../lua/${file}`, import.meta.url));
                if (!response.ok) throw new Error(`couldn't fetch lua/${file} (${response.status})`);
                texts[file] = await response.text();
            }
            return parseRuntime(texts);
        })();
        try {
            return await this.patchRuntimeSource;
        } catch (error) {
            this.patchRuntimeSource = null; // try again next time
            throw error;
        }
    },

    /**
     * The runtime for a patch, on the device it is for: the core and the
     * parts its blocks use (buildRuntime).
     * @param {import('./patch-blocks.js').Patch} patch
     */
    async patchRuntime(patch) {
        const device = this.patchTarget().device ?? patchDevice(patch);
        return buildRuntime(await this.runtimeParts(), patchTypes(patch), device === 'mixed' ? null : device);
    },

    /**
     * Whether the runtime running lacks any of these block types (diii
     * knows which it built; unknown blocks don't count).
     * @param {string[]} types
     */
    patchLacksTypes(types) {
        const have = this.patchRuntimeTypes;
        return this.patchRunning && Boolean(have) && types.some((t) => BLOCKS[t] && !have.has(t));
    },

    /**
     * What the drawer is busy with (loading the runtime), in its status
     * and on the run button; null when done.
     * @param {string | null} text
     */
    setPatchBusy(text) {
        this.patchBusy = text;
        this.updatePatchStatus();
    },

    /** Runs the patch again (once, however many edits ask): a runtime with new blocks. */
    rerunPatch() {
        if (this.patchRerun) return;
        this.patchRerun = Promise.resolve()
            .then(() => this.runPatch())
            .finally(() => {
                this.patchRerun = null;
            });
    },

    /**
     * Puts the runtime for the patch on the canvas on the device and runs
     * it, unless it is the one running already (B.build is its
     * fingerprint). It goes in RUNTIME_RUN_FILE, written only when it
     * changes: after a restart, a file of the same size is run and checked
     * before anything is uploaded.
     */
    async ensurePatchRuntime() {
        const runtime = await this.patchRuntime(this.exportPatch());
        const size = new TextEncoder().encode(runtime.text).length;
        const what = `${runtime.parts.length} parts, ${Math.round(size / 1024)} KB`;
        const loaded = async () =>
            (await this.executeLuaCapture('print(B and B.build or "-")')).some(
                (l) => String(l).trim() === runtime.build
            );
        const done = () => {
            this.patchRuntimeTypes = new Set(runtime.types);
            this.patchRuntimeInfo = `runtime ${what}`;
            return true;
        };
        if (await loaded()) return done();
        const running = await this.executeLuaCapture('print(B and B.build and "graft" or "other")');
        if (running.some((l) => String(l).trim() === 'graft')) {
            // let go of the runtime running before the next one compiles: on an
            // RP2040 both at once may not fit (the tick metro is kept, iii has 12)
            await this.executeLuaCapture(
                'if B.clear then B.clear() end B = {tick_metro = B.tick_metro} collectgarbage() collectgarbage()'
            );
        } else {
            // another script (a first() one, say) or none: stop it, its metros
            // and handlers would run on beside the patch and keep its memory
            this.setPatchBusy('stopping the running script…');
            await this.cleanLuaState();
        }
        this.setPatchBusy('loading the blocks runtime…');
        const sizes = await this.executeLuaCapture(
            `for _, f in ipairs(fs_list_files()) do if f == "${RUNTIME_RUN_FILE}" then print(fs_file_size(f)) end end`
        );
        const have = Number(String(sizes[0] ?? '').trim());
        if (have === size || have === size + 1) {
            await this.executeLuaCapture(`fs_run_file("${RUNTIME_RUN_FILE}")`);
            if (await loaded()) return done();
        }
        this.outputLine(`graft: putting the blocks runtime on the device (${what})`);
        this.setPatchBusy(`sending the blocks runtime (${what})…`);
        if (!(await this.uploadChecked(RUNTIME_RUN_FILE, runtime.text, { keepOld: true }))) {
            this.outputLine(`graft: ${RUNTIME_RUN_FILE} did not upload`);
            return false;
        }
        this.setPatchBusy('starting the blocks runtime…');
        await this.executeLuaCapture(`fs_run_file("${RUNTIME_RUN_FILE}")`);
        if (await loaded()) return done();
        this.outputLine(`graft: ${RUNTIME_RUN_FILE} did not start (see the lines above)`);
        return false;
    },

    async runPatch() {
        if (!this.iiiDevice.isConnected) {
            this.outputLine('graft: connect a device first');
            return;
        }
        await this.ensurePatchEditor();
        // what the blocks remember, before a new runtime replaces them
        if (this.patchRunning) await this.fetchPatchState();
        let ready = false;
        try {
            ready = await this.ensurePatchRuntime();
        } catch (error) {
            this.outputLine(`graft: ${error.message}`);
        }
        if (!ready) {
            // the runtime that was running may be gone too
            this.patchRunning = false;
            this.setPatchBusy(null);
            return;
        }
        for (const line of liveLines(this.exportPatch())) this.sendPatchLine(line);
        this.patchRunning = true;
        this.patchPending.clear();
        this.setPatchBusy(null);
        this.fetchPatchStats();
        this.outputLine(
            this.patchLive
                ? 'graft: running; live, so edits go to the device as you make them'
                : 'graft: running; edits wait until you press apply'
        );
    },

    async stopPatch() {
        // what the blocks remember, so run starts again from there
        if (this.patchRunning) await this.fetchPatchState();
        if (this.patchRunning) this.sendPatchLine('B.clear()');
        this.patchRunning = false;
        this.patchPending.clear();
        this.patchStats = '';
        this.updatePatchStatus();
    },

    async savePatchToDevice() {
        if (!this.iiiDevice.isConnected) {
            this.outputLine('graft: connect a device to save it');
            return;
        }
        const answer = window.prompt('save the patch on the device as', this.patchFileName || 'patch.lua');
        if (!answer) return;
        let name = answer.trim().replace(/[^\w.-]/g, '_');
        if (!name.endsWith('.lua')) name += '.lua';
        this.patchFileName = name;
        if (this.patchRunning) await this.fetchPatchState();
        // the file carries its own runtime: it needs nothing else on the device
        const patch = this.exportPatch();
        let text;
        try {
            text = patchFile(name.replace(/\.lua$/, ''), patch, await this.patchRuntime(patch));
        } catch (error) {
            this.outputLine(`graft: ${error.message}`);
            return;
        }
        const written = await this.uploadChecked(name, text);
        this.outputLine(
            written
                ? `graft: saved as ${name}; it runs on its own (first("${name}") makes it the start-up script)`
                : `graft: ${name} did not save`
        );
        this.requestFileListRefresh?.();
    },

    /** The patch editor, shown and opened: with or without a device. */
    async showPatchEditor() {
        if (this.elements.patchDrawer) this.elements.patchDrawer.hidden = false;
        if (!this.patchPanelOpen) await this.togglePatchPanel(true);
        await this.ensurePatchEditor();
        this.elements.patchDrawer?.scrollIntoView({ block: 'nearest' });
    },

    /** Saves the canvas to a file on the computer, in the patch file format. */
    async exportPatchFile() {
        if (!this.patchEditor) return;
        if (this.patchRunning) await this.fetchPatchState();
        const answer = window.prompt('export the patch as', (this.patchFileName || 'patch.lua').replace(/\.lua$/, ''));
        if (!answer) return;
        const base =
            answer
                .trim()
                .replace(/[^\w.-]/g, '_')
                .replace(/\.lua$/, '') || 'patch';
        const patch = this.exportPatch();
        let text;
        try {
            text = patchFile(base, patch, await this.patchRuntime(patch));
        } catch (error) {
            this.outputLine(`graft: ${error.message}`);
            return;
        }
        const url = URL.createObjectURL(new Blob([text], { type: 'text/x-lua' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${base}.lua`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.outputLine(`graft: exported ${base}.lua`);
    },

    /**
     * Loads a patch from a file: an exported one or a patch script (its
     * --@patch lines), or the JSON of copied blocks.
     * @param {File} file
     */
    async importPatchFile(file) {
        await this.showPatchEditor();
        const text = await file.text();
        let patch = readPatchFile(text);
        if (!patch) {
            try {
                const json = JSON.parse(text);
                if (json && Array.isArray(json.nodes)) patch = { nodes: json.nodes, wires: json.wires || [] };
            } catch {
                // not JSON either
            }
        }
        if (!patch) {
            this.outputLine(`graft: ${file.name} has no patch in it (no --@patch lines)`);
            return;
        }
        for (const problem of patchProblems(patch, this.patchTarget().device)) {
            this.outputLine(`graft: ${file.name}: ${problem}`);
        }
        const count = Object.keys(this.patchEditor?.drawflow.drawflow[this.patchEditor.module].data || {}).length;
        if (count && !window.confirm(`Replace the canvas with ${file.name}?`)) return;
        this.loadPatch(patch);
        this.patchFileName = file.name.replace(/\.(json|txt)$/, '.lua');
        this.outputLine(`graft: imported ${file.name}`);
        this.replacePatchOnDevice(liveLines(this.exportPatch()));
    },

    /** @param {string} name one of EXAMPLES */
    loadExamplePatch(name) {
        const make = EXAMPLES[name];
        if (!this.patchEditor || !make) return;
        if (!window.confirm(`Replace the canvas with the ${name} example?`)) return;
        this.loadPatch(make());
        this.replacePatchOnDevice(liveLines(this.exportPatch()));
    },

    clearPatchCanvas() {
        if (!this.patchEditor) return;
        if (!window.confirm('Remove every block from the canvas?')) return;
        this.loadPatch({ nodes: [], wires: [] });
        // still running: blocks added next need the tick and the handlers
        this.replacePatchOnDevice(['B.clear()', 'B.start()']);
    },

    patchDisconnected() {
        this.patchRunning = false;
        this.patchRuntimeTypes = null;
        this.patchRuntimeInfo = '';
        this.patchBusy = null;
        this.patchPending.clear();
        this.patchCaps = null;
        this.updatePatchTarget();
        this.updatePatchStatus();
    }
};
