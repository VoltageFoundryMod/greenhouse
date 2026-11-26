// File explorer contents and the per-file actions.
// Mixed into diiiApp (diii.js); `this` is the app.

import { hasExactFiles, readDeviceFile } from './backup.js';
import { createZip } from './zip.js';
import { disableStartupScript, onlyStartsScript, setStartupScript } from './init-lua.js';
import { TRELLIS_CFG, TRELLIS_PRESET } from './trellis-ui.js';

/** Files scripts save their data in (presets, state); the list hides them unless asked. */
const DATA_PREFIXES = ['pset_', 'data_', 'd_', 'state_'];
const SHOW_DATA_KEY = 'webdiii.showDataFiles';

/** a script's settings file (trellis.cfg): listed with the data files, not run */
const isSettingsFile = (/** @type {string} */ name) => name.toLowerCase().endsWith('.cfg');
/** what the firmware makes or keeps (a cache, a copy, a temp file), whatever its name starts with */
const isKept = (/** @type {string} */ name) => /\.(luac|bak|new|tmp)$/i.test(name) || name.startsWith('.');
/** @param {string} name */
const isDataFile = (name) =>
    !isKept(name) && (DATA_PREFIXES.some((prefix) => name.startsWith(prefix)) || isSettingsFile(name));
const SHOW_OTHER_KEY = 'webdiii.showOtherFiles';
/** a script (or iii's init) */
const isScript = (/** @type {string} */ name) => name.toLowerCase().endsWith('.lua') || name === 'init';
/** neither a script nor a data file: what the firmware keeps (caches, copies), leftovers */
const isOtherFile = (/** @type {string} */ name) => !isScript(name) && !isDataFile(name);

/** what an other file is, for its tooltip */
function otherFileNote(/** @type {string} */ name) {
    if (name.endsWith('.luac'))
        return 'a compiled copy the firmware keeps of a big script, so it loads faster; deleting it is harmless (it’s made again)';
    if (name.endsWith('.bak')) return 'the copy from before a firmware update replaced it';
    if (name.endsWith('.new')) return 'left by a firmware update that didn’t finish';
    if (name === 'bundle.ver')
        return 'which scripts this firmware installed; without it they’re installed again at the next boot';
    if (name === '.upload.tmp') return 'left by an upload that didn’t finish';
    return 'a file no script here runs';
}

export const fileMethods = {
    formatSizeKb(bytes) {
        const kb = (Number(bytes) || 0) / 1024;
        return `${Math.round(kb)}kb`;
    },

    // Two lines: flash free for files, and RAM (what Lua holds, and on Open
    // Grid firmware the C heap that Lua and everything else allocate from).
    updateFileSpaceFooter(bytes) {
        const footer = this.elements.fileSpaceFooter;
        if (!footer) return;

        // (Number(null) is 0, so check for "no value" first)
        if (bytes == null || !Number.isFinite(Number(bytes))) {
            footer.textContent = 'free space: -- kb';
            footer.title = '';
            return;
        }

        const kb = (n) => Math.round(Number(n) / 1024);
        const lines = [`free space: ${kb(bytes)} kb`];
        const mem = this.deviceMemory;
        if (mem?.lua != null) {
            lines.push(
                mem.heapFree != null
                    ? `ram: lua ${kb(mem.lua)} kb · ${kb(mem.heapFree)} of ${kb(mem.heapTotal)} kb free`
                    : `ram: lua ${kb(mem.lua)} kb`
            );
        }
        footer.textContent = lines.join('\n');
        footer.title =
            'flash free for files; RAM used by Lua (including garbage not yet collected)' +
            (mem?.heapFree != null ? ' and C heap free of total' : '') +
            '. Refreshed with the file list; click to refresh.';
    },

    isInitFile(name) {
        return name === 'init.lua' || name === 'init';
    },

    getSortedFileEntries() {
        const entries = [...this.fileEntries];
        return entries.sort((a, b) => {
            const order = (name) => {
                if (this.isInitFile(name)) return 0;
                if (name === 'lib.lua') return 1;
                // scripts, then the data files (presets, settings), then the rest
                if (isOtherFile(name)) return 4;
                return isDataFile(name) ? 3 : 2;
            };

            const rankDiff = order(a.name) - order(b.name);
            if (rankDiff !== 0) return rankDiff;
            return a.name.localeCompare(b.name);
        });
    },

    handleDocumentClick(event) {
        if (!this.openMenuFile) return;
        if (event.target?.closest('.file-row')) return;
        this.openMenuFile = null;
        this.renderFileList();
    },

    // On the virtual grid the files live in this browser: say so, and offer the
    // way to move them to and from a real grid (a backup zip, as for a device).
    virtualFilesNote() {
        const note = document.createElement('div');
        note.className = 'file-list-virtual';
        const text = document.createElement('p');
        text.textContent =
            'virtual grid: these files are kept locally in this browser. Download each file or export them as a zip, then import or restore it on a real grid (device ▾ → restore).';
        note.appendChild(text);
        const actions = document.createElement('div');
        actions.className = 'file-list-virtual-actions';
        for (const [label, title, fn] of [
            ['export', 'download every file as a zip, to restore on a real grid', () => this.backupToZip()],
            ['import', 'upload the files of a backup zip, from a real grid or an export', () => this.restoreFromZip()]
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-data-toggle';
            button.textContent = label;
            button.title = title;
            button.addEventListener('click', fn);
            actions.appendChild(button);
        }
        note.appendChild(actions);
        return note;
    },

    renderFileList() {
        if (!this.elements.fileList) return;

        this.elements.fileList.textContent = '';

        if (!this.iiiDevice.isConnected) {
            const empty = document.createElement('div');
            empty.className = 'file-list-empty';
            empty.textContent = 'connect to load files';
            this.elements.fileList.appendChild(empty);
            return;
        }

        if (this.iiiDevice.isVirtual) this.elements.fileList.appendChild(this.virtualFilesNote());

        if (this.fileEntries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-list-empty';
            empty.textContent = 'no files';
            this.elements.fileList.appendChild(empty);
            return;
        }

        // data files other scripts save (presets, state) and the other files
        // (caches, copies): hidden unless asked for
        const showData = this.showDataFiles();
        const showOther = this.showOtherFiles();
        const allEntries = this.getSortedFileEntries();
        const sortedEntries = allEntries.filter(
            (entry) => (showData || !isDataFile(entry.name)) && (showOther || !isOtherFile(entry.name))
        );
        const group = (/** @type {string} */ name) =>
            name === 'lib.lua' || this.isInitFile(name) ? 0 : isOtherFile(name) ? 3 : isDataFile(name) ? 2 : 1;
        // choosing files to download or delete together
        const picked = this.filePicked;
        if (picked) this.elements.fileList.appendChild(this.fileSelectBar(sortedEntries));

        for (let index = 0; index < sortedEntries.length; index += 1) {
            const entry = sortedEntries[index];
            const row = document.createElement('div');
            row.className = 'file-row';

            const main = document.createElement('div');
            main.className = 'file-main';
            const isLibFile = entry.name === 'lib.lua';
            const isInitLuaFile = entry.name === 'init.lua';
            const isOther = isOtherFile(entry.name);
            if (isOther) row.title = otherFileNote(entry.name);

            if (picked) {
                // lib.lua is iii's own: it can't go
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.className = 'file-pick';
                box.disabled = isLibFile;
                box.checked = picked.has(entry.name);
                box.setAttribute('aria-label', `choose ${entry.name}`);
                const flip = () => {
                    if (isLibFile) return;
                    if (picked.has(entry.name)) picked.delete(entry.name);
                    else picked.add(entry.name);
                    this.renderFileList();
                };
                box.addEventListener('click', (event) => {
                    event.stopPropagation();
                    flip();
                });
                row.classList.add('file-row-pickable');
                row.addEventListener('click', flip);
                main.appendChild(box);
            } else if (!isLibFile && !isInitLuaFile && isScript(entry.name) && !isDataFile(entry.name)) {
                // only scripts run: data files hold values, the others aren't Lua
                const playBtn = document.createElement('button');
                playBtn.className = 'file-play-btn';
                playBtn.type = 'button';
                playBtn.textContent = '▶';
                playBtn.setAttribute('aria-label', `run ${entry.name}`);
                playBtn.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    await this.enqueueRunFile(entry.name);
                });
                main.appendChild(playBtn);
            }

            const label = document.createElement('div');
            label.className = 'file-label';
            label.textContent = Number.isFinite(entry.size)
                ? `${entry.name} (${this.formatSizeKb(entry.size)})`
                : entry.name;

            main.appendChild(label);

            const isPatch = Boolean(this.patchFileNames?.has(entry.name));
            if (isPatch) {
                const patchBadge = document.createElement('span');
                patchBadge.className = 'file-first-pill file-patch-pill';
                patchBadge.textContent = 'patch';
                patchBadge.title = 'made in graft, the patch editor: ⋯ → edit patch opens it there';
                patchBadge.setAttribute('aria-label', `${entry.name} is a patch`);
                main.appendChild(patchBadge);
            }

            if (entry.name !== 'init.lua' && this.firstBadgeFileNames.has(entry.name)) {
                const firstBadge = document.createElement('span');
                firstBadge.className = 'file-first-pill';
                firstBadge.textContent = 'first';
                firstBadge.setAttribute('aria-label', `${entry.name} is configured in init.lua`);
                main.appendChild(firstBadge);
            }

            const menuBtn = document.createElement('button');
            menuBtn.className = 'file-menu-btn';
            menuBtn.type = 'button';
            menuBtn.textContent = '⋯';
            menuBtn.setAttribute('aria-label', `actions for ${entry.name}`);
            menuBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.openMenuFile = this.openMenuFile === entry.name ? null : entry.name;
                this.renderFileList();
            });

            const menu = document.createElement('div');
            menu.className = `file-menu${this.openMenuFile === entry.name ? ' open' : ''}`;

            const actions = isOther
                ? [
                      { label: 'download', fn: () => this.downloadFile(entry.name) },
                      ...(entry.name.endsWith('.luac') ? [] : [{ label: 'read', fn: () => this.showFile(entry.name) }]),
                      { label: 'delete', fn: () => this.deleteFile(entry.name) }
                  ]
                : isInitLuaFile
                  ? [
                        { label: 'edit', fn: () => this.editFile(entry.name) },
                        { label: 'read', fn: () => this.showFile(entry.name) },
                        { label: 'delete', fn: () => this.deleteFile(entry.name) }
                    ]
                  : isLibFile
                    ? [
                          { label: 'download', fn: () => this.downloadFile(entry.name) },
                          { label: 'read', fn: () => this.showFile(entry.name) }
                      ]
                    : isSettingsFile(entry.name)
                      ? [
                            // trellis's settings open as setup's pages
                            ...(entry.name === TRELLIS_CFG
                                ? [{ label: 'edit settings', fn: () => this.openTrellisCfg() }]
                                : []),
                            { label: 'edit', fn: () => this.editFile(entry.name) },
                            { label: 'read', fn: () => this.showFile(entry.name) },
                            { label: 'download', fn: () => this.downloadFile(entry.name) },
                            { label: 'rename', fn: () => this.renameFile(entry.name) },
                            { label: 'delete', fn: () => this.deleteFile(entry.name) }
                        ]
                      : [
                            // a preset of achene's trellis script opens in its form
                            ...(TRELLIS_PRESET.test(entry.name)
                                ? [{ label: 'edit preset', fn: () => this.openTrellisPreset(entry.name) }]
                                : []),
                            ...(isDataFile(entry.name)
                                ? []
                                : [{ label: 'run', fn: () => this.enqueueRunFile(entry.name) }]),
                            { label: 'edit', fn: () => this.editFile(entry.name) },
                            // a patch saved from the patch drawer opens back there
                            ...(this.patchCaps && (isPatch || (!this.patchFileNames && entry.name.endsWith('.lua')))
                                ? [{ label: 'edit patch', fn: () => this.openPatchFile(entry.name) }]
                                : []),
                            { label: 'rename', fn: () => this.renameFile(entry.name) },
                            { label: 'download', fn: () => this.downloadFile(entry.name) },
                            ...(isDataFile(entry.name)
                                ? []
                                : [
                                      this.firstBadgeFileNames.has(entry.name)
                                          ? { label: 'not first', fn: () => this.clearFirst(entry.name) }
                                          : { label: 'first', fn: () => this.configureFirst(entry.name) }
                                  ]),
                            { label: 'read', fn: () => this.showFile(entry.name) },
                            { label: 'delete', fn: () => this.deleteFile(entry.name) }
                        ];

            for (const action of actions) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'file-menu-item';
                item.textContent = action.label;
                item.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    this.openMenuFile = null;
                    this.renderFileList();
                    await action.fn();
                });
                menu.appendChild(item);
            }

            row.appendChild(main);
            if (!picked) {
                row.appendChild(menuBtn);
                row.appendChild(menu);
            }
            this.elements.fileList.appendChild(row);

            // a line between the groups: init and lib, scripts, data, others
            const next = sortedEntries[index + 1];
            if (next && group(next.name) !== group(entry.name)) {
                const separator = document.createElement('div');
                separator.className = 'file-list-separator';
                this.elements.fileList.appendChild(separator);
            }
        }

        const footer = (/** @type {string} */ text, /** @type {string} */ title, /** @type {() => void} */ fn) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-data-toggle';
            button.textContent = text;
            button.title = title;
            button.addEventListener('click', fn);
            this.elements.fileList.appendChild(button);
        };
        const plural = (/** @type {number} */ n, /** @type {string} */ what) =>
            `${n} ${what} file${n === 1 ? '' : 's'}`;
        const dataCount = allEntries.filter((entry) => isDataFile(entry.name)).length;
        if (dataCount > 0)
            footer(
                showData ? `hide ${plural(dataCount, 'data')}` : `${plural(dataCount, 'data')} hidden: show`,
                `files scripts save their presets and settings in (${DATA_PREFIXES.map((p) => `${p}…`).join(', ')}, .cfg)`,
                () => {
                    this.setShowDataFiles(!showData);
                    this.renderFileList();
                }
            );
        const otherCount = allEntries.filter((entry) => isOtherFile(entry.name)).length;
        if (otherCount > 0)
            footer(
                showOther ? `hide ${plural(otherCount, 'other')}` : `${plural(otherCount, 'other')} hidden: show`,
                'what the firmware keeps (compiled caches .luac, copies from before an update .bak) and leftovers',
                () => {
                    this.setShowOtherFiles(!showOther);
                    this.renderFileList();
                }
            );
        if (!picked)
            footer('select', 'choose files to download or delete together', () => {
                this.filePicked = new Set();
                this.openMenuFile = null;
                this.renderFileList();
            });

        // achene's trellis: a preset started here, in its editor
        if (allEntries.some((entry) => entry.name === 'trellis.lua')) {
            const fresh = document.createElement('button');
            fresh.type = 'button';
            fresh.className = 'file-data-toggle';
            fresh.textContent = 'new trellis preset';
            fresh.title = "an empty preset in trellis's editor, as the first number with no preset yet";
            fresh.addEventListener('click', () => this.trellisNew());
            this.elements.fileList.appendChild(fresh);
        }
    },

    /** Whether the file list shows data files (remembered in this browser). */
    showDataFiles() {
        try {
            return localStorage.getItem(SHOW_DATA_KEY) === '1';
        } catch {
            return false;
        }
    },

    /** Whether the file list shows the other files (caches, copies; remembered in this browser). */
    showOtherFiles() {
        try {
            return localStorage.getItem(SHOW_OTHER_KEY) === '1';
        } catch {
            return false;
        }
    },

    /** @param {boolean} on */
    setShowOtherFiles(on) {
        try {
            localStorage.setItem(SHOW_OTHER_KEY, on ? '1' : '0');
        } catch {
            // private window: it lasts until the next render only
        }
    },

    /** the bar over the list while choosing files: how many, all, download, delete, done */
    fileSelectBar(/** @type {{ name: string }[]} */ shown) {
        const picked = this.filePicked;
        const bar = document.createElement('div');
        bar.className = 'file-select-bar';
        const count = document.createElement('span');
        count.textContent = `${picked.size} chosen`;
        bar.appendChild(count);
        const names = () => [...picked].sort();
        const choosable = shown.map((e) => e.name).filter((n) => n !== 'lib.lua');
        for (const [label, title, fn, off] of /** @type {[string, string, () => void, boolean][]} */ ([
            [
                'all',
                'choose every file shown (again: none)',
                () => {
                    const every = choosable.every((n) => picked.has(n));
                    for (const n of choosable) every ? picked.delete(n) : picked.add(n);
                    this.renderFileList();
                },
                false
            ],
            ['download', 'one file as it is, several as a zip', () => this.downloadFiles(names()), picked.size === 0],
            ['delete', 'delete the chosen files from the device', () => this.deleteFiles(names()), picked.size === 0],
            [
                'done',
                'back to the list',
                () => {
                    this.filePicked = null;
                    this.renderFileList();
                },
                false
            ]
        ])) {
            // prettier-ignore
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-data-toggle';
            button.textContent = label;
            button.title = title;
            button.disabled = off;
            button.addEventListener('click', fn);
            bar.appendChild(button);
        }
        return bar;
    },

    /** files from the device, as they are (binary too) */
    async readDeviceFiles(/** @type {string[]} */ names) {
        const api = this.backupApi();
        const exact = await hasExactFiles(api);
        const out = [];
        for (const name of names) out.push({ name, data: await readDeviceFile(api, name, exact) });
        return out;
    },

    /** several files: one as it is, more as a zip */
    async downloadFiles(/** @type {string[]} */ names) {
        if (names.length === 1) return this.downloadFile(names[0]);
        try {
            this.outputLine(`reading ${names.length} files...`);
            const zip = createZip(await this.readDeviceFiles(names));
            const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
            const device = String(this.connectedDeviceLabel || 'iii').replace(/[^a-z0-9_-]+/gi, '-');
            this.saveBlob(new Blob([zip], { type: 'application/zip' }), `${device}-files-${stamp}.zip`);
            this.outputLine(`Downloaded ${names.length} files as a zip`);
        } catch (error) {
            this.outputLine(`Download error: ${error.message}`);
        }
    },

    /** several files deleted, after one question naming them */
    async deleteFiles(/** @type {string[]} */ names) {
        if (names.length === 0) return;
        const list = names.slice(0, 12).join('\n') + (names.length > 12 ? `\n…and ${names.length - 12} more` : '');
        if (!window.confirm(`Delete ${names.length} file${names.length === 1 ? '' : 's'}?\n\n${list}`)) return;
        try {
            for (const name of names) await this.executeLuaCapture(`fs_remove_file(${this.luaQuote(name)})`);
            this.outputLine(`Deleted ${names.join(', ')}`);
        } catch (error) {
            this.outputLine(`Delete error: ${error.message}`);
        }
        this.filePicked = null;
        await this.requestFileListRefresh();
    },

    /** a download of a blob, as a file named `name` */
    saveBlob(/** @type {Blob} */ blob, /** @type {string} */ name) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    /** @param {boolean} on */
    setShowDataFiles(on) {
        try {
            localStorage.setItem(SHOW_DATA_KEY, on ? '1' : '0');
        } catch {
            // private window: it lasts until the next render only
        }
    },

    async refreshFileList() {
        if (!this.iiiDevice.isConnected) {
            this.fileEntries = [];
            this.firstBadgeFileNames = new Set();
            this.patchFileSeen = null; // the next device has its own files
            this.fileFreeSpaceBytes = null;
            this.updateFileSpaceFooter(null);
            this.renderFileList();
            return;
        }

        try {
            const lsLines = await this.executeLuaCapture(
                'for _, __name in ipairs(fs_list_files()) do local __size = fs_file_size(__name) or 0; print("__webdiii_file\\t" .. __name .. "\\t" .. tostring(__size)) end'
            );
            // free flash, Lua's memory and (parterre, achene) the C heap, in one request
            const memLines = await this.executeLuaCapture(
                'do local f, t if gh_mem then local a, _, _, _, b = gh_mem(true) f, t = a, b end print(fs_free_space(), math.floor(collectgarbage("count") * 1024), f or "", t or "") end'
            );

            const entries = this.parseFileEntriesFromLs(lsLines);
            this.fileFreeSpaceBytes = this.parseMemoryFooterFromMem(memLines);
            this.deviceMemory = this.parseDeviceMemory(memLines);

            this.fileEntries = entries;

            try {
                await this.refreshPatchFileNames(entries);
            } catch {
                this.patchFileNames = null;
            }
            try {
                await this.refreshFirstBadgeFileNames(entries);
            } catch {
                this.firstBadgeFileNames = new Set();
            }

            this.updateFileSpaceFooter(this.fileFreeSpaceBytes);
            this.renderFileList();
        } catch (error) {
            this.firstBadgeFileNames = new Set();
            this.fileFreeSpaceBytes = null;
            this.updateFileSpaceFooter(null);
            this.outputLine(`File list error: ${error.message}`);
        }
    },

    requestFileListRefresh() {
        this.fileRefreshRequested = true;

        this.fileRefreshQueue = this.fileRefreshQueue
            .catch(() => {})
            .then(async () => {
                if (this.fileRefreshInFlight || !this.fileRefreshRequested) {
                    return;
                }

                this.fileRefreshRequested = false;
                this.fileRefreshInFlight = true;

                try {
                    await this.refreshFileList();
                } finally {
                    this.fileRefreshInFlight = false;
                }

                if (this.fileRefreshRequested) {
                    await this.requestFileListRefresh();
                }
            });

        return this.fileRefreshQueue;
    },

    getFirstRunFileTargetFromInit(initContent) {
        const content = String(initContent || '');
        const withoutBlockComments = content.replace(/--\[\[[\s\S]*?\]\]/g, '');
        const withoutLineComments = withoutBlockComments.replace(/--.*$/gm, '');
        const match = withoutLineComments.match(/fs_run_file\s*\(\s*(['"])([^'"]+)\1\s*\)/);
        return match?.[2]?.trim() || '';
    },

    parseFileEntriesFromLs(lines) {
        const entries = [];
        const seenNames = new Set();

        for (const rawLine of lines) {
            const line = String(rawLine || '').trim();

            if (!line.startsWith('__webdiii_file\t')) continue;

            const parts = line.split('\t');
            if (parts.length < 3) continue;

            const name = String(parts[1] || '').trim();
            if (!name || seenNames.has(name)) continue;
            seenNames.add(name);

            const parsedSize = Number.parseInt(parts[2], 10);
            entries.push({
                name,
                size: Number.isFinite(parsedSize) ? parsedSize : null
            });
        }

        return entries;
    },

    parseMemoryFooterFromMem(lines) {
        const bytes = Number.parseInt(lines[0], 10);
        return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
    },

    // iii's print() puts each argument on its own line (not tab-separated like
    // standard Lua): flash, lua, heapFree, heapTotal (bytes). Without gh_mem the
    // heap values are "" and their empty lines don't arrive.
    parseDeviceMemory(lines) {
        const [, lua, heapFree, heapTotal] = lines.map((line) => Number.parseInt(line, 10));
        const valid = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
        const free = valid(heapFree);
        const total = valid(heapTotal);
        return { lua: valid(lua), heapFree: free != null && total ? free : null, heapTotal: total };
    },

    /**
     * Scripts saved from the patch drawer start with "-- graft patch:" ("-- diii
     * patch:" before the rename); ask
     * the device which do. iii can only read a file whole, into one string,
     * and on a grid running a patch a big read can run Lua out of memory (and
     * the device into its watchdog). So: never the runtime's or iii's own
     * files, one file per request (collected right after), and each file
     * only once per name and size: what was seen is remembered.
     * @param {{ name: string, size?: number }[]} entries
     */
    async refreshPatchFileNames(entries) {
        const seen = (this.patchFileSeen ??= new Map()); // "name\tsize" -> is a patch
        const skip = new Set([
            'init.lua',
            'lib.lua',
            'blocks_run.lua',
            'blocks.lua',
            'blocks_achene.lua',
            'blocks_grid.lua'
        ]);
        const names = new Set();
        for (const { name, size = 0 } of entries) {
            if (!name.endsWith('.lua') || skip.has(name) || isDataFile(name) || size >= 32768) continue;
            const key = `${name}\t${size}`;
            if (!seen.has(key)) {
                const lines = await this.executeLuaCapture(
                    `do local s = fs_read_file(${JSON.stringify(name)}) print(s and s:find("^%-%- %a+ patch:") and "__webdiii_patch" or "-") s = nil collectgarbage() end`
                );
                seen.set(
                    key,
                    lines.some((line) => String(line).trim() === '__webdiii_patch')
                );
            }
            if (seen.get(key)) names.add(name);
        }
        this.patchFileNames = names;
    },

    async refreshFirstBadgeFileNames(entries) {
        const hasInitLua = entries.some((entry) => entry.name === 'init.lua');
        if (!hasInitLua) {
            this.firstBadgeFileNames = new Set();
            return;
        }

        const initContent = await this.readRemoteFile('init.lua');
        const targetName = this.getFirstRunFileTargetFromInit(initContent);

        if (!targetName) {
            this.firstBadgeFileNames = new Set();
            return;
        }

        const hasMatchingFile = entries.some((entry) => entry.name === targetName);
        this.firstBadgeFileNames = hasMatchingFile ? new Set([targetName]) : new Set();
    },

    // A file's text, exactly (blank lines included, any size): gh_dump_file on
    // parterre firmware, read in pieces elsewhere; without the '\0' uploads end with.
    async readRemoteFile(fileName) {
        const api = this.backupApi();
        const data = await readDeviceFile(api, fileName, await hasExactFiles(api));
        return new TextDecoder().decode(data).replace(/\0+$/, '');
    },

    // init.lua's text, or null when there is none
    async readInitLua() {
        if (!this.fileEntries.some((entry) => entry.name === 'init.lua')) return null;
        const api = this.backupApi();
        this.initExactFiles = await hasExactFiles(api);
        const data = await readDeviceFile(api, 'init.lua', this.initExactFiles);
        return new TextDecoder().decode(data).replace(/\0+$/, '');
    },

    async writeInitLua(text) {
        if (!(await this.uploadChecked('init.lua', text, { keepOld: Boolean(this.initExactFiles) }))) {
            throw new Error('init.lua not written; it is unchanged');
        }
    },

    // first() replaces init.lua with one fs_run_file() line; used only when
    // init.lua has nothing else, otherwise just its startup call changes.
    async configureFirst(fileName) {
        try {
            const init = await this.readInitLua();
            if (init === null || onlyStartsScript(init)) {
                await this.executeLuaCapture(`first(${this.luaQuote(fileName)})`);
            } else {
                await this.writeInitLua(setStartupScript(init, fileName));
                this.outputLine('init.lua: changed only its startup line');
            }
            this.outputLine(`${fileName} will now run at startup`);
        } catch (error) {
            this.outputLine(`First error: ${error.message}`);
        }
        await this.requestFileListRefresh();
    },

    // Disables just the call that starts fileName; init.lua goes away only
    // when that call was all it held.
    async clearFirst(fileName) {
        if (!window.confirm(`Stop running ${fileName} at startup?`)) return;
        try {
            const init = (await this.readInitLua()) ?? '';
            if (onlyStartsScript(init)) {
                await this.executeLuaCapture(`fs_remove_file('init.lua')`);
                this.outputLine('init.lua only started this script; removed it');
            } else {
                const { text, changed } = disableStartupScript(init, fileName);
                if (!changed) throw new Error(`no fs_run_file('${fileName}') call found in init.lua`);
                await this.writeInitLua(text);
                this.outputLine('init.lua: commented out its startup line; the rest is unchanged');
            }
            this.outputLine(`${fileName} no longer runs at startup`);
        } catch (error) {
            this.outputLine(`First error: ${error.message}`);
        }
        await this.requestFileListRefresh();
    },

    async downloadFile(fileName) {
        try {
            // byte for byte: a compiled .luac is binary
            const [{ data }] = await this.readDeviceFiles([fileName]);
            const type =
                isScript(fileName) || isDataFile(fileName) ? 'text/plain;charset=utf-8' : 'application/octet-stream';
            this.saveBlob(new Blob([data], { type }), fileName);
            this.outputLine(`Downloaded ${fileName}`);
        } catch (error) {
            this.outputLine(`Download error: ${error.message}`);
        }
    },

    async showFile(fileName) {
        try {
            if (!this.elements.output) return;

            const topSpacerLine = document.createElement('span');
            topSpacerLine.textContent = '\n';
            this.elements.output.appendChild(topSpacerLine);

            const headerLine = document.createElement('span');
            headerLine.textContent = `${fileName} contents:\n\n`;
            this.elements.output.appendChild(headerLine);

            const text = await this.readRemoteFile(fileName);
            for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
                this.outputLine(line, { autoScroll: false });
            }

            this.outputText('\n', { autoScroll: false });

            this.elements.output.scrollTop = topSpacerLine.offsetTop;
        } catch (error) {
            this.outputLine(`Show error: ${error.message}`);
        }
    },

    async enqueueRunFile(fileName) {
        const task = async () => {
            await this.runFile(fileName);
        };

        this.fileRunQueue = this.fileRunQueue.catch(() => {}).then(task);

        return this.fileRunQueue;
    },

    async runFile(fileName) {
        this.outputLine(`running ${fileName}...`);
        await this.cleanLuaState();
        await this.delay(500);
        await this.executeLua(`fs_run_file(${this.luaQuote(fileName)})`);
    },

    /**
     * Stops whatever script runs (its metros too) and starts a Lua state
     * with only lib.lua in it and the LEDs dark, as a boot with no first
     * script leaves it: iii's ^^c, which leaves lib.lua to us.
     */
    async cleanLuaState() {
        this.queueSuppressedOutputLine('-- re-init with no script', 8000);
        this.queueSuppressedOutputLine('-- init: skip script', 8000);
        this.queueSuppressedOutputLine('-- lua lib', 8000);
        await this.iiiDevice.writeLine('^^c');
        await this.delay(500);
        await this.executeLua(`fs_run_file("lib.lua")`);
        // the LEDs and screen keep what the old script drew (a boot clears
        // them): parterre's grid, achene's keys and OLED, when there
        await this.executeLua(
            'if grid_led_all then grid_led_all(0) grid_refresh() end ' +
                'if key_led_all then key_led_all(0, 0, 0) key_led_refresh() end ' +
                'if screen_clear then screen_clear() screen_refresh() end'
        );
    },

    // gh_rename_file() (parterre, achene) renames in one step; elsewhere the
    // file is copied (compile-checked) and the old one deleted. A "first"
    // script stays first, and an open editor follows the new name.
    async renameFile(fileName) {
        const newName = this.normalizeScriptName(window.prompt(`Rename ${fileName} to:`, fileName));
        if (!newName || newName === fileName) return;
        if (newName === 'init.lua' || newName === 'lib.lua') {
            this.outputLine(`Rename error: ${newName} is reserved`);
            return;
        }
        if (this.fileEntries.some((entry) => entry.name === newName)) {
            if (!window.confirm(`${newName} exists. Replace it?`)) return;
        }

        try {
            const quoted = `${this.luaQuote(fileName)}, ${this.luaQuote(newName)}`;
            const probe = await this.executeLuaCapture('print(gh_rename_file ~= nil)');
            if (probe.some((line) => line.trim() === 'true')) {
                const result = await this.executeLuaCapture(`print(gh_rename_file(${quoted}))`);
                if (!result.some((line) => line.trim() === 'true')) {
                    throw new Error(result.join(' ').trim() || 'no answer');
                }
            } else {
                const api = this.backupApi();
                const data = await readDeviceFile(api, fileName, await hasExactFiles(api));
                const text = new TextDecoder().decode(data).replace(/\0+$/, '');
                if (!(await this.uploadChecked(newName, text))) {
                    throw new Error(`${newName} not written; ${fileName} kept`);
                }
                await this.executeLuaCapture(`fs_remove_file(${this.luaQuote(fileName)})`);
            }

            if (this.firstBadgeFileNames.has(fileName)) {
                await this.executeLuaCapture(`first(${this.luaQuote(newName)})`);
            }
            const editor = this.scriptEditor;
            if (editor?.name === fileName) {
                editor.name = newName;
                this.updateEditorTitle(editor.dirty);
            }
            this.outputLine(`renamed ${fileName} to ${newName}`);
        } catch (error) {
            this.outputLine(`Rename error: ${error.message}`);
        }
        await this.requestFileListRefresh();
    },

    async deleteFile(fileName) {
        if (!window.confirm(`Delete ${fileName}?`)) {
            return;
        }

        try {
            await this.executeLuaCapture(`fs_remove_file(${this.luaQuote(fileName)})`);
            this.outputLine(`Deleted ${fileName}`);
            await this.requestFileListRefresh();
        } catch (error) {
            this.outputLine(`Delete error: ${error.message}`);
        }
    }
};
