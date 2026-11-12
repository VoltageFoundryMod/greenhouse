// File explorer contents and the per-file actions.
// Mixed into diiiApp (diii.js); `this` is the app.

import { hasExactFiles, readDeviceFile } from './backup.js';
import { disableStartupScript, onlyStartsScript, setStartupScript } from './init-lua.js';

/** Files scripts save their data in (presets, state); the list hides them unless asked. */
const DATA_PREFIXES = ['pset_', 'data_', 'd_', 'state_'];
const SHOW_DATA_KEY = 'webdiii.showDataFiles';

/** @param {string} name */
const isDataFile = (name) => DATA_PREFIXES.some((prefix) => name.startsWith(prefix));

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
                return 2;
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

        if (this.fileEntries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-list-empty';
            empty.textContent = 'no files';
            this.elements.fileList.appendChild(empty);
            return;
        }

        // data files other scripts save (presets, state): hidden unless asked for
        const showData = this.showDataFiles();
        const allEntries = this.getSortedFileEntries();
        const sortedEntries = showData ? allEntries : allEntries.filter((entry) => !isDataFile(entry.name));
        const hiddenCount = allEntries.length - sortedEntries.length;
        const pinnedCount = sortedEntries.filter(
            (entry) => entry.name === 'lib.lua' || this.isInitFile(entry.name)
        ).length;

        for (let index = 0; index < sortedEntries.length; index += 1) {
            const entry = sortedEntries[index];
            const row = document.createElement('div');
            row.className = 'file-row';

            const main = document.createElement('div');
            main.className = 'file-main';
            const isLibFile = entry.name === 'lib.lua';
            const isInitLuaFile = entry.name === 'init.lua';

            if (!isLibFile && !isInitLuaFile) {
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

            const actions = isInitLuaFile
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
                  : [
                        { label: 'run', fn: () => this.enqueueRunFile(entry.name) },
                        { label: 'edit', fn: () => this.editFile(entry.name) },
                        // a patch saved from the patch drawer opens back there
                        ...(this.patchCaps && (isPatch || (!this.patchFileNames && entry.name.endsWith('.lua')))
                            ? [{ label: 'edit patch', fn: () => this.openPatchFile(entry.name) }]
                            : []),
                        { label: 'rename', fn: () => this.renameFile(entry.name) },
                        { label: 'download', fn: () => this.downloadFile(entry.name) },
                        this.firstBadgeFileNames.has(entry.name)
                            ? { label: 'not first', fn: () => this.clearFirst(entry.name) }
                            : { label: 'first', fn: () => this.configureFirst(entry.name) },
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
            row.appendChild(menuBtn);
            row.appendChild(menu);
            this.elements.fileList.appendChild(row);

            if (pinnedCount > 0 && index === pinnedCount - 1 && index < sortedEntries.length - 1) {
                const separator = document.createElement('div');
                separator.className = 'file-list-separator';
                this.elements.fileList.appendChild(separator);
            }
        }

        const dataCount = showData ? allEntries.filter((entry) => isDataFile(entry.name)).length : hiddenCount;
        if (dataCount > 0) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'file-data-toggle';
            toggle.textContent = showData
                ? `hide ${dataCount} data file${dataCount === 1 ? '' : 's'}`
                : `${dataCount} data file${dataCount === 1 ? '' : 's'} hidden: show`;
            toggle.title = `files scripts save their presets and state in (${DATA_PREFIXES.map((p) => `${p}…`).join(', ')})`;
            toggle.addEventListener('click', () => {
                this.setShowDataFiles(!showData);
                this.renderFileList();
            });
            this.elements.fileList.appendChild(toggle);
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
            const isLua = name.toLowerCase().endsWith('.lua');
            const isInit = name === 'init';
            if (!isLua && !isInit) continue;
            if (seenNames.has(name)) continue;
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
            const content = await this.readRemoteFile(fileName);
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
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
