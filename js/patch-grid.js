// The patch drawer's grid layout builder. Mixed into diiiApp (diii.js) next
// to patch.js and patch-screen.js; `this` is the app.
//
// The grid blocks (lua/blocks.lua) each take a rectangle of keys: x, y (top
// left, from 1) and a width and height (1 by 1 for grid key and grid led).
// The builder draws the grid at the size of the device (offline: the one
// "for:" picks) with a box per grid block; dragging a box moves it, dragging
// its corner resizes it, and a place that would overlap another block is
// refused.

import { BLOCKS } from './patch-blocks.js';

/** @param {string} type */
const isGridBlock = (type) => BLOCKS[type]?.group === 'grid';

/** @param {string} type */
const isSizable = (type) => Boolean(BLOCKS[type]?.params?.w);

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** @param {string} text */
const escapeHtml = (text) =>
    String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);

/**
 * A grid block's keys, cut to the grid as blocks.lua does.
 * @param {string} type @param {Record<string, unknown>} data @param {{ x: number, y: number }} size
 */
function gridArea(type, data, size) {
    const int = (/** @type {unknown} */ v, /** @type {number} */ d) => Math.floor(Number(v) || d);
    const x = clamp(int(data.x, 1), 1, size.x);
    const y = clamp(int(data.y, 1), 1, size.y);
    const sizable = isSizable(type);
    const w = sizable ? clamp(int(data.w, 1), 1, size.x - x + 1) : 1;
    const h = sizable ? clamp(int(data.h, 1), 1, size.y - y + 1) : 1;
    return { x, y, w, h };
}

/** @param {{ x: number, y: number, w: number, h: number }} a @param {{ x: number, y: number, w: number, h: number }} b */
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** What a box says about its block: its kind and what it does. */
function gridNote(type, data) {
    if (type === 'gbutton') return String(data.mode || 'momentary');
    if (type === 'gfader') return `${data.lo ?? 0}–${data.hi ?? 127}`;
    if (type === 'gsteps') return `${data.steps ?? 16} steps`;
    if (type === 'gkeys' || type === 'gripples') return String(data.scale || '');
    return '';
}

export const patchGridMethods = {
    /** The "screen" button is the grid's layout on a grid. */
    togglePatchLayout() {
        if (this.patchTarget?.().device === 'grid') this.togglePatchGrid();
        else this.togglePatchScreen();
    },

    ensurePatchGridOverlay() {
        const body = this.elements.patchBody;
        if (!body || this.patchGridEl) return;
        const panel = document.createElement('div');
        panel.className = 'patch-overlay patch-gridlayout';
        panel.hidden = true;
        panel.innerHTML = `
<button type="button" class="patch-overlay-close" data-close aria-label="close the grid layout">×</button>
<h3>Grid layout</h3>
<p class="pg-hint">Each box is a grid block in the patch. Drag it to move it, drag its bottom right corner to
resize it (grid key and grid led stay one key), click it to select its block. A place over another block is refused.</p>
<p class="pg-size"></p>
<div class="pg-grid"><div class="pg-cells"></div><div class="pg-boxes"></div></div>
<p class="pg-empty" hidden>No grid blocks in the patch yet: drag one in from the palette's <b>grid</b> group.</p>`;
        panel.addEventListener('click', (event) => {
            if (/** @type {Element} */ (event.target).closest('[data-close]')) this.togglePatchGrid(false);
        });
        body.appendChild(panel);
        this.patchGridEl = panel;
    },

    /** @param {boolean} [open] */
    async togglePatchGrid(open = !this.patchGridOpen) {
        if (open && !this.patchPanelOpen) await this.togglePatchPanel(true);
        this.ensurePatchGridOverlay();
        if (!this.patchGridEl) return;
        if (open) await this.ensurePatchEditor();
        this.patchGridOpen = open;
        if (open) {
            this.togglePatchGuide?.(false);
            this.togglePatchScreen?.(false);
        }
        this.patchGridEl.hidden = !open;
        const button = this.elements.patchScreenBtn;
        if (button && this.patchTarget?.().device === 'grid') {
            button.setAttribute('aria-pressed', String(open));
            button.classList.toggle('active', open);
        }
        if (open) this.renderPatchGrid();
    },

    /** Draws the grid's keys and a box for each grid block, where it sits. */
    renderPatchGrid() {
        const editor = this.patchEditor;
        const panel = this.patchGridEl;
        if (!editor || !panel || !this.patchGridOpen) return;
        const size = this.patchTarget().size;
        const grid = /** @type {HTMLElement} */ (panel.querySelector('.pg-grid'));
        const cells = /** @type {HTMLElement} */ (panel.querySelector('.pg-cells'));
        const layer = /** @type {HTMLElement} */ (panel.querySelector('.pg-boxes'));
        grid.style.setProperty('--gx', String(size.x));
        grid.style.setProperty('--gy', String(size.y));
        if (cells.childElementCount !== size.x * size.y) {
            cells.replaceChildren();
            for (let i = 0; i < size.x * size.y; i++) {
                const cell = document.createElement('span');
                cell.className = 'pg-cell';
                cells.appendChild(cell);
            }
        }
        /** @type {HTMLElement} */ (panel.querySelector('.pg-size')).textContent =
            `${size.x} × ${size.y} keys${this.patchCaps ? '' : ' (offline: for: in the bar sets the size)'}`;
        const data = editor.drawflow.drawflow[editor.module].data;
        const blocks = Object.values(data).filter((n) => isGridBlock(n.name));
        /** @type {HTMLElement} */ (panel.querySelector('.pg-empty')).hidden = blocks.length > 0;
        layer.replaceChildren();
        const areas = blocks.map((n) => ({ node: n, a: gridArea(n.name, n.data, size) }));
        for (const { node, a } of areas) {
            const clash = areas.some((o) => o.node !== node && overlaps(o.a, a));
            const box = document.createElement('div');
            box.className = `pg-box pg-${node.name}${clash ? ' pg-clash' : ''}`;
            box.classList.toggle('pg-picked', Boolean(this.patchSelection?.has(Number(node.id))));
            box.dataset.id = String(node.id);
            Object.assign(box.style, {
                left: `${((a.x - 1) / size.x) * 100}%`,
                top: `${((a.y - 1) / size.y) * 100}%`,
                width: `${(a.w / size.x) * 100}%`,
                height: `${(a.h / size.y) * 100}%`
            });
            const label = BLOCKS[node.name].label;
            const note = gridNote(node.name, node.data);
            box.title =
                `${label}${note ? ` (${note})` : ''}: x ${a.x}, y ${a.y}` +
                (isSizable(node.name) ? `, ${a.w} × ${a.h}` : '') +
                (clash ? ', overlaps another block' : '');
            box.innerHTML =
                `<span class="pg-type">${escapeHtml(label)}</span>` +
                (note && (a.w > 1 || a.h > 1) ? `<span class="pg-note">${escapeHtml(note)}</span>` : '') +
                (isSizable(node.name) ? '<span class="pg-grip" title="drag to resize"></span>' : '');
            box.addEventListener('pointerdown', (event) => this.startPatchGridDrag(event, box, node.id, grid));
            layer.appendChild(box);
        }
    },

    /**
     * Moves a box (or, from its corner, resizes it), snapped to keys; on
     * letting go, the new place unless it overlaps another block.
     * @param {PointerEvent} start @param {HTMLElement} box @param {string|number} id @param {HTMLElement} grid
     */
    startPatchGridDrag(start, box, id, grid) {
        if (start.button !== 0) return;
        start.preventDefault();
        const editor = this.patchEditor;
        const size = this.patchTarget().size;
        const node = editor.drawflow.drawflow[editor.module].data[id];
        const a = gridArea(node.name, node.data, size);
        const resize = /** @type {Element} */ (start.target).closest('.pg-grip');
        const rect = grid.getBoundingClientRect();
        // the pointer in keys, fractional, from 0
        const at = (/** @type {PointerEvent} */ e) => [
            ((e.clientX - rect.left) / rect.width) * size.x,
            ((e.clientY - rect.top) / rect.height) * size.y
        ];
        const [sx, sy] = at(start);
        let moved = false;
        /** @param {PointerEvent} e */
        const place = (e) => {
            const [px, py] = at(e);
            if (resize) {
                return {
                    ...a,
                    w: clamp(Math.round(px - (a.x - 1)), 1, size.x - a.x + 1),
                    h: clamp(Math.round(py - (a.y - 1)), 1, size.y - a.y + 1)
                };
            }
            return {
                ...a,
                x: clamp(a.x + Math.round(px - sx), 1, size.x - a.w + 1),
                y: clamp(a.y + Math.round(py - sy), 1, size.y - a.h + 1)
            };
        };
        const others = Object.values(editor.drawflow.drawflow[editor.module].data)
            .filter((n) => isGridBlock(n.name) && String(n.id) !== String(id))
            .map((n) => gridArea(n.name, n.data, size));
        box.setPointerCapture(start.pointerId);
        box.classList.add('pg-dragging');
        const move = (/** @type {PointerEvent} */ e) => {
            const [px, py] = at(e);
            if (Math.abs(px - sx) + Math.abs(py - sy) > 0.15) moved = true;
            const p = place(e);
            Object.assign(box.style, {
                left: `${((p.x - 1) / size.x) * 100}%`,
                top: `${((p.y - 1) / size.y) * 100}%`,
                width: `${(p.w / size.x) * 100}%`,
                height: `${(p.h / size.y) * 100}%`
            });
            box.classList.toggle(
                'pg-clash',
                others.some((o) => overlaps(o, p))
            );
        };
        const end = (/** @type {PointerEvent} */ e) => {
            box.removeEventListener('pointermove', move);
            box.removeEventListener('pointerup', end);
            box.removeEventListener('pointercancel', end);
            box.classList.remove('pg-dragging');
            if (!moved) {
                this.clearPatchSelection?.();
                this.togglePatchSelected?.(Number(id));
                this.renderPatchGrid();
                return;
            }
            const p = place(e);
            if (others.some((o) => overlaps(o, p))) {
                this.outputLine?.(
                    `graft: the grid layout: ${BLOCKS[node.name].label} would overlap another block there`
                );
                this.renderPatchGrid();
                return;
            }
            this.setPatchGridPlace(id, resize ? { w: p.w, h: p.h } : { x: p.x, y: p.y });
        };
        box.addEventListener('pointermove', move);
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
    },

    /**
     * Changes a grid block's place or size, in its fields and on the device
     * (live, or waiting for apply).
     * @param {string|number} id @param {{ x?: number, y?: number, w?: number, h?: number }} place
     */
    setPatchGridPlace(id, place) {
        const editor = this.patchEditor;
        const node = editor?.drawflow.drawflow[editor.module].data[id];
        if (!node) return;
        editor.updateNodeDataFromId(id, { ...node.data, ...place });
        const n = Number(id);
        this.onPatchChange(
            () => this.queuePatchNode(n),
            `node:${n}`,
            () => this.sendPatchNode(n)
        );
        this.renderPatchGrid();
    }
};
