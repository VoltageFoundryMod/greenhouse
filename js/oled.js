// @ts-check
// A 128x64 monochrome OLED drawn on a canvas, from the controller's page
// format (SSD1306/SSD1309: 8 pages of 128 column bytes, bit 0 = top row).
//
// Ported from ForgeSeries' FramebufferDisplay (its VCV Rack plugins). At the
// sizes a browser shows it, one OLED pixel is rarely a whole number of screen
// pixels: plain nearest-neighbour scaling then makes some columns one pixel
// wide and some two, and a 1 px font stem can vanish. So the canvas is drawn
// at its exact device-pixel size, each texel takes the area of the OLED
// pixels it covers, and coverage is pushed back to hard on/off edges. Once an
// OLED pixel is large enough, the dark grid between pixels shows, which is
// much of why the real panel looks sharp.

const W = 128;
const H = 64;
const PAGES = H / 8;

/** OLED colours sold on 2.42" SSD1309 modules: lit pixel, unlit glass. */
export const OLED_TINTS = /** @type {Record<string, { lit: number[], glass: number[] }>} */ ({
    white: { lit: [226, 232, 255], glass: [6, 8, 12] },
    blue: { lit: [70, 170, 255], glass: [4, 8, 14] },
    yellow: { lit: [255, 205, 60], glass: [10, 8, 4] },
    green: { lit: [110, 255, 160], glass: [4, 10, 8] }
});

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Area-exact resampling weights for one axis: `n` source cells, each lit over
 * [i + g, i + 1 - g], resampled to `m` destination samples. Weights are the
 * fraction of each destination sample a cell covers.
 * @param {number} n @param {number} m @param {number} g
 */
function axisMap(n, m, g) {
    const step = n / m;
    const k = Math.ceil(step) + 1;
    const first = new Int32Array(m);
    const w = new Float32Array(m * k);
    for (let d = 0; d < m; d++) {
        const a = d * step;
        const b = a + step;
        const i0 = Math.max(Math.floor(a), 0);
        const i1 = Math.max(Math.min(Math.ceil(b) - 1, n - 1), i0);
        first[d] = i0;
        for (let i = i0; i <= i1 && i - i0 < k; i++) {
            const lo = Math.max(a, i + g);
            const hi = Math.min(b, i + 1 - g);
            if (hi > lo) w[d * k + (i - i0)] = (hi - lo) / step;
        }
    }
    return { k, first, w };
}

export class OledView {
    /**
     * @param {HTMLCanvasElement} canvas sized by CSS; the backing store follows it
     * @param {{ tint?: string, pixelGap?: number, sharpen?: number, gamma?: number }} [options]
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        /** the frame: 8 pages x 128 column bytes */
        this.pages = new Uint8Array(PAGES * W);
        this.pixelGap = options.pixelGap ?? 0.16;
        this.sharpen = options.sharpen ?? 4;
        this.gamma = options.gamma ?? 2.2;
        this.tint = OLED_TINTS.white;
        this.setTint(options.tint || 'white');
        this.frameRequested = false;
        this.resizeObserver = new ResizeObserver(() => this.requestDraw());
        this.resizeObserver.observe(canvas);
    }

    /** @param {string} name one of OLED_TINTS */
    setTint(name) {
        this.tint = OLED_TINTS[name] || OLED_TINTS.white;
        this.requestDraw();
    }

    /**
     * One page from the firmware: 128 bytes, or 256 hex digits.
     * @param {number} page 0-7
     * @param {Uint8Array | string} data
     */
    setPage(page, data) {
        if (page < 0 || page >= PAGES) return;
        const row = this.pages.subarray(page * W, page * W + W);
        if (typeof data === 'string') {
            for (let x = 0; x < W && 2 * x + 1 < data.length; x++) {
                row[x] = parseInt(data.substr(2 * x, 2), 16) || 0;
            }
        } else {
            row.set(data.subarray(0, W));
        }
        this.requestDraw();
    }

    clear() {
        this.pages.fill(0);
        this.requestDraw();
    }

    /** @param {number} x @param {number} y */
    lit(x, y) {
        return (this.pages[(y >> 3) * W + x] >> (y & 7)) & 1;
    }

    requestDraw() {
        if (this.frameRequested) return;
        this.frameRequested = true;
        requestAnimationFrame(() => {
            this.frameRequested = false;
            this.draw();
        });
    }

    draw() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const tw = Math.max(16, Math.round(rect.width * dpr));
        const th = Math.max(8, Math.round(rect.height * dpr));
        if (!rect.width || !rect.height) return;
        if (this.canvas.width !== tw || this.canvas.height !== th) {
            this.canvas.width = tw;
            this.canvas.height = th;
        }

        // texels per OLED pixel; below 1 the screen can't show every pixel
        const s = tw / W;
        // the dark grid between pixels only reads once there's room to draw it
        let fade = clamp((s - 4) / 4, 0, 1);
        fade = fade * fade * (3 - 2 * fade);
        const g = clamp(this.pixelGap, 0, 0.9) * fade * 0.5;
        const mx = axisMap(W, tw, g);
        const my = axisMap(H, th, g);

        // horizontal pass: per OLED row, the coverage of each output column
        const tmp = new Float32Array(H * tw);
        for (let y = 0; y < H; y++) {
            const out = y * tw;
            for (let dx = 0; dx < tw; dx++) {
                const i0 = mx.first[dx];
                let sum = 0;
                for (let t = 0; t < mx.k; t++) {
                    const x = i0 + t;
                    if (x >= W) break;
                    const wt = mx.w[dx * mx.k + t];
                    if (wt && this.lit(x, y)) sum += wt;
                }
                tmp[out + dx] = sum;
            }
        }

        // An isolated pixel can only cover `s` of a texel when downscaling, so
        // without this a 1 px stem never reaches full brightness.
        const gain = s < 1 ? Math.min(1 / Math.max(s, 0.25), 2) : 1;
        // Push partial coverage to on or off, so an edge inside a texel isn't
        // grey; eased off as the pixel gap (a soft edge we want) fades in.
        const k = 1 + (Math.max(this.sharpen, 1) - 1) * (1 - fade);
        const inv = 1 / Math.max(this.gamma, 0.01);
        const [lr, lg, lb] = this.tint.lit;
        const [gr, gg, gb] = this.tint.glass;

        const image = this.ctx.createImageData(tw, th);
        const px = image.data;
        // vertical pass, then colour: the glass behind, the lit colour on top
        for (let dy = 0; dy < th; dy++) {
            const j0 = my.first[dy];
            for (let dx = 0; dx < tw; dx++) {
                let cov = 0;
                for (let t = 0; t < my.k; t++) {
                    const y = j0 + t;
                    if (y >= H) break;
                    const wt = my.w[dy * my.k + t];
                    if (wt) cov += wt * tmp[y * tw + dx];
                }
                const c = clamp((cov * gain - 0.5) * k + 0.5, 0, 1);
                const a = c > 0 ? Math.pow(c, inv) : 0;
                const o = (dy * tw + dx) * 4;
                px[o] = gr + (lr - gr) * a;
                px[o + 1] = gg + (lg - gg) * a;
                px[o + 2] = gb + (lb - gb) * a;
                px[o + 3] = 255;
            }
        }
        this.ctx.putImageData(image, 0, 0);
    }

    destroy() {
        this.resizeObserver.disconnect();
    }
}
