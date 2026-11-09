// The patch drawer's screen layout builder and its guide. Mixed into diiiApp
// (diii.js) next to patch.js; `this` is the app.
//
// The screen blocks (lua/blocks.lua) share a grid that matches achene's
// panel: four columns of 32 px under E1-E4 and over K1-K4, and rows top,
// middle (or its two halves) and bottom. The builder draws that grid with
// a box per screen block in the patch; dragging a box sets its row and
// column, its right edge its width, and a double-click switches it between
// the full middle row and a half.

import { BLOCKS, RECIPES } from './patch-blocks.js';

/** the rows as [y, height] in screen pixels (128 x 64), as in blocks.lua */
const ROWS = {
    top: [0, 9],
    middle: [10, 44],
    'middle top': [10, 22],
    'middle bottom': [32, 22],
    bottom: [55, 9]
};

/** @param {string} type */
const isScreenBlock = (type) => Boolean(BLOCKS[type]?.params?.where);

/** A screen block's place: x, y, w, h in screen pixels. */
function areaOf(type, data) {
    const params = BLOCKS[type].params;
    const where = ROWS[data.where] ? data.where : params.where.default;
    const col = Math.min(4, Math.max(1, Math.floor(Number(data.col) || 1)));
    const span = Math.min(5 - col, Math.max(1, Math.floor(Number(data.span) || Number(params.span?.default) || 1)));
    const [y, h] = ROWS[where];
    return { x: (col - 1) * 32, y, w: span * 32, h, where, col, span };
}

/** @param {string} text */
const escapeHtml = (text) =>
    String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);

/**
 * The grid as a picture: the screen's rows and columns with the encoders
 * above and the keys below, for the guide.
 */
export function screenDiagram() {
    const s = 3; // px per screen pixel
    const ox = 20;
    const oy = 54;
    const W = 128 * s;
    const H = 64 * s;
    const parts = [];
    for (let c = 0; c < 4; c++) {
        const cx = ox + (c * 32 + 16) * s;
        parts.push(
            `<circle cx="${cx}" cy="18" r="13" class="sd-enc"/><text x="${cx}" y="22" class="sd-cap">E${c + 1}</text>`
        );
        parts.push(
            `<rect x="${cx - 13}" y="${oy + H + 10}" width="26" height="26" rx="3" class="sd-key"/><text x="${cx}" y="${oy + H + 27}" class="sd-cap">K${c + 1}</text>`
        );
    }
    parts.push(`<rect x="${ox}" y="${oy}" width="${W}" height="${H}" class="sd-screen"/>`);
    const rows = [
        ['top', 0, 9, 'what the encoders above do'],
        ['middle top', 10, 22, 'sliders, knobs, steps, graphs…'],
        ['middle bottom', 32, 22, '(or one full "middle" row)'],
        ['bottom', 55, 9, 'what the keys below do']
    ];
    for (const [name, y, h, note] of rows) {
        parts.push(
            `<rect x="${ox}" y="${oy + y * s}" width="${W}" height="${h * s}" class="sd-row sd-${name.replace(' ', '-')}"/>`,
            `<text x="${ox + W + 10}" y="${oy + (y + h / 2) * s + 4}" class="sd-name">${name}</text>`,
            `<text x="${ox + W + 10}" y="${oy + (y + h / 2) * s + 17}" class="sd-note">${note}</text>`
        );
    }
    for (let c = 1; c < 4; c++) {
        parts.push(`<line x1="${ox + c * 32 * s}" y1="${oy}" x2="${ox + c * 32 * s}" y2="${oy + H}" class="sd-col"/>`);
    }
    for (let c = 0; c < 4; c++) {
        parts.push(`<text x="${ox + (c * 32 + 16) * s}" y="${oy - 6}" class="sd-colnum">column ${c + 1}</text>`);
    }
    return `<svg class="screen-diagram" viewBox="0 0 ${ox + W + 200} ${oy + H + 46}" role="img" aria-label="the screen's rows and columns, with encoders E1 to E4 above and keys K1 to K4 below">${parts.join('')}</svg>`;
}

const GUIDE = `
<button type="button" class="patch-overlay-close" data-close aria-label="close the guide">×</button>
<h3>Patching guide</h3>
<p>A patch is <b>blocks</b> joined by <b>wires</b>. Each block does one small thing; when something happens
(an encoder turns, a beat ticks, a note comes in) a number travels along its wires to the next blocks.
The patch runs on the device itself, and keeps running after it's saved, without diii.</p>

<h4>Blocks</h4>
<ul>
<li><b>achene</b>: the panel's encoders, pushes, keys and key LEDs. <b>screen</b>: things drawn on its OLED.</li>
<li><b>sources</b> start messages (lfo, metro, clock in, MIDI in); <b>process</b>, <b>math</b> and
<b>memory</b> shape them (value, scale, counter, quantize, a + b…); <b>output</b> sends them out (MIDI, print);
<b>custom</b> is a block of your own Lua.</li>
<li>Add a block by clicking it in the palette, or drag it onto the canvas. Hover a block's title, a field
or a port to see what it does.</li>
</ul>

<h4>Wires</h4>
<ul>
<li>Drag from an <b>output</b> (a block's right side) to an <b>input</b> (the left side), or from an input
back to an output. One output can feed many inputs.</li>
<li>Ports with a name show it beside them: a math block's <i>a</i> and <i>b</i>, a counter's
<i>step</i> and <i>reset</i>.</li>
<li><b>Remove a wire</b>: click it and press Delete, or right-click it and click ×.
<b>Remove blocks</b>: select them and press Delete.</li>
</ul>

<h4>Moving around</h4>
<table>
<tr><td>wheel</td><td>zoom around the pointer (or − 100% + and fit, bottom right)</td></tr>
<tr><td>drag on empty space</td><td>select the blocks in a box (shift adds)</td></tr>
<tr><td>click a block</td><td>select it; shift- or ctrl-click adds or removes one</td></tr>
<tr><td>drag a block's title</td><td>move it, with the rest of the selection</td></tr>
<tr><td>space + drag, middle button</td><td>pan</td></tr>
<tr><td>ctrl+C, X, V</td><td>copy, cut, paste the selection, with the wires between its blocks (a paste lands under the mouse)</td></tr>
<tr><td>ctrl+D</td><td>duplicate the selection beside it</td></tr>
<tr><td>ctrl+A</td><td>select every block</td></tr>
<tr><td>right-click</td><td>on a block or a selection: duplicate, copy, cut, delete, and what the block does;
on empty canvas: paste here, select all; on a wire: × deletes it</td></tr>
<tr><td>export…, import…</td><td>save the patch to a file on your computer, or load one (works offline)</td></tr>
<tr><td>Delete, Esc</td><td>remove the selection, let go of it</td></tr>
</table>

<h4>Running it</h4>
<ul>
<li><b>run</b> starts the patch on the device (from scratch); <b>stop</b> stops it.</li>
<li><b>live</b> on: every edit reaches the running patch at once. Off: edits wait, and <b>apply</b> sends
them together, without restarting.</li>
<li><b>save…</b> writes the patch as a script that runs on its own (marked <i>patch</i> in the file list);
<b>open…</b> brings one back to the canvas.</li>
</ul>

<h4>Steps: tips</h4>
<table>
<tr><td>set a step's note</td><td>wire an encoder to <i>edit</i> (input 3); press the step's key, then turn within 2 seconds
(or hold the key while turning). Turning with no step pressed transposes them all.</td></tr>
<tr><td>pages, with an encoder</td><td>encoder → <i>page</i> (input 4): turn through auto, page 1, page 2…; auto follows the
playing step.</td></tr>
<tr><td>pages, with keys</td><td>key → <i>page</i> is next page; key → math (× −1) → <i>page</i> is previous. The page input
counts steps (positive next, negative previous, 0 nothing), so no value block in between: it would send its total, always
positive, on press and release, two pages a click.</td></tr>
<tr><td>length</td><td>encoder → value (1 to 64) → <i>length</i> (input 5). This input takes a number of steps, so here a
value block is the right thing.</td></tr>
<tr><td>beat or counter</td><td>set <i>input 1 is</i> to beat and wire a metro or clock in straight in: it wraps at the
length, whatever it is. With step number, a counter drives it, and its hi should match the length.</td></tr>
<tr><td>playing notes</td><td><i>note</i> (output 2) → midi note's input 2 (through quantize for a scale), <i>gate</i> (output 1)
→ its input 1: the note is sent first, so it plays the right pitch.</td></tr>
</table>

<h4>Recipes</h4>
<p>Small wirings to start from: <b>add</b> puts one on the canvas beside what's there (nothing is replaced).</p>
<div class="patch-recipes">
${RECIPES.map(
    (r) =>
        `<div class="patch-recipe"><b>${escapeHtml(r.title)}</b><code>${escapeHtml(r.chain)}</code>` +
        `<p>${escapeHtml(r.text)}</p><button type="button" class="repl-action-btn" data-recipe="${r.name}">add</button></div>`
).join('')}
</div>

<h4>Saving and sharing</h4>
<ul>
<li>Blocks that remember things (a steps pattern and its notes, a value, a toggle, a counter, a memory) keep it:
<b>stop</b>, <b>save…</b> and <b>export…</b> ask the device for it, so <b>run</b>, a saved script and an
exported file start again where you left off.</li>
<li>A patch file says which blocks.lua it needs: on a device with an older one it prints so instead of
failing, and diii tells you about blocks it doesn't know when you open or import one.</li>
<li><b>save…</b> and <b>open…</b> use the device; <b>export…</b> and <b>import…</b> use a file on your computer
(the same format), so a patch can be made, kept and shared with no device connected: the <b>patch</b> button at the
top opens the editor any time.</li>
<li>Copied blocks (ctrl+C) paste into another diii tab too.</li>
</ul>

<h4>The screen</h4>
<p>The screen blocks share a grid that matches the panel: four columns under the encoders E1–E4 and over the
keys K1–K4, and rows for each job. Each block takes a <b>row</b>, a <b>column</b> and a <b>width</b> in
columns.</p>
${screenDiagram()}
<p><button type="button" class="repl-action-btn" data-open-screen>open the screen layout</button> to place
them by dragging. Two examples (examples… in the bar) put it together: <b>sequencer</b>, 16 steps drawn as
bars across the middle and played from the keys under E5–E12 (press a step, then turn E1 for its note), and
<b>controller</b>, four CCs on E1–E4 named over their encoders with knobs and sliders under them.</p>
`;

export const patchScreenMethods = {
    /** The guide and the builder: panels over the canvas, made on first use. */
    ensurePatchOverlays() {
        const body = this.elements.patchBody;
        if (!body || this.patchGuideEl) return;
        const guide = document.createElement('div');
        guide.className = 'patch-overlay patch-guide';
        guide.hidden = true;
        guide.innerHTML = GUIDE;
        guide.addEventListener('click', (event) => {
            const target = /** @type {Element} */ (event.target);
            if (target.closest('[data-close]')) this.togglePatchGuide(false);
            if (target.closest('[data-open-screen]')) {
                this.togglePatchGuide(false);
                this.togglePatchScreen(true);
            }
            const recipe = target.closest('[data-recipe]');
            if (recipe) this.addPatchRecipe(/** @type {HTMLElement} */ (recipe).dataset.recipe || '');
        });
        body.appendChild(guide);
        this.patchGuideEl = guide;

        const screen = document.createElement('div');
        screen.className = 'patch-overlay patch-screen';
        screen.hidden = true;
        screen.innerHTML = `
<button type="button" class="patch-overlay-close" data-close aria-label="close the screen layout">×</button>
<h3>Screen layout</h3>
<p class="ps-hint">Each box is a screen block in the patch. Drag it to move it, drag its right edge to
widen it, double-click it to switch between the full middle row and a half. Click one to select its block.</p>
<div class="ps-panel">
  <div class="ps-encs">${[1, 2, 3, 4].map((n) => `<span class="ps-enc">E${n}</span>`).join('')}</div>
  <div class="ps-screen"></div>
  <div class="ps-keys">${[1, 2, 3, 4].map((n) => `<span class="ps-key">K${n}</span>`).join('')}</div>
</div>
<p class="ps-empty" hidden>No screen blocks in the patch yet: drag one in from the palette's <b>screen</b> group.</p>`;
        screen.addEventListener('click', (event) => {
            if (/** @type {Element} */ (event.target).closest('[data-close]')) this.togglePatchScreen(false);
        });
        body.appendChild(screen);
        this.patchScreenEl = screen;
    },

    /** @param {boolean} [open] */
    async togglePatchGuide(open = !this.patchGuideOpen) {
        // from the opening page, before a device shows the drawer
        if (open && this.elements.patchDrawer?.hidden) this.elements.patchDrawer.hidden = false;
        if (open && !this.patchPanelOpen) await this.togglePatchPanel(true);
        this.ensurePatchOverlays();
        if (!this.patchGuideEl) return;
        this.patchGuideOpen = open;
        if (open) this.togglePatchScreen(false);
        this.patchGuideEl.hidden = !open;
        this.elements.patchGuideBtn?.setAttribute('aria-pressed', String(open));
        this.elements.patchGuideBtn?.classList.toggle('active', open);
    },

    /**
     * Adds a recipe's blocks near the top left of what's visible, selected,
     * and closes the guide to show them.
     * @param {string} name
     */
    async addPatchRecipe(name) {
        const recipe = RECIPES.find((r) => r.name === name);
        if (!recipe) return;
        await this.ensurePatchEditor();
        this.togglePatchGuide(false);
        const rect = this.elements.patchCanvas.getBoundingClientRect();
        this.pastePatch?.(recipe.patch, { x: rect.left + 40, y: rect.top + 30 }, true);
    },

    /** @param {boolean} [open] */
    async togglePatchScreen(open = !this.patchScreenOpen) {
        if (open && !this.patchPanelOpen) await this.togglePatchPanel(true);
        this.ensurePatchOverlays();
        if (!this.patchScreenEl) return;
        if (open) await this.ensurePatchEditor();
        this.patchScreenOpen = open;
        if (open) this.togglePatchGuide(false);
        this.patchScreenEl.hidden = !open;
        this.elements.patchScreenBtn?.setAttribute('aria-pressed', String(open));
        this.elements.patchScreenBtn?.classList.toggle('active', open);
        if (open) this.renderPatchScreen();
    },

    /** Draws a box for each screen block, where it sits. */
    renderPatchScreen() {
        const editor = this.patchEditor;
        const panel = this.patchScreenEl;
        if (!editor || !panel || !this.patchScreenOpen) return;
        const screen = /** @type {HTMLElement} */ (panel.querySelector('.ps-screen'));
        const data = editor.drawflow.drawflow[editor.module].data;
        const blocks = Object.values(data).filter((n) => isScreenBlock(n.name));
        /** @type {HTMLElement} */ (panel.querySelector('.ps-empty')).hidden = blocks.length > 0;
        screen.replaceChildren();
        const areas = blocks.map((n) => ({ node: n, a: areaOf(n.name, n.data) }));
        for (const { node, a } of areas) {
            const clash = areas.some(
                (o) =>
                    o.node !== node &&
                    o.a.x < a.x + a.w &&
                    a.x < o.a.x + o.a.w &&
                    o.a.y < a.y + a.h &&
                    a.y < o.a.y + o.a.h
            );
            const box = document.createElement('div');
            box.className = `ps-box ps-${a.where.replace(' ', '-')}${clash ? ' ps-clash' : ''}`;
            box.classList.toggle('ps-picked', Boolean(this.patchSelection?.has(Number(node.id))));
            box.dataset.id = String(node.id);
            Object.assign(box.style, {
                left: `${(a.x / 128) * 100}%`,
                top: `${(a.y / 64) * 100}%`,
                width: `${(a.w / 128) * 100}%`,
                height: `${(a.h / 64) * 100}%`
            });
            const name = node.data.label ?? node.data.text ?? '';
            box.title = `${BLOCKS[node.name].label}${name ? `: ${name}` : ''} (${a.where}, column ${a.col}, width ${a.span})${clash ? ', overlaps another block' : ''}`;
            box.innerHTML =
                `<span class="ps-type">${escapeHtml(BLOCKS[node.name].label)}</span>` +
                (name ? `<span class="ps-name">${escapeHtml(name)}</span>` : '') +
                '<span class="ps-grip" title="drag to widen or narrow"></span>';
            box.addEventListener('pointerdown', (event) => this.startPatchScreenDrag(event, box, node.id, screen));
            box.addEventListener('dblclick', () => {
                const cur = areaOf(node.name, data[node.id].data).where;
                const next = cur === 'middle' ? 'middle top' : cur.startsWith('middle') ? 'middle' : null;
                if (next) this.setPatchScreenPlace(node.id, { where: next });
            });
            screen.appendChild(box);
        }
    },

    /**
     * Moves a box (or, from its grip, widens it) and snaps it to the grid
     * when let go.
     * @param {PointerEvent} start @param {HTMLElement} box @param {string|number} id @param {HTMLElement} screen
     */
    startPatchScreenDrag(start, box, id, screen) {
        if (start.button !== 0) return;
        start.preventDefault();
        const editor = this.patchEditor;
        const node = editor.drawflow.drawflow[editor.module].data[id];
        const a = areaOf(node.name, node.data);
        const resize = /** @type {Element} */ (start.target).closest('.ps-grip');
        const rect = screen.getBoundingClientRect();
        const px = (/** @type {PointerEvent} */ e) => [
            ((e.clientX - rect.left) / rect.width) * 128,
            ((e.clientY - rect.top) / rect.height) * 64
        ];
        const [sx, sy] = px(start);
        let moved = false;
        box.setPointerCapture(start.pointerId);
        box.classList.add('ps-dragging');
        const move = (/** @type {PointerEvent} */ e) => {
            const [x, y] = px(e);
            if (Math.abs(x - sx) + Math.abs(y - sy) > 2) moved = true;
            if (resize) {
                const span = Math.min(5 - a.col, Math.max(1, Math.round((x - a.x) / 32)));
                box.style.width = `${((span * 32) / 128) * 100}%`;
            } else {
                box.style.transform = `translate(${((x - sx) / 128) * rect.width}px, ${((y - sy) / 64) * rect.height}px)`;
            }
        };
        const end = (/** @type {PointerEvent} */ e) => {
            box.removeEventListener('pointermove', move);
            box.removeEventListener('pointerup', end);
            box.removeEventListener('pointercancel', end);
            box.classList.remove('ps-dragging');
            const [x, y] = px(e);
            if (!moved) {
                // a click: select the block on the canvas
                this.clearPatchSelection?.();
                this.togglePatchSelected?.(Number(id));
                this.renderPatchScreen();
                return;
            }
            if (resize) {
                this.setPatchScreenPlace(id, { span: Math.min(5 - a.col, Math.max(1, Math.round((x - a.x) / 32))) });
                return;
            }
            // where the box's centre landed
            const cx = a.x + a.w / 2 + (x - sx);
            const cy = a.y + a.h / 2 + (y - sy);
            const col = Math.min(5 - a.span, Math.max(1, Math.floor((cx - a.w / 2 + 16) / 32) + 1));
            let where;
            if (cy < 10) where = 'top';
            else if (cy >= 55) where = 'bottom';
            else if (a.where === 'middle') where = 'middle';
            else where = cy < 32 ? 'middle top' : 'middle bottom';
            this.setPatchScreenPlace(id, { where, col });
        };
        box.addEventListener('pointermove', move);
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
    },

    /**
     * Changes a screen block's row, column or width, in its fields and on
     * the device (live, or waiting for apply).
     * @param {string|number} id @param {{ where?: string, col?: number, span?: number }} place
     */
    setPatchScreenPlace(id, place) {
        const editor = this.patchEditor;
        const node = editor?.drawflow.drawflow[editor.module].data[id];
        if (!node) return;
        const next = { ...node.data, ...place };
        // a wider block may no longer fit its column
        const a = areaOf(node.name, next);
        next.col = a.col;
        next.span = a.span;
        editor.updateNodeDataFromId(id, next);
        const n = Number(id);
        this.onPatchChange(
            () => this.queuePatchNode(n),
            `node:${n}`,
            () => this.sendPatchNode(n)
        );
        this.renderPatchScreen();
    }
};
