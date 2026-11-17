// The virtual grid: a 16×8 iii grid that runs in the browser, so scripts and
// graft patches can be tried without a device. It stands in for the serial
// connection (VirtualConnection below has iiiConnection's interface), so the
// rest of greenhouse talks to it exactly as to a parterre: Lua lines and ^^
// commands in, printed lines and ^^grid / ^^midi events out.
//
// What runs here is iii's own lib.lua (vendor/iii-lib.lua, monome/iii v1.1.2)
// in Fengari, Lua 5.3 in JavaScript (vendor/fengari.js). VirtualIii provides
// the C layer under it, after iii's repl.c, vm.c and metro.c, plus the grid
// and greenhouse functions of parterre's main.c (grid_*, gh_*): change them
// together. Where the two can't match, docs/VIRTUAL-GRID.md says so.
//
// Thanks to Jon Waterschoot's diii-neotrellis-emulator
// (https://github.com/jonwaterschoot/diii-neotrellis-emulator, GPL-3.0),
// which showed that iii scripts run well in Fengari. Several of its
// solutions are used here: the collectgarbage stand-in (Fengari has no
// lua_gc), popping the error after a failed callback so a broken metro
// doesn't fill the stack, integers for event arguments so `x .. ""` gives
// "1", and metros timed against a running target so they don't drift.

/** iii's line buffer (repl.c): a longer line is lost on the device */
export const LINE_BUFFER_SIZE = 512;
/** parterre streams uploads to a file, so only its flash limits them; this is a sanity cap */
const UPLOAD_LIMIT = 512 * 1024;
/** iii has 12 metros (metro.h) */
const METRO_COUNT = 12;
/** parterre sends a ^^grid frame at most this often (main.c) */
const MIRROR_INTERVAL_MS = 33;
/** parterre's ^^midic summary, at most twice a second (midi_monitor.c) */
const SUMMARY_INTERVAL_MS = 500;
/** what fs_free_space starts from: about what a parterre has */
const FS_CAPACITY = 1024 * 1024;
/** Lua that runs this long without returning is stopped (a device would hang) */
const RUN_LIMIT_MS = 3000;

export const VIRTUAL_VERSION = 'virtual';
export const VIRTUAL_FS_KEY = 'webdiii.virtualFs';

const III_VERSION = 'v1.1.2';

const III_HELP = `
midi
  event_midi(byte1, byte2, byte3)
  midi_out(msg)
  midi_note_on(note, vel, ch)
  midi_note_off(note, vel, ch)
  midi_cc(cc, val, ch)
metro
  m = metro.init(callback, time_sec, count_optional)
  m:start(time_optional, count_optional)
  m:stop()
  m.time = 0.1
  metro.free(m.id)
  metro.free_all()
slew
  id = slew.new(callback, start_val, end_val, time_sec)
  slew.to(id, end_val, time_optional)
  slew.freeze(id)
  slew.allfreeze()
  slew.stop(id)
  slew.allstop()
pset
  pset_init(name)
  pset_write(index, table)
  table = pset_read(index)
  pset_delete(index)
utils
  dostring(lua_command)
  get_time()
  ps(formatted_string, ...)
  pt(table_to_print)
  clamp(n, min, max)
  round(n, quant)
  linlin(n, slo, shi, dlo, dhi)
  wrap(n, min, max)
system
  device_id()
  device_version()
  ls()
  cat(file)
  rm(file)
  mem()
  gc()
  require(file)
  first(file)
`;

const DEVICE_HELP = `grid (virtual, in greenhouse)
  event_grid(x,y,z)
  grid_led_all(z,rel)
  grid_led(x,y,z,rel)
  grid_led_get(x,y)
  grid_intensity(z)
  grid_refresh()
  grid_size_x()
  grid_size_y()
greenhouse
  gh_mirror(on)   stream LED frames as ^^grid(...)
  gh_key(x,y,z)   press a key
  gh_dump_file(f) print a file as base64, then size and CRC-32
  gh_rename_file(old, new)  rename a file (replaces new)
  gh_board()      board this firmware is built for
  gh_midi_monitor(on) report MIDI in/out as ^^midi(...)
  gh_midi_counts(on)  MIDI counts and clock tempo as ^^midic(...)
  gh_mem(quiet)   memory (made-up numbers here)
`;

const HEX = '0123456789abcdef';
const hex2 = (/** @type {number} */ b) => HEX[(b >> 4) & 15] + HEX[b & 15];

/** C's printf("%f") */
function formatFloat(/** @type {number} */ d) {
    if (Number.isNaN(d)) return 'nan';
    if (d === Infinity) return 'inf';
    if (d === -Infinity) return '-inf';
    return (Object.is(d, -0) ? '-' : '') + d.toFixed(6);
}

function crc32(/** @type {Uint8Array} */ bytes) {
    let crc = ~0;
    for (const b of bytes) {
        crc ^= b;
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

function base64(/** @type {Uint8Array} */ bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

/**
 * Files kept in localStorage (or another Storage), by name, as text.
 */
class VirtualFs {
    /** @param {Storage | null} storage */
    constructor(storage) {
        this.storage = storage;
        /** @type {Map<string, string>} */
        this.files = new Map();
        try {
            const saved = JSON.parse(storage?.getItem(VIRTUAL_FS_KEY) || '{}');
            for (const [name, text] of Object.entries(saved)) {
                if (typeof text === 'string') this.files.set(name, text);
            }
        } catch {
            // nothing saved, or storage blocked: start empty
        }
    }

    save() {
        try {
            this.storage?.setItem(VIRTUAL_FS_KEY, JSON.stringify(Object.fromEntries(this.files)));
            return true;
        } catch {
            return false; // full, or blocked
        }
    }

    /** @param {string} name */
    read(name) {
        return this.files.get(name);
    }

    /** @param {string} name @param {string} text */
    write(name, text) {
        const old = this.files.get(name);
        this.files.set(name, text);
        if (this.save()) return true;
        if (old === undefined) this.files.delete(name);
        else this.files.set(name, old);
        return false;
    }

    /** @param {string} name */
    remove(name) {
        const had = this.files.delete(name);
        if (had) this.save();
        return had;
    }

    /** @param {string} from @param {string} to */
    rename(from, to) {
        const text = this.files.get(from);
        if (text === undefined) return false;
        this.files.delete(from);
        this.files.set(to, text);
        this.save();
        return true;
    }

    list() {
        return [...this.files.keys()].sort();
    }

    /** @param {string} name */
    size(name) {
        const text = this.files.get(name);
        return text === undefined ? undefined : new TextEncoder().encode(text).length;
    }

    freeSpace() {
        let used = 0;
        for (const name of this.files.keys()) used += this.size(name) || 0;
        return Math.max(0, FS_CAPACITY - used);
    }

    reformat() {
        this.files.clear();
        this.save();
    }
}

/**
 * One of iii's metros (metro.c): fires every `delay` seconds, `count` times
 * (or forever with -1), and hands vm the stage the way metro_task does.
 */
class Metro {
    /** @param {number} index 0-based @param {VirtualIii} vm */
    constructor(index, vm) {
        this.index = index;
        this.vm = vm;
        this.running = false;
        this.delay = 1;
        this.count = -1;
        this.stages = -1;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this.timer = null;
        this.next = 0;
    }

    /** @param {number} s seconds; 0 or less stops @param {number} count */
    set(s, count) {
        if (s > 0) {
            if (this.running) {
                // as on the device: a running metro only changes its period
                this.delay = s;
                return;
            }
            this.delay = s;
            this.count = count;
            this.stages = count;
            this.running = true;
            this.next = this.vm.now() + s * 1000;
            this.schedule();
        } else {
            this.stop();
        }
    }

    stop() {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    schedule() {
        const wait = Math.max(0, this.next - this.vm.now());
        this.timer = setTimeout(() => this.tick(), wait);
    }

    tick() {
        this.timer = null;
        if (!this.running) return;
        let more = true;
        if (this.count > 0) {
            this.count--;
            more = this.count > 0;
        }
        let stage = this.count;
        if (stage === 0) this.running = false;
        if (stage >= 0) stage = this.stages - stage;
        this.vm.handleMetro(this.index, stage);
        if (!more || !this.running) {
            this.running = false;
            return;
        }
        // a running target, so ticks don't drift; after a stall (a background
        // tab, a slow callback) start again from now instead of catching up
        const now = this.vm.now();
        this.next += this.delay * 1000;
        if (this.next < now - 250) this.next = now + this.delay * 1000;
        this.schedule();
    }
}

/**
 * @typedef {object} VirtualIiiOptions
 * @property {any} fengari         { lua, lauxlib, lualib, to_luastring, to_jsstring }
 * @property {string} libLua       iii's lib.lua
 * @property {(text: string) => void} output  what the device prints (lines end in \r\n)
 * @property {Storage | null} [storage]  where files are kept (default: none)
 * @property {{ x: number, y: number }} [size]
 * @property {() => number} [now]  milliseconds
 */

/**
 * iii's firmware, for a grid, minus the hardware.
 */
export class VirtualIii {
    /** @param {VirtualIiiOptions} options */
    constructor({ fengari, libLua, output, storage = null, size = { x: 16, y: 8 }, now }) {
        this.f = fengari;
        this.libLua = libLua;
        this.output = output;
        this.now = now || (() => performance.now());
        this.bootTime = this.now();
        this.fs = new VirtualFs(storage);
        this.size = size;
        this.L = null;
        this.muted = false;

        // repl.c
        /** @type {number[]} */
        this.lineBytes = [];
        this.lineTooLong = false;
        this.inRxScript = false;
        this.scriptBuf = '';
        this.filename = 'init.lua';

        // the grid: what scripts draw (back) and what the LEDs show (front)
        const n = size.x * size.y;
        this.back = new Uint8Array(n);
        this.front = new Uint8Array(n);
        this.intensity = 15;
        this.changed = false;
        this.mirrorOn = false;
        this.lastFrameAt = -Infinity;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this.mirrorTimer = null;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this.keyTimer = null;
        /** @type {{ x: number, y: number, z: number }[]} */
        this.keyQueue = [];

        // MIDI (midi_monitor.c)
        this.monitorOn = false;
        this.countsOn = false;
        this.countIn = 0;
        this.countOut = 0;
        /** @type {ReturnType<typeof setInterval> | null} */
        this.countsTimer = null;
        this.sentCounts = '';
        /** @type {((d1: number, d2: number, d3: number) => void) | null} */
        this.onMidiOut = null;

        this.metros = Array.from({ length: METRO_COUNT }, (_, i) => new Metro(i, this));
        this.runStart = 0;
        this.runDepth = 0;
    }

    // ── serial out ─────────────────────────────────────────────────────

    /** @param {string} text */
    serial(text) {
        if (!this.muted) this.output(text);
    }

    // ── power ──────────────────────────────────────────────────────────

    /** As at power-up: lib.lua and init.lua run, before anyone listens. */
    boot() {
        this.muted = true;
        try {
            this.vmInit(true);
        } finally {
            this.muted = false;
        }
    }

    shutdown() {
        this.vmDeinit();
        this.setMirror(false);
        this.setCounts(false);
        if (this.keyTimer) clearTimeout(this.keyTimer);
        this.keyTimer = null;
        this.keyQueue = [];
    }

    // ── repl.c ─────────────────────────────────────────────────────────

    /** Bytes from the host, as repl_handle_bytes gets them. @param {string} text */
    receive(text) {
        for (const b of new TextEncoder().encode(text)) {
            if (b === 10 || b === 13) {
                const line = new TextDecoder().decode(new Uint8Array(this.lineBytes));
                const tooLong = this.lineTooLong;
                this.lineBytes = [];
                this.lineTooLong = false;
                if (tooLong) {
                    // the device loses it too (it starts over at 512 and runs
                    // what follows); say so instead of running a fragment
                    this.serial(
                        `-- virtual grid: a line over ${LINE_BUFFER_SIZE} bytes was dropped, as iii's line buffer would\r\n`
                    );
                    continue;
                }
                this.handleLine(line);
            } else if (this.lineBytes.length < LINE_BUFFER_SIZE) {
                this.lineBytes.push(b);
            } else {
                this.lineTooLong = true;
            }
        }
    }

    /** @param {string} line */
    handleLine(line) {
        if (line.startsWith('^^')) {
            this.handleCommand(line.charAt(2).toUpperCase());
        } else if (this.inRxScript) {
            if (this.scriptBuf.length + line.length < UPLOAD_LIMIT) {
                this.scriptBuf += `${line}\n`;
            } else {
                this.serial('-- script buffer full!\r\n');
                this.resetScriptRx();
            }
        } else {
            this.runBuffer(line);
        }
    }

    resetScriptRx() {
        this.inRxScript = false;
        this.scriptBuf = '';
    }

    /** @param {string} cmd */
    handleCommand(cmd) {
        switch (cmd) {
            case 'C':
                this.serial('-- re-init with no script\r\n');
                this.vmDeinit();
                this.vmInit(false);
                break;
            case 'I':
                this.serial('-- re-init\r\n');
                this.vmDeinit();
                this.vmInit(true);
                break;
            case 'B':
                this.serial('-- launching bootloader...\r\n');
                this.serial('-- virtual grid: there is no bootloader here\r\n');
                break;
            case 'R':
                this.reset();
                break;
            case 'S':
                this.inRxScript = true;
                this.scriptBuf = '';
                this.serial('-- receiving data\r\n');
                break;
            case 'F':
                if (this.inRxScript) {
                    const name = this.scriptBuf.replace(/[\r\n]+$/, '');
                    if (!name) {
                        this.serial('-- no data received\r\n');
                    } else {
                        this.serial(`-- set filename: ${name}\r\n`);
                        if (name.includes('/') || name.length > 255) this.serial('-- bad filename!\r\n');
                        else this.filename = name;
                    }
                    this.resetScriptRx();
                } else {
                    this.serial('-- file name end without start');
                }
                break;
            case 'W':
                if (this.inRxScript) {
                    this.serial('-- write file\r\n');
                    if (!this.scriptBuf) {
                        this.serial('-- no data received\r\n');
                    } else if (this.testScript(this.scriptBuf, this.filename)) {
                        if (this.fs.write(this.filename, this.scriptBuf)) {
                            this.serial(`-- file written: ${this.filename}\r\n`);
                        } else {
                            this.serial('-- file write fail!\r\n');
                        }
                    } else {
                        this.serial('-- compilation fail!\r\n');
                    }
                    this.resetScriptRx();
                } else {
                    this.serial('-- file write end without start');
                }
                break;
            case 'G':
                this.serial(`-- filename: ${this.filename}\r\n`);
                break;
            case 'P': {
                const text = this.fs.read(this.filename);
                if (text === undefined) this.serial('-- no file\r\n');
                else if (!text) this.serial('-- empty file\r\n');
                else this.serial(text);
                break;
            }
            default:
                this.serial('-- unknown command\r\n');
        }
    }

    reset() {
        this.serial('-- reset device...\r\n');
        this.shutdown();
        this.back.fill(0);
        this.front.fill(0);
        this.boot();
    }

    // ── vm.c ───────────────────────────────────────────────────────────

    /** @param {boolean} runScript */
    vmInit(runScript) {
        const { lua, lauxlib, lualib } = this.f;
        const L = lauxlib.luaL_newstate();
        this.L = L;
        lualib.luaL_openlibs(L);
        // a JS error inside one of the functions below becomes a Lua error
        lua.lua_atnativeerror(L, (/** @type {any} */ l) => {
            const e = lua.lua_touserdata(l, -1);
            lua.lua_pushstring(l, this.str(String(e?.message || e)));
            return 1;
        });
        // stop Lua that never returns, which would freeze the page
        lua.lua_sethook(
            L,
            (/** @type {any} */ l) => {
                if (this.runDepth > 0 && this.now() - this.runStart > RUN_LIMIT_MS) {
                    lauxlib.luaL_error(
                        l,
                        this.str(`virtual grid: stopped after ${RUN_LIMIT_MS / 1000} s without returning`)
                    );
                }
            },
            lua.LUA_MASKCOUNT,
            100000
        );
        this.registerFunctions(L);

        const lib = this.fs.read('lib.lua');
        if (lib === undefined) {
            this.serial('-- lib.lua not found\r\n');
        } else if (!lib.slice(0, 24).includes(III_VERSION)) {
            this.serial('-- lib.lua wrong version\r\n');
        }
        if (lib === undefined || !lib.slice(0, 24).includes(III_VERSION)) {
            this.serial('-- init: writing lib.lua\r\n');
            if (!this.fs.write('lib.lua', this.libLua)) this.serial('-- init: writing lib.lua failed!!\r\n');
        }

        if (!runScript) {
            this.serial('-- init: skip script\r\n');
            return;
        }
        this.serial('-- init: running lib\r\n');
        const libErr = this.doString(this.fs.read('lib.lua') || '', 'lib.lua');
        if (libErr !== null) this.serial(`-- init: lib errors!\r\n${libErr}\r\n`);

        const init = this.fs.read('init.lua');
        if (init === undefined) {
            this.serial('-- init: no script\r\n');
        } else {
            this.serial('-- init: running script\r\n');
            const err = this.doString(init, 'init.lua');
            if (err !== null) this.serial(`-- init: error running script\r\n${err}\r\n`);
        }
    }

    vmDeinit() {
        for (const m of this.metros) m.stop();
        if (this.L) this.f.lua.lua_close(this.L);
        this.L = null;
    }

    /** @param {string} s */
    str(s) {
        return this.f.to_luastring(s);
    }

    /** Runs fn as one entry into Lua, for the time limit. @param {() => void} fn */
    enter(fn) {
        if (this.runDepth++ === 0) this.runStart = this.now();
        try {
            fn();
        } finally {
            this.runDepth--;
        }
    }

    /**
     * Compiles source onto the stack: a REPL line as luaL_loadstring does,
     * a file with "@name" so its errors read "file.lua:12:" (parterre's vm.c).
     * @param {any} L @param {string} source @param {string} [file]
     */
    load(L, source, file) {
        const { lauxlib } = this.f;
        const code = this.str(source);
        return file === undefined
            ? lauxlib.luaL_loadstring(L, code)
            : lauxlib.luaL_loadbuffer(L, code, code.length, this.str(`@${file}`));
    }

    /** luaL_dostring: null, or the error message (popped). @param {string} source @param {string} [file] */
    doString(source, file) {
        const { lua } = this.f;
        const L = this.L;
        let err = null;
        this.enter(() => {
            const top = lua.lua_gettop(L);
            let status = this.load(L, source, file);
            if (status === lua.LUA_OK) status = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
            if (status !== lua.LUA_OK) err = lua.lua_tojsstring(L, -1);
            lua.lua_settop(L, top);
        });
        return err;
    }

    /** vm_run_buffer: a REPL line. @param {string} line */
    runBuffer(line) {
        if (!this.L) return;
        const err = this.doString(line);
        if (err !== null) this.serial(`-- lua error:\r\n${err}\r\n`);
    }

    /** vm_test_buffer: does an upload compile? @param {string} source @param {string} file */
    testScript(source, file) {
        const { lua } = this.f;
        const L = this.L;
        if (!L) return false;
        const status = this.load(L, source, file);
        if (status !== lua.LUA_OK) {
            const err = lua.lua_tojsstring(L, -1);
            lua.lua_pop(L, 1);
            this.serial(`-- lua error:\r\n${err}\r\n`);
            return false;
        }
        lua.lua_pop(L, 1);
        this.serial('-- compiled ok\r\n');
        return true;
    }

    /**
     * docall + l_report: calls the global `name` with integer arguments, with
     * a traceback on error, as the device calls event_grid, event_midi and
     * metro_event. @param {string} name @param {number[]} args
     */
    callGlobal(name, args) {
        const L = this.L;
        if (!L) return;
        const { lua, lauxlib } = this.f;
        this.enter(() => {
            const top = lua.lua_gettop(L);
            lua.lua_pushcfunction(L, (/** @type {any} */ l) => {
                const msg = lua.lua_isstring(l, 1)
                    ? lua.lua_tostring(l, 1)
                    : this.str(`(error object is a ${lauxlib.luaL_typename(l, 1)} value)`);
                lauxlib.luaL_traceback(l, l, msg, 1);
                return 1;
            });
            lua.lua_getglobal(L, this.str(name));
            if (lua.lua_isnil(L, -1)) {
                lua.lua_settop(L, top);
                return;
            }
            for (const a of args) lua.lua_pushinteger(L, a);
            if (lua.lua_pcall(L, args.length, 0, top + 1) !== lua.LUA_OK) {
                // the error object must go, or a failing metro fills the stack
                this.serial(`${lua.lua_tojsstring(L, -1)}\r\n`);
            }
            lua.lua_settop(L, top);
        });
    }

    /** @param {number} index 0-based @param {number} stage */
    handleMetro(index, stage) {
        this.callGlobal('metro_event', [index + 1, stage]);
    }

    /** MIDI arriving (vm_handle_midi), e.g. from Web MIDI. */
    midiIn(/** @type {number} */ d1, /** @type {number} */ d2 = 0, /** @type {number} */ d3 = 0) {
        this.countIn++;
        if (this.monitorOn) this.serial(`^^midi(i,${hex2(d1)},${hex2(d2)},${hex2(d3)})\r\n`);
        this.callGlobal('event_midi', [d1 & 255, d2 & 255, d3 & 255]);
    }

    /** A key on the grid (1-based), queued as the device does. */
    key(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) {
        if (x < 1 || y < 1 || x > this.size.x || y > this.size.y) return;
        this.keyQueue.push({ x, y, z: z ? 1 : 0 });
        if (!this.keyTimer) this.keyTimer = setTimeout(() => this.drainKeys(), 0);
    }

    drainKeys() {
        this.keyTimer = null;
        const e = this.keyQueue.shift();
        if (!e) return;
        this.callGlobal('event_grid', [e.x, e.y, e.z]);
        if (this.keyQueue.length) this.keyTimer = setTimeout(() => this.drainKeys(), 0);
    }

    // ── the grid (parterre main.c) ─────────────────────────────────────

    refresh() {
        this.front.set(this.back);
        this.changed = true;
        this.scheduleFrame();
    }

    scheduleFrame() {
        if (!this.mirrorOn || this.mirrorTimer) return;
        const wait = Math.max(0, this.lastFrameAt + MIRROR_INTERVAL_MS - this.now());
        this.mirrorTimer = setTimeout(() => {
            this.mirrorTimer = null;
            if (!this.mirrorOn || !this.changed) return;
            this.changed = false;
            this.lastFrameAt = this.now();
            let frame = '';
            for (const level of this.front) frame += HEX[level & 15];
            this.serial(`^^grid(${frame})\r\n`);
        }, wait);
    }

    /** @param {boolean} on */
    setMirror(on) {
        this.mirrorOn = on;
        if (on) this.refresh();
        else if (this.mirrorTimer) {
            clearTimeout(this.mirrorTimer);
            this.mirrorTimer = null;
        }
    }

    /** @param {boolean} on */
    setCounts(on) {
        this.countsOn = on;
        if (this.countsTimer) clearInterval(this.countsTimer);
        this.countsTimer = null;
        if (!on) return;
        const send = () => {
            // no MIDI clock comes in here, so the tempo is always 0
            const counts = `${this.countIn},${this.countOut},0`;
            if (counts === this.sentCounts) return;
            this.sentCounts = counts;
            this.serial(`^^midic(${counts})\r\n`);
        };
        this.sentCounts = '';
        send();
        this.countsTimer = setInterval(send, SUMMARY_INTERVAL_MS);
    }

    // ── the functions scripts see ──────────────────────────────────────

    /** @param {any} L */
    registerFunctions(L) {
        const { lua, lauxlib } = this.f;
        const W = this.size.x;
        const H = this.size.y;
        const int = (/** @type {any} */ l, /** @type {number} */ i) => lua.lua_tointeger(l, i);
        const jsString = (/** @type {any} */ l, /** @type {number} */ i) =>
            lua.lua_isstring(l, i) ? lua.lua_tojsstring(l, i) : '';
        const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
            Math.min(hi, Math.max(lo, v));
        const u8 = (/** @type {number} */ v) => v & 255;

        /** @type {Record<string, (l: any) => number>} */
        const fns = {
            // vm.c
            help: () => {
                this.serial(DEVICE_HELP.replace(/\n/g, '\r\n'));
                this.serial(III_HELP.replace(/\n/g, '\r\n'));
                return 0;
            },
            print: (l) => {
                const n = lua.lua_gettop(l);
                for (let i = 1; i <= n; i++) this.serial(`${this.printValue(l, i)}\r\n`);
                return 0;
            },
            dostring: (l) => {
                const err = this.doString(jsString(l, 1));
                if (err !== null) this.serial(err);
                return 0;
            },
            midi_tx: (l) => {
                const [d1, d2, d3] = [u8(int(l, 1)), u8(int(l, 2)), u8(int(l, 3))];
                this.countOut++;
                if (this.monitorOn) this.serial(`^^midi(o,${hex2(d1)},${hex2(d2)},${hex2(d3)})\r\n`);
                this.onMidiOut?.(d1, d2, d3);
                return 0;
            },
            metro_set: (l) => {
                const index = int(l, 1) - 1;
                if (index < 0 || index > METRO_COUNT - 1) return 0;
                const count = lua.lua_gettop(l) === 3 ? int(l, 3) : -1;
                this.metros[index].set(lua.lua_tonumber(l, 2), count);
                return 0;
            },
            get_time: (l) => {
                lua.lua_pushnumber(l, (this.now() - this.bootTime) / 1000);
                return 1;
            },
            device_id: (l) => {
                lua.lua_pushstring(l, this.str('grid'));
                return 1;
            },
            device_version: (l) => {
                lua.lua_pushstring(l, this.str(VIRTUAL_VERSION));
                return 1;
            },
            device_reset: () => {
                setTimeout(() => this.reset(), 0);
                return 0;
            },
            fs_read_file: (l) => {
                const text = this.fs.read(jsString(l, 1));
                if (text === undefined) lua.lua_pushboolean(l, false);
                else lua.lua_pushstring(l, this.str(text));
                return 1;
            },
            // as on the device: it returns whatever ends up on top of the
            // stack (the file's first result, or an error message)
            fs_run_file: (l) => {
                const name = jsString(l, 1);
                const text = this.fs.read(name);
                if (text === undefined) {
                    lua.lua_pushnil(l);
                    return 0;
                }
                let status = this.load(l, text, name);
                if (status === lua.LUA_OK) status = lua.lua_pcall(l, 0, lua.LUA_MULTRET, 0);
                if (status !== lua.LUA_OK) this.serial(`${lua.lua_tojsstring(l, -1)}\n`);
                return 1;
            },
            fs_write_file: (l) => {
                lua.lua_pushboolean(l, this.fs.write(jsString(l, 1), jsString(l, 2)));
                return 1;
            },
            fs_remove_file: (l) => {
                lua.lua_pushboolean(l, this.fs.remove(jsString(l, 1)));
                return 1;
            },
            fs_list_files: (l) => {
                const names = this.fs.list();
                lua.lua_createtable(l, names.length, 0);
                names.forEach((name, i) => {
                    lua.lua_pushstring(l, this.str(name));
                    lua.lua_rawseti(l, -2, i + 1);
                });
                return 1;
            },
            fs_file_size: (l) => {
                const size = this.fs.size(jsString(l, 1));
                if (size === undefined) return 0;
                lua.lua_pushinteger(l, size);
                return 1;
            },
            fs_free_space: (l) => {
                lua.lua_pushinteger(l, this.fs.freeSpace());
                return 1;
            },
            fs_reformat: () => {
                this.fs.reformat();
                return 0;
            },
            // Fengari has no lua_gc: answer as an idle collector would
            collectgarbage: (l) => {
                const opt = lua.lua_isstring(l, 1) ? lua.lua_tojsstring(l, 1) : 'collect';
                if (opt === 'step' || opt === 'isrunning') lua.lua_pushboolean(l, opt === 'isrunning');
                else lua.lua_pushnumber(l, 0);
                return 1;
            },

            // parterre: the grid
            grid_led: (l) => {
                const x = u8(int(l, 1) - 1);
                const y = u8(int(l, 2) - 1);
                let z = int(l, 3);
                if (x >= W || y >= H) return 0;
                if (lua.lua_toboolean(l, 4)) z += this.back[y * W + x];
                this.back[y * W + x] = clamp(z, 0, 15);
                return 0;
            },
            grid_led_get: (l) => {
                const x = u8(int(l, 1) - 1) % W;
                const y = u8(int(l, 2) - 1) % H;
                lua.lua_pushinteger(l, this.back[y * W + x]);
                return 1;
            },
            grid_led_all: (l) => {
                const z = int(l, 1);
                const rel = lua.lua_toboolean(l, 2);
                for (let i = 0; i < this.back.length; i++) this.back[i] = clamp(rel ? z + this.back[i] : z, 0, 15);
                return 0;
            },
            grid_intensity: (l) => {
                this.intensity = clamp(int(l, 1), 0, 15);
                return 0;
            },
            grid_refresh: () => {
                this.refresh();
                return 0;
            },
            grid_size_x: (l) => {
                lua.lua_pushinteger(l, W);
                return 1;
            },
            grid_size_y: (l) => {
                lua.lua_pushinteger(l, H);
                return 1;
            },

            // parterre: what greenhouse uses
            gh_mirror: (l) => {
                this.setMirror(lua.lua_toboolean(l, 1));
                return 0;
            },
            gh_key: (l) => {
                this.key(int(l, 1), int(l, 2), int(l, 3));
                return 0;
            },
            gh_mem: (l) => {
                // there's no C heap to measure: fixed, made-up numbers
                const total = 196608;
                const used = 65536;
                if (!lua.lua_toboolean(l, 1)) {
                    const kb = (/** @type {number} */ b) => (b / 1024).toFixed(1);
                    this.serial(
                        `heap KB: free ${kb(total - used)}, largest block ${kb(total - used)}, used ${kb(used)}, ` +
                            `peak ${kb(used)}, high water ${kb(used)} of ${kb(total)} (virtual)\r\n`
                    );
                }
                for (const v of [total - used, total - used, used, used, total, used]) lua.lua_pushinteger(l, v);
                return 6;
            },
            gh_dump_file: (l) => {
                const name = jsString(l, 1);
                const text = this.fs.read(name);
                if (text === undefined) {
                    lua.lua_pushnil(l);
                    lua.lua_pushstring(l, this.str(`${name}: not found`));
                    return 2;
                }
                const bytes = new TextEncoder().encode(text);
                for (let i = 0; i < bytes.length; i += 96) this.serial(`${base64(bytes.subarray(i, i + 96))}\n`);
                const crc = crc32(bytes);
                this.serial(`${bytes.length} ${crc.toString(16).padStart(8, '0')}\r\n`);
                lua.lua_pushinteger(l, bytes.length);
                lua.lua_pushinteger(l, crc | 0); // Fengari's integers are 32-bit
                return 2;
            },
            gh_rename_file: (l) => {
                const from = jsString(l, 1);
                const to = jsString(l, 2);
                if (this.fs.rename(from, to)) {
                    lua.lua_pushboolean(l, true);
                    return 1;
                }
                lua.lua_pushnil(l);
                lua.lua_pushstring(l, this.str(`rename ${from} -> ${to} failed (-2)`));
                return 2;
            },
            gh_board: (l) => {
                lua.lua_pushstring(l, this.str('virtual'));
                return 1;
            },
            gh_midi_monitor: (l) => {
                this.monitorOn = lua.lua_toboolean(l, 1);
                return 0;
            },
            gh_midi_counts: (l) => {
                this.setCounts(lua.lua_toboolean(l, 1));
                return 0;
            }
        };

        for (const [name, fn] of Object.entries(fns)) {
            lua.lua_pushcfunction(L, fn);
            lua.lua_setglobal(L, this.str(name));
        }
    }

    /** One value as iii's print shows it (vm.c print_stack_pos). @param {any} l @param {number} i */
    printValue(l, i) {
        const { lua, lauxlib } = this.f;
        if (lua.lua_isinteger(l, i)) return String(lua.lua_tointeger(l, i));
        // true for numeric strings as well: print("10") shows 10.000000 on the device too
        if (lua.lua_isnumber(l, i)) return formatFloat(lua.lua_tonumber(l, i));
        if (lua.lua_isstring(l, i)) return lua.lua_tojsstring(l, i);
        if (lua.lua_isboolean(l, i)) return lua.lua_toboolean(l, i) ? 'true' : 'false';
        if (lua.lua_isnil(l, i)) return 'nil';
        lauxlib.luaL_tolstring(l, i); // pushes "table: 0x..." and the like
        const text = lua.lua_tojsstring(l, -1);
        lua.lua_pop(l, 1);
        // a table gets an empty line after it on the device
        return lua.lua_istable(l, i) ? `${text}\r\n` : text;
    }
}

/**
 * The virtual grid behind iiiConnection's interface (js/connection.js, passed
 * in): what the app writes goes to VirtualIii, what it prints comes back
 * through receiveText, so it is framed into lines as a device's output is.
 * @param {any} iiiConnection the class
 * @param {URL} [base] the site's root
 */
export async function createVirtualConnection(iiiConnection, base = new URL('..', import.meta.url)) {
    const [fengari, libLua] = await Promise.all([
        import(new URL('vendor/fengari.js', base).href),
        fetch(new URL('vendor/iii-lib.lua', base)).then((r) => {
            if (!r.ok) throw new Error(`vendor/iii-lib.lua: ${r.status}`);
            return r.text();
        })
    ]);

    class VirtualConnection extends iiiConnection {
        constructor() {
            super();
            this.isVirtual = true;
            /** @type {VirtualIii | null} */
            this.device = null;
        }

        async connect() {
            let storage = null;
            try {
                storage = window.localStorage;
            } catch {
                // blocked: files last until the page closes
            }
            this.device = new VirtualIii({
                fengari,
                libLua,
                storage,
                // like bytes off the wire: never inside the write that caused them
                output: (text) => queueMicrotask(() => this.isConnected && this.receiveText(text))
            });
            this.device.boot();
            this.isConnected = true;
            this.onConnectionChange?.(true);
            return true;
        }

        /** @param {string} data */
        async write(data) {
            if (!this.isConnected || !this.device) throw new Error('Not connected');
            this.device.receive(String(data));
        }

        async disconnect() {
            this.isConnected = false;
            this.clearPartialLineFlush();
            this.device?.shutdown();
            this.device = null;
            this.flushPartialLineBuffer();
            this.onConnectionChange?.(false);
        }
    }

    return new VirtualConnection();
}
