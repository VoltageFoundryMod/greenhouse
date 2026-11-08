// Drawer heights: a divider under each drawer's body (patch, achene, grid,
// MIDI list) that drags its height, like the one between the editor and the
// console. The height is kept for the next visit. Mixed into diiiApp
// (diii.js); `this` is the app.

const KEY = 'webdiii.paneHeights';

/** [body element id, its minimum height] */
const PANES = [
    ['patchBody', 160],
    ['acheneBody', 140],
    ['gridBody', 120],
    ['midiList', 50]
];

function loadHeights() {
    try {
        return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {};
    } catch {
        return {};
    }
}

/** @param {Record<string, number>} heights */
function saveHeights(heights) {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(heights));
    } catch {
        // storage blocked: the height lasts until reload
    }
}

export const dividerMethods = {
    bindPaneDividers() {
        const heights = loadHeights();
        for (const [id, min] of PANES) {
            const body = document.getElementById(id);
            if (!body?.parentElement) continue;
            if (heights[id]) body.style.height = `${heights[id]}px`;
            const divider = document.createElement('div');
            divider.className = 'pane-divider';
            divider.setAttribute('role', 'separator');
            divider.setAttribute('aria-orientation', 'horizontal');
            divider.setAttribute('aria-label', 'resize');
            divider.tabIndex = 0;
            divider.title = 'drag to resize (double-click: back to the default size)';
            body.after(divider);

            const max = () => Math.round(window.innerHeight * 0.85);
            /** @param {number} h @param {boolean} keep */
            const setHeight = (h, keep) => {
                const clamped = Math.round(Math.max(min, Math.min(max(), h)));
                body.style.height = `${clamped}px`;
                if (keep) {
                    heights[id] = clamped;
                    saveHeights(heights);
                }
            };

            divider.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                const startY = event.clientY;
                const startH = body.getBoundingClientRect().height;
                divider.setPointerCapture(event.pointerId);
                divider.classList.add('dragging');
                document.body.classList.add('is-resizing-editor-rows');
                const move = (/** @type {PointerEvent} */ e) => setHeight(startH + (e.clientY - startY), false);
                const end = () => {
                    divider.classList.remove('dragging');
                    document.body.classList.remove('is-resizing-editor-rows');
                    divider.removeEventListener('pointermove', move);
                    divider.removeEventListener('pointerup', end);
                    divider.removeEventListener('pointercancel', end);
                    setHeight(body.getBoundingClientRect().height, true);
                };
                divider.addEventListener('pointermove', move);
                divider.addEventListener('pointerup', end);
                divider.addEventListener('pointercancel', end);
            });
            divider.addEventListener('dblclick', () => {
                body.style.height = '';
                delete heights[id];
                saveHeights(heights);
            });
            divider.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                const step = event.shiftKey ? 40 : 10;
                const h = body.getBoundingClientRect().height;
                setHeight(h + (event.key === 'ArrowDown' ? step : -step), true);
            });
        }
    }
};
