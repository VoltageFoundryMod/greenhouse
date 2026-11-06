// achene: a virtual achene in a drawer at the top of the console. It shows
// the controller's panel (js/achene-panel.js), mirrors its key LEDs and OLED
// and plays its encoders and keys from the browser.
// Mixed into diiiApp (diii.js); `this` is the app.
//
// Firmware side (achene, firmware/src/main.c):
//   ach_mirror(on)         stream frames: on turning on, everything once, then
//   ^^achled(<rrggbb x keys>)     when the key LEDs change
//   ^^achscr(<page 0-7>,<256 hex>) for each OLED page that changed
//   ach_enc(n, d), ach_enc_key(n, z), ach_key(n, z)   input, as from the hardware
//   ach_board(), enc_count(), key_count()             what this build has

import { AchenePanel } from './achene-panel.js';
import { ACHENE_LAYOUT } from './achene-layout.js';

const DRAWER_KEY = 'webdiii.acheneDrawer';
const TINT_KEY = 'webdiii.acheneTint';

export const acheneMethods = {
    /** Builds the panel once; it stays hidden until an achene connects. */
    initAchene() {
        this.acheneSupported = false;
        this.achenePanelOpen = false;
        this.acheneInfo = null;
        /** encoder steps not sent yet, summed per animation frame */
        this.acheneEncPending = new Map();
        this.acheneEncFlushRequested = false;
        if (!this.elements.acheneBody) return;

        this.achenePanel = new AchenePanel(this.elements.acheneBody, ACHENE_LAYOUT, {
            onEnc: (n, d) => this.queueAcheneEnc(n, d),
            onEncKey: (n, z) => this.sendAchene(`ach_enc_key(${n},${z})`),
            onKey: (n, z) => this.sendAchene(`ach_key(${n},${z})`)
        });
        this.achenePanel.onHeldChange = (count) => this.updateAcheneHeld(count);
        this.achenePanel.onHelpChange = (open) =>
            this.elements.acheneHelpBtn?.setAttribute('aria-pressed', String(open));
        this.achenePanel.setOffline(true);

        let tint = 'white';
        let open = false;
        try {
            tint = window.localStorage.getItem(TINT_KEY) || 'white';
            open = window.localStorage.getItem(DRAWER_KEY) === 'open';
        } catch {
            // storage blocked
        }
        if (this.elements.acheneTint) this.elements.acheneTint.value = tint;
        this.achenePanel.setTint(tint);
        this.achenePanelOpen = open;
        this.showAcheneDrawerState();
    },

    /** After connecting: an achene shows its drawer, anything else hides it. */
    async detectAchene() {
        let info = null;
        try {
            const lines = await this.executeLuaCapture(
                'print(ach_mirror ~= nil and (ach_board() .. " " .. enc_count() .. " " .. key_count()) or "none")'
            );
            const match = lines
                .map((line) => String(line).trim())
                .join(' ')
                .match(/^(\S+) (\d+) (\d+)$/);
            if (match) info = { board: match[1], encoders: Number(match[2]), keys: Number(match[3]) };
        } catch {
            // device busy or not answering; treat as unsupported
        }

        this.acheneSupported = Boolean(info);
        this.acheneInfo = info;
        if (this.elements.acheneDrawer) this.elements.acheneDrawer.hidden = !this.acheneSupported;
        this.updatePatchAvailability?.();
        if (!info || !this.achenePanel) return;

        this.achenePanel.setCounts(info.encoders, info.keys);
        this.achenePanel.setOffline(false);
        this.updateAcheneStatus();
        if (this.achenePanelOpen) await this.setAcheneMirror(true);
    },

    showAcheneDrawerState() {
        const open = this.achenePanelOpen;
        this.elements.acheneDrawer?.classList.toggle('open', open);
        if (this.elements.acheneToggleBtn) {
            this.elements.acheneToggleBtn.textContent = open ? 'achene ▾' : 'achene ▸';
            this.elements.acheneToggleBtn.setAttribute('aria-expanded', String(open));
        }
        this.updateAcheneStatus();
    },

    updateAcheneStatus() {
        const status = this.elements.acheneStatus;
        if (!status) return;
        const info = this.acheneInfo;
        if (!this.acheneSupported || !info) {
            status.textContent = '';
            return;
        }
        const live = this.achenePanelOpen && this.iiiDevice.isConnected;
        status.textContent = `${info.board} · ${info.encoders} enc · ${info.keys} keys${live ? ' · live' : ''}`;
    },

    async toggleAchenePanel(open = !this.achenePanelOpen) {
        this.achenePanelOpen = open;
        try {
            window.localStorage.setItem(DRAWER_KEY, open ? 'open' : 'closed');
        } catch {
            // storage blocked
        }
        this.showAcheneDrawerState();
        if (!open) this.achenePanel?.releaseAll();
        if (this.iiiDevice.isConnected && this.acheneSupported) {
            await this.setAcheneMirror(open);
        }
    },

    /** @param {boolean} on */
    async setAcheneMirror(on) {
        try {
            await this.executeLua(`ach_mirror(${on ? 'true' : 'false'})`);
        } catch {
            // disconnected; detectAchene() turns it back on after reconnecting
        }
    },

    /**
     * "^^achled(...)" and "^^achscr(page,...)" lines; true if it was one.
     * @param {string} line
     */
    handleAcheneLine(line) {
        if (line.startsWith('^^achled(')) {
            const match = line.match(/^\^\^achled\(([0-9a-f]*)\)/i);
            if (match) this.achenePanel?.setLeds(match[1]);
            return true;
        }
        if (line.startsWith('^^achscr(')) {
            const match = line.match(/^\^\^achscr\(([0-7]),([0-9a-f]{256})\)/i);
            if (match) this.achenePanel?.setScreenPage(Number(match[1]), match[2]);
            return true;
        }
        return false;
    },

    /** @param {string} command */
    sendAchene(command) {
        // anything sent during an upload would end up inside the file
        if (!this.iiiDevice.isConnected || this.uploadInProgress || !this.acheneSupported) return;
        this.executeLua(command).catch(() => {});
    },

    /**
     * Encoder steps go out at most once per frame and encoder, summed, so a
     * fast spin is one line, not dozens (the firmware sums them the same way).
     * @param {number} n @param {number} d
     */
    queueAcheneEnc(n, d) {
        this.acheneEncPending.set(n, (this.acheneEncPending.get(n) || 0) + d);
        if (this.acheneEncFlushRequested) return;
        this.acheneEncFlushRequested = true;
        requestAnimationFrame(() => {
            this.acheneEncFlushRequested = false;
            for (const [enc, sum] of this.acheneEncPending) {
                if (sum) this.sendAchene(`ach_enc(${enc},${sum})`);
            }
            this.acheneEncPending.clear();
        });
    },

    /** @param {number} count keys and pushes held with shift-click */
    updateAcheneHeld(count) {
        const button = this.elements.acheneReleaseBtn;
        if (!button) return;
        button.hidden = count === 0;
        button.textContent = count > 1 ? `release ${count}` : 'release';
    },

    releaseAllAcheneKeys({ send = true } = {}) {
        this.achenePanel?.releaseAll({ send });
    },

    /** @param {string} tint */
    setAcheneTint(tint) {
        this.achenePanel?.setTint(tint);
        try {
            window.localStorage.setItem(TINT_KEY, tint);
        } catch {
            // storage blocked
        }
    },

    /** Performance mode: the panel alone, full screen. */
    async toggleAcheneFullscreen() {
        const body = this.elements.acheneBody;
        if (!body) return;
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await body.requestFullscreen();
            // the keyboard plays the keys while the panel has focus
            body.querySelector('.ach-panel')?.focus({ preventScroll: true });
        } catch {
            // fullscreen refused (iframe, or not from a click)
        }
    },

    /** The device went away: grey the panel and let go of everything. */
    acheneDisconnected() {
        this.achenePanel?.setOffline(true);
        this.acheneEncPending?.clear();
        this.patchDisconnected?.();
        this.updateAcheneStatus();
    }
};
