// The patch drawer: a visual editor for iii scripts (docs/VISUAL-EDITOR.md).
// Blocks wired on a Drawflow canvas run on the device through lua/blocks.lua;
// while a patch runs, every edit goes to the device live, one line at a time.
// Mixed into diiiApp (diii.js); `this` is the app.

import {
    BLOCKS,
    CODE_MAX,
    EXAMPLES,
    RUNTIME_VERSION,
    defaultParams,
    examplePatch,
    liveLines,
    luaParams,
    patchFile,
    readPatchFile
} from './patch-blocks.js';

const DRAWER_KEY = 'webdiii.patchDrawer';
const SAVED_KEY = 'webdiii.patch';
const GROUPS = [
    ['achene', 'achene'],
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

/** A node's inside: its name and a field per parameter, bound by df-<name>. */
function nodeHtml(type) {
    const block = BLOCKS[type];
    const fields = Object.entries(block.params)
        .map(([key, p]) => {
            const attrs = `df-${key} title="${escapeHtml(p.label)}"`;
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
    return `<div class="pn-title">${escapeHtml(block.label)}</div>${fields}`;
}

export const patchMethods = {
    initPatch() {
        this.patchEditor = null;
        this.patchRunning = false;
        /** @type {Map<number, ReturnType<typeof setTimeout>>} */
        this.patchSendTimers = new Map();
        this.patchPanelOpen = false;
        try {
            this.patchPanelOpen = window.localStorage.getItem(DRAWER_KEY) === 'open';
        } catch {
            // storage blocked
        }
        this.buildPatchPalette();
        this.showPatchDrawerState();
    },

    /**
     * The palette: shared blocks always, a device's own blocks when that
     * device is connected (all of them while offline, to look around).
     */
    buildPatchPalette() {
        const palette = this.elements.patchPalette;
        if (!palette) return;
        palette.replaceChildren();
        const caps = this.patchCaps;
        for (const [group, title] of GROUPS) {
            if (caps && group === 'achene' && !caps.achene) continue;
            if (caps && group === 'grid' && !caps.grid) continue;
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
                button.title = `${block.doc} (click to add)`;
                button.addEventListener('click', () => this.addPatchNode(type));
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

        editor.on('nodeCreated', (id) => this.onPatchChange(() => this.sendPatchNode(Number(id))));
        editor.on('nodeRemoved', (id) => {
            this.patchSelection.delete(Number(id));
            this.onPatchChange(() => this.sendPatchLine(`B.remove(${Number(id)})`));
        });
        editor.on('connectionCreated', (c) => this.onPatchChange(() => this.sendPatchWire('wire', c)));
        editor.on('connectionRemoved', (c) => this.onPatchChange(() => this.sendPatchWire('unwire', c)));
        editor.on('nodeDataChanged', (id) => this.onPatchChange(() => this.queuePatchNode(Number(id))));
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
            this.elements.patchToggleBtn.textContent = open ? 'patch ▾' : 'patch ▸';
            this.elements.patchToggleBtn.setAttribute('aria-expanded', String(open));
        }
        if (open) this.ensurePatchEditor().catch((error) => this.outputLine(`patch: ${error.message}`));
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
        let caps = { achene: false, grid: false };
        try {
            const lines = await this.executeLuaCapture('print((key_led and "a" or "-") .. (grid_led and "g" or "-"))');
            const flags = lines.map((l) => String(l).trim()).join('');
            caps = { achene: flags.includes('a'), grid: flags.includes('g') };
        } catch {
            // not answering: shared blocks only
        }
        this.patchCaps = caps;
        this.buildPatchPalette();
        if (this.elements.patchDrawer) this.elements.patchDrawer.hidden = false;
        this.updatePatchStatus();
    },

    /** Kept for js/achene.js: availability now comes from detectPatchCaps. */
    updatePatchAvailability() {
        this.updatePatchStatus();
    },

    updatePatchStatus() {
        const status = this.elements.patchStatus;
        if (status) status.textContent = this.patchRunning ? 'running · edits go live' : 'stopped';
        this.elements.patchRunBtn?.classList.toggle('active', this.patchRunning);
    },

    // ------------------------------------------------------------ the patch

    /** @param {string} type */
    addPatchNode(type) {
        const editor = this.patchEditor;
        const block = BLOCKS[type];
        if (!editor || !block) return;
        // near the middle of what's visible, a little apart from the last one
        const rect = this.elements.patchCanvas.getBoundingClientRect();
        const zoom = editor.zoom || 1;
        this.patchAddCount = ((this.patchAddCount || 0) + 1) % 6;
        const x = (rect.width / 2 - editor.canvas_x) / zoom - 80 + this.patchAddCount * 18;
        const y = (rect.height / 2 - editor.canvas_y) / zoom - 40 + this.patchAddCount * 18;
        editor.addNode(type, block.inputs, block.outputs, x, y, `pn-${type}`, defaultParams(type), nodeHtml(type));
    },

    /** The canvas as a patch: nodes with their parameters, and the wires. */
    exportPatch() {
        const data = this.patchEditor?.export()?.drawflow?.Home?.data || {};
        const nodes = [];
        const wires = [];
        for (const node of Object.values(data)) {
            nodes.push({
                id: Number(node.id),
                type: node.name,
                params: { ...node.data },
                x: node.pos_x,
                y: node.pos_y
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
                data: { ...defaultParams(n.type), ...n.params },
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
                const node = nodeOf(target);
                const onPort = Boolean(target.closest('.input, .output'));
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
                const data = editor.drawflow.drawflow[editor.module].data;
                for (const id of [...this.patchSelection]) if (data[id]) editor.removeNodeId(`node-${id}`);
                this.clearPatchSelection();
            }
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
            this.outputLine(`patch: couldn't read ${name} (${error.message})`);
            return;
        }
        const patch = readPatchFile(text);
        if (!patch) {
            this.outputLine(`patch: ${name} isn't a patch (no --@patch lines); open it with edit instead`);
            return;
        }
        if (!this.patchPanelOpen) await this.togglePatchPanel(true);
        await this.ensurePatchEditor();
        this.loadPatch(patch);
        this.patchFileName = name;
        this.outputLine(`patch: opened ${name}${this.patchRunning ? ' and running it' : ''}`);
        if (this.patchRunning) for (const line of liveLines(this.exportPatch())) this.sendPatchLine(line);
    },

    /** The "open…" list: the device's own scripts (not the runtime's or iii's). */
    fillPatchOpenList() {
        const select = this.elements.patchOpenSelect;
        if (!select) return;
        const skip = new Set(['blocks.lua', 'lib.lua', 'init.lua']);
        const names = (this.fileEntries || [])
            .map((entry) => entry.name)
            .filter((name) => name.endsWith('.lua') && !skip.has(name))
            .sort();
        select.replaceChildren();
        const prompt = document.createElement('option');
        prompt.value = '';
        prompt.textContent = names.length ? 'open…' : 'open… (no scripts)';
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
    },

    /** Every edit: remember it, and while running send it to the device. */
    /** @param {() => void} send */
    onPatchChange(send) {
        this.savePatchLocally();
        if (this.patchRunning) send();
    },

    // ------------------------------------------------------------ the device

    /** @param {string} line */
    sendPatchLine(line) {
        if (!this.iiiDevice.isConnected || this.uploadInProgress) return;
        this.executeLua(line).catch(() => {});
    },

    /** @param {number} id */
    sendPatchNode(id) {
        const node = this.patchEditor?.getNodeFromId(id);
        if (!node || !BLOCKS[node.name]) return;
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

    /** Puts lua/blocks.lua on the device when it has none or an older one. */
    async ensurePatchRuntime() {
        const version = async () => {
            const lines = await this.executeLuaCapture('print(B and B.version or 0)');
            return Number(lines.map((l) => String(l).trim()).join('')) || 0;
        };
        if ((await version()) >= RUNTIME_VERSION) return true;
        // on the device but not loaded yet?
        const files = await this.executeLuaCapture(
            'for _, f in ipairs(fs_list_files()) do if f == "blocks.lua" then print("yes") end end'
        );
        if (files.some((l) => String(l).trim() === 'yes')) {
            await this.executeLuaCapture('fs_run_file("blocks.lua")');
            if ((await version()) >= RUNTIME_VERSION) return true;
        }
        this.outputLine('patch: putting the blocks runtime (blocks.lua) on the device');
        const text = await (await fetch('lua/blocks.lua')).text();
        if (!(await this.uploadChecked('blocks.lua', text, { keepOld: true }))) {
            this.outputLine('patch: blocks.lua did not upload');
            return false;
        }
        await this.executeLuaCapture('fs_run_file("blocks.lua")');
        return (await version()) >= RUNTIME_VERSION;
    },

    async runPatch() {
        if (!this.iiiDevice.isConnected) {
            this.outputLine('patch: connect a device first');
            return;
        }
        await this.ensurePatchEditor();
        try {
            if (!(await this.ensurePatchRuntime())) return;
        } catch (error) {
            this.outputLine(`patch: ${error.message}`);
            return;
        }
        for (const line of liveLines(this.exportPatch())) this.sendPatchLine(line);
        this.patchRunning = true;
        this.updatePatchStatus();
        this.outputLine('patch: running; edits go to the device as you make them');
    },

    stopPatch() {
        if (this.patchRunning) this.sendPatchLine('B.clear()');
        this.patchRunning = false;
        this.updatePatchStatus();
    },

    async savePatchToDevice() {
        if (!this.iiiDevice.isConnected) {
            this.outputLine('patch: connect a device to save it');
            return;
        }
        const answer = window.prompt('save the patch on the device as', this.patchFileName || 'patch.lua');
        if (!answer) return;
        let name = answer.trim().replace(/[^\w.-]/g, '_');
        if (!name.endsWith('.lua')) name += '.lua';
        this.patchFileName = name;
        await this.ensurePatchRuntime();
        const written = await this.uploadChecked(name, patchFile(name.replace(/\.lua$/, ''), this.exportPatch()));
        this.outputLine(
            written
                ? `patch: saved as ${name}; it runs on its own (first("${name}") makes it the start-up script)`
                : `patch: ${name} did not save`
        );
        this.requestFileListRefresh?.();
    },

    /** @param {string} name one of EXAMPLES */
    loadExamplePatch(name) {
        const make = EXAMPLES[name];
        if (!this.patchEditor || !make) return;
        if (!window.confirm(`Replace the canvas with the ${name} example?`)) return;
        this.loadPatch(make());
        if (this.patchRunning) for (const line of liveLines(this.exportPatch())) this.sendPatchLine(line);
    },

    clearPatchCanvas() {
        if (!this.patchEditor) return;
        if (!window.confirm('Remove every block from the canvas?')) return;
        this.loadPatch({ nodes: [], wires: [] });
        // still running: blocks added next need the tick and the handlers
        if (this.patchRunning) for (const line of ['B.clear()', 'B.start()']) this.sendPatchLine(line);
    },

    patchDisconnected() {
        this.patchRunning = false;
        this.updatePatchStatus();
    }
};
