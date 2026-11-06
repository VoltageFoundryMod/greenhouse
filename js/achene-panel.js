// @ts-check
// The achene panel, drawn to scale from its PCB layout (js/achene-layout.js):
// 12 encoders, 16 RGB keys and the 2.42" OLED, played like the controller.
//
// It knows nothing about the serial port: the caller feeds it LED and screen
// frames and gets the player's input back through callbacks. js/achene.js
// connects it to the device; tools/achene-preview.html runs it on its own.
//
// Playing it:
//   encoders  drag up/down (or right/left), scroll, or arrow keys when
//             focused; a click without moving pushes it; shift-click or
//             right-click holds the push until clicked again
//   keys      press and hold like the real thing, several at once with touch;
//             shift-click or right-click holds a key until clicked again;
//             with the panel focused, the computer keyboard plays them
//             (KEYBOARD_KEYS below)

import { OledView } from './oled.js';

/**
 * @typedef {object} PanelLayout
 * @property {{ w: number, h: number, hp?: number }} panel
 * @property {{ knob_d: number, keycap: number }} sizes
 * @property {{ n: number, x: number, y: number }[]} encoders
 * @property {{ n: number, x: number, y: number, led?: number[] }[]} keys
 * @property {{ glass: Rect, active: Rect, pixels?: number[] }} oled
 * @property {{ label: string, x: number, y: number }[]} jacks
 *
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 *
 * @typedef {object} PanelCallbacks
 * @property {(n: number, d: number) => void} onEnc encoder n turned d detents
 * @property {(n: number, z: number) => void} onEncKey encoder n pushed (1) or released (0)
 * @property {(n: number, z: number) => void} onKey key n pressed (1) or released (0)
 */

/** Computer keys -> achene keys, with the panel focused: rows as on the panel. */
export const KEYBOARD_KEYS = /** @type {Record<string, number>} */ ({
    // left block, K1-K4 (bottom row, under E1-E4)
    z: 1,
    x: 2,
    c: 3,
    v: 4,
    // right block: K5-K9 above K10-K14, K15/K16 beside the encoders
    y: 5,
    u: 6,
    i: 7,
    o: 8,
    p: 9,
    h: 10,
    j: 11,
    k: 12,
    l: 13,
    ';': 14,
    '[': 15,
    "'": 16
});

const DRAG_PX = 10; // pointer travel per detent
const WHEEL_PX = 60; // trackpad travel per detent; a mouse notch is one
const CLICK_PX = 3; // less movement than this is a push, not a turn
const DETENT_DEG = 15; // EC11, 24 detents a turn

/** @param {string} tag @param {string} className @param {HTMLElement} [parent] */
function el(tag, className, parent) {
    const node = document.createElement(tag);
    node.className = className;
    parent?.appendChild(node);
    return node;
}

export class AchenePanel {
    /**
     * @param {HTMLElement} root where the panel goes (emptied)
     * @param {PanelLayout} layout
     * @param {PanelCallbacks} callbacks
     */
    constructor(root, layout, callbacks) {
        this.root = root;
        this.layout = layout;
        this.callbacks = callbacks;
        /** @type {Map<number, HTMLElement>} */
        this.encoders = new Map();
        /** @type {Map<number, HTMLElement>} */
        this.keys = new Map();
        /** @type {Map<number, number>} */
        this.angles = new Map();
        /** keys down: n -> the pointers/keyboard keys holding it */
        /** @type {Map<number, Set<string>>} */
        this.keyHolders = new Map();
        /** encoders whose push is down: n -> holders */
        /** @type {Map<number, Set<string>>} */
        this.pushHolders = new Map();
        this.encCount = layout.encoders.length;
        this.keyCount = layout.keys.length;
        this.onHeldChange = /** @type {(count: number) => void} */ (() => {});
        this.oled = this.build();
    }

    /** @returns {OledView} the screen, drawn into the OLED window */
    build() {
        const { panel, sizes } = this.layout;
        this.root.replaceChildren();
        const face = el('div', 'ach-panel', this.root);
        face.tabIndex = 0;
        face.setAttribute('role', 'application');
        face.setAttribute('aria-label', 'achene: encoders, keys and screen');
        face.style.setProperty('--panel-w', String(panel.w));
        face.style.setProperty('--panel-h', String(panel.h));
        this.face = face;

        /** positions an element by its centre, sizes in mm */
        const place = (/** @type {HTMLElement} */ node, /** @type {number} */ x, /** @type {number} */ y) => {
            node.style.left = `${(x / panel.w) * 100}%`;
            node.style.top = `${(y / panel.h) * 100}%`;
        };

        for (const jack of this.layout.jacks) {
            const node = el('span', 'ach-jack', face);
            place(node, jack.x, jack.y);
            el('span', 'ach-label ach-jack-label', node).textContent = jack.label.toLowerCase();
        }

        // the OLED: the glass in its window, the pixels in the bezel opening
        const { glass, active } = this.layout.oled;
        const glassNode = el('div', 'ach-oled', face);
        glassNode.style.left = `${(glass.x / panel.w) * 100}%`;
        glassNode.style.top = `${(glass.y / panel.h) * 100}%`;
        glassNode.style.width = `${(glass.w / panel.w) * 100}%`;
        glassNode.style.height = `${(glass.h / panel.h) * 100}%`;
        // 128x64 square pixels, centred in the opening
        const pixelsW = Math.min(active.w, active.h * 2);
        const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', 'ach-oled-pixels', glassNode));
        canvas.style.left = `${((active.x - glass.x + (active.w - pixelsW) / 2) / glass.w) * 100}%`;
        canvas.style.top = `${((active.y - glass.y + (active.h - pixelsW / 2) / 2) / glass.h) * 100}%`;
        canvas.style.width = `${(pixelsW / glass.w) * 100}%`;
        canvas.setAttribute('aria-label', 'screen');
        const oled = new OledView(canvas);

        face.style.setProperty('--knob-d', String(sizes.knob_d));
        for (const enc of this.layout.encoders) {
            const node = el('button', 'ach-enc', face);
            node.setAttribute('type', 'button');
            node.dataset.n = String(enc.n);
            node.setAttribute('aria-label', `E${enc.n}: drag or scroll to turn, click to push`);
            place(node, enc.x, enc.y);
            el('span', 'ach-knurl', node);
            el('span', 'ach-face', node);
            el('span', 'ach-light', node);
            el('span', 'ach-label', node).textContent = `E${enc.n}`;
            this.bindEncoder(node, enc.n);
            this.encoders.set(enc.n, node);
            this.angles.set(enc.n, 0);
        }

        face.style.setProperty('--cap', String(sizes.keycap));
        for (const key of this.layout.keys) {
            const node = el('button', 'ach-key', face);
            node.setAttribute('type', 'button');
            node.dataset.n = String(key.n);
            node.setAttribute('aria-label', `K${key.n}`);
            place(node, key.x, key.y);
            // where the LED shines through the switch: mm from the key's centre
            const led = key.led || [key.x, key.y];
            node.style.setProperty('--led-x', `${50 + ((led[0] - key.x) / sizes.keycap) * 100}%`);
            node.style.setProperty('--led-y', `${50 + ((led[1] - key.y) / sizes.keycap) * 100}%`);
            el('span', 'ach-cap', node);
            el('span', 'ach-legend', node).textContent = `K${key.n}`;
            this.bindKey(node, key.n);
            this.keys.set(key.n, node);
        }

        this.bindKeyboard(face);
        return oled;
    }

    // ------------------------------------------------------------ frames in

    /**
     * Key LED colours from the firmware: 6 hex digits (rrggbb) per key.
     * @param {string} hex
     */
    setLeds(hex) {
        for (const [n, node] of this.keys) {
            const rgb = hex.substr((n - 1) * 6, 6);
            if (rgb.length < 6) continue;
            const r = parseInt(rgb.slice(0, 2), 16);
            const g = parseInt(rgb.slice(2, 4), 16);
            const b = parseInt(rgb.slice(4, 6), 16);
            const peak = Math.max(r, g, b);
            if (!peak) {
                node.style.removeProperty('--led');
                node.style.setProperty('--glow', '0');
                continue;
            }
            // LED PWM is linear light; show the hue at full strength and the
            // level as the glow's opacity, on a perceptual curve
            const scale = 255 / peak;
            const hue = [r, g, b].map((v) => Math.round(255 * Math.pow((v * scale) / 255, 1 / 2.2)));
            node.style.setProperty('--led', `rgb(${hue.join(' ')})`);
            node.style.setProperty('--glow', Math.pow(peak / 255, 0.45).toFixed(3));
        }
    }

    /**
     * A screen page from the firmware.
     * @param {number} page 0-7
     * @param {string | Uint8Array} data 256 hex digits, or 128 bytes
     */
    setScreenPage(page, data) {
        this.oled.setPage(page, data);
    }

    /** @param {string} tint one of OLED_TINTS */
    setTint(tint) {
        this.oled.setTint(tint);
    }

    /**
     * How many encoders and keys the firmware has (a XIAO breadboard has 4 +
     * 4); the rest are drawn but can't be played.
     * @param {number} encoders @param {number} keys
     */
    setCounts(encoders, keys) {
        this.encCount = encoders;
        this.keyCount = keys;
        for (const [n, node] of this.encoders) node.classList.toggle('absent', n > encoders);
        for (const [n, node] of this.keys) node.classList.toggle('absent', n > keys);
    }

    /** @param {boolean} offline */
    setOffline(offline) {
        this.face?.classList.toggle('offline', offline);
        if (offline) this.releaseAll({ send: false });
    }

    // ------------------------------------------------------------ input

    /** @param {HTMLElement} node @param {number} n */
    bindEncoder(node, n) {
        /** @type {{ id: number, x: number, y: number, acc: number, travel: number } | null} */
        let drag = null;
        node.addEventListener('pointerdown', (event) => {
            if (n > this.encCount) return;
            event.preventDefault();
            node.focus({ preventScroll: true });
            if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
                this.togglePushHold(n);
                return;
            }
            if (event.button !== 0) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, acc: 0, travel: 0 };
            node.setPointerCapture(event.pointerId);
            node.classList.add('turning');
        });
        node.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            drag.x = event.clientX;
            drag.y = event.clientY;
            drag.travel += Math.abs(dx) + Math.abs(dy);
            // up or right is clockwise
            drag.acc += dx - dy;
            while (Math.abs(drag.acc) >= DRAG_PX) {
                const step = Math.sign(drag.acc);
                drag.acc -= step * DRAG_PX;
                this.turn(n, step);
            }
        });
        const end = (/** @type {PointerEvent} */ event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const pushed = event.type === 'pointerup' && drag.travel < CLICK_PX;
            drag = null;
            node.classList.remove('turning');
            if (pushed) this.tapPush(n);
        };
        node.addEventListener('pointerup', end);
        node.addEventListener('pointercancel', end);
        node.addEventListener('contextmenu', (event) => event.preventDefault());

        let wheelAcc = 0;
        let wheelLast = 0;
        node.addEventListener(
            'wheel',
            (event) => {
                if (n > this.encCount) return;
                event.preventDefault();
                if (event.timeStamp - wheelLast > 300) wheelAcc = 0;
                wheelLast = event.timeStamp;
                // a mouse notch (deltaMode lines, or 100 px) is one detent;
                // a trackpad's stream of small deltas adds up
                const lines = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * 20 : 0;
                if (lines) {
                    this.turn(n, -Math.sign(lines));
                    return;
                }
                wheelAcc -= event.deltaY - event.deltaX;
                if (Math.abs(event.deltaY) >= 100 && Number.isInteger(event.deltaY)) {
                    this.turn(n, Math.sign(wheelAcc));
                    wheelAcc = 0;
                    return;
                }
                while (Math.abs(wheelAcc) >= WHEEL_PX) {
                    const step = Math.sign(wheelAcc);
                    wheelAcc -= step * WHEEL_PX;
                    this.turn(n, step);
                }
            },
            { passive: false }
        );

        node.addEventListener('keydown', (event) => {
            if (n > this.encCount) return;
            const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
            if (step) {
                event.preventDefault();
                event.stopPropagation();
                this.turn(n, step);
            } else if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                this.pressPush(n, 'keyboard');
            }
        });
        node.addEventListener('keyup', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
                this.releasePush(n, 'keyboard');
            }
        });
    }

    /** @param {number} n @param {number} d */
    turn(n, d) {
        const node = this.encoders.get(n);
        if (!node || n > this.encCount) return;
        const angle = (this.angles.get(n) || 0) + d * DETENT_DEG;
        this.angles.set(n, angle);
        node.style.setProperty('--angle', `${angle}deg`);
        this.callbacks.onEnc(n, d);
    }

    /** a click: push and let go */
    /** @param {number} n */
    tapPush(n) {
        if (this.pushHolders.get(n)?.size) return;
        this.pressPush(n, 'tap');
        setTimeout(() => this.releasePush(n, 'tap'), 90);
    }

    /** @param {number} n */
    togglePushHold(n) {
        if (this.pushHolders.get(n)?.has('hold')) this.releasePush(n, 'hold');
        else this.pressPush(n, 'hold');
        this.reportHeld();
    }

    /** @param {number} n @param {string} holder */
    pressPush(n, holder) {
        const holders = this.pushHolders.get(n) || new Set();
        const wasDown = holders.size > 0;
        holders.add(holder);
        this.pushHolders.set(n, holders);
        this.encoders.get(n)?.classList.add('pushed');
        this.encoders.get(n)?.classList.toggle('held', holders.has('hold'));
        if (!wasDown) this.callbacks.onEncKey(n, 1);
    }

    /** @param {number} n @param {string} holder */
    releasePush(n, holder, send = true) {
        const holders = this.pushHolders.get(n);
        if (!holders?.delete(holder)) return;
        this.encoders.get(n)?.classList.toggle('held', holders.has('hold'));
        if (holders.size) return;
        this.encoders.get(n)?.classList.remove('pushed');
        if (send) this.callbacks.onEncKey(n, 0);
    }

    /** @param {HTMLElement} node @param {number} n */
    bindKey(node, n) {
        node.addEventListener('pointerdown', (event) => {
            if (n > this.keyCount) return;
            event.preventDefault();
            this.face?.focus({ preventScroll: true });
            if (event.button === 2 || (event.button === 0 && event.shiftKey) || this.keyHolders.get(n)?.has('hold')) {
                this.toggleKeyHold(n);
                return;
            }
            if (event.button !== 0) return;
            node.setPointerCapture(event.pointerId);
            this.pressKey(n, `p${event.pointerId}`);
        });
        const up = (/** @type {PointerEvent} */ event) => this.releaseKey(n, `p${event.pointerId}`);
        node.addEventListener('pointerup', up);
        node.addEventListener('pointercancel', up);
        node.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    /** @param {number} n */
    toggleKeyHold(n) {
        if (this.keyHolders.get(n)?.has('hold')) this.releaseKey(n, 'hold');
        else this.pressKey(n, 'hold');
        this.reportHeld();
    }

    /** @param {number} n @param {string} holder */
    pressKey(n, holder) {
        const holders = this.keyHolders.get(n) || new Set();
        const wasDown = holders.size > 0;
        holders.add(holder);
        this.keyHolders.set(n, holders);
        const node = this.keys.get(n);
        node?.classList.add('down');
        node?.classList.toggle('held', holders.has('hold'));
        if (!wasDown) this.callbacks.onKey(n, 1);
    }

    /** @param {number} n @param {string} holder */
    releaseKey(n, holder, send = true) {
        const holders = this.keyHolders.get(n);
        if (!holders?.delete(holder)) return;
        const node = this.keys.get(n);
        node?.classList.toggle('held', holders.has('hold'));
        if (holders.size) return;
        node?.classList.remove('down');
        if (send) this.callbacks.onKey(n, 0);
    }

    /** @param {HTMLElement} face */
    bindKeyboard(face) {
        face.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const n = KEYBOARD_KEYS[event.key.toLowerCase()];
            if (!n || n > this.keyCount) return;
            event.preventDefault();
            if (!event.repeat) this.pressKey(n, `k${event.code}`);
        });
        face.addEventListener('keyup', (event) => {
            const n = KEYBOARD_KEYS[event.key.toLowerCase()];
            if (n) this.releaseKey(n, `k${event.code}`);
        });
        // a key held on the computer keyboard would stick when focus leaves
        face.addEventListener('focusout', (event) => {
            if (face.contains(/** @type {Node | null} */ (event.relatedTarget))) return;
            for (const [n, holders] of this.keyHolders) {
                for (const holder of [...holders]) if (holder.startsWith('k')) this.releaseKey(n, holder);
            }
        });
    }

    heldCount() {
        let count = 0;
        for (const holders of this.keyHolders.values()) if (holders.has('hold')) count++;
        for (const holders of this.pushHolders.values()) if (holders.has('hold')) count++;
        return count;
    }

    reportHeld() {
        this.onHeldChange(this.heldCount());
    }

    /** Lets go of everything: held keys and pushes, and keys still down. */
    releaseAll({ send = true } = {}) {
        for (const [n, holders] of this.keyHolders) for (const h of [...holders]) this.releaseKey(n, h, send);
        for (const [n, holders] of this.pushHolders) for (const h of [...holders]) this.releasePush(n, h, send);
        this.reportHeld();
    }

    destroy() {
        this.oled.destroy();
        this.root.replaceChildren();
    }
}
