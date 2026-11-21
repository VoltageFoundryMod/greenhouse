// Drives the virtual grid (js/virtual-device.js) the way greenhouse drives a
// device: REPL lines, captures, uploads with ^^s/^^f/^^w, ^^c, the grid
// mirror, key presses, the MIDI monitor, and graft patches built from
// lua/blocks*.lua. Everything runs twice: on the fengari package, and on
// vendor/fengari.js, the bundle the page loads, in a context without Node's
// globals as in a browser. `npm run check:virtual` (-v: what the patches did).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { VirtualIii, LINE_BUFFER_SIZE } from '../js/virtual-device.js';
import {
    EXAMPLES,
    RUNTIME_SOURCES,
    buildRuntime,
    liveLines,
    parseRuntime,
    patchFile,
    patchTypes
} from '../js/patch-blocks.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libLua = readFileSync(join(root, 'vendor', 'iii-lib.lua'), 'utf8');

/** vendor/fengari.js run as a page would: no process, no require. */
function loadBundle() {
    const src = readFileSync(join(root, 'vendor', 'fengari.js'), 'utf8');
    const m = /export\s*\{([^}]*)\};?\s*$/.exec(src);
    if (!m) throw new Error('vendor/fengari.js: no export at the end');
    const fields = m[1].split(',').map((f) => {
        const [local, name] = f.trim().split(/\s+as\s+/);
        return `${name || local}: ${local}`;
    });
    const context = vm.createContext({ TextEncoder, TextDecoder, console, performance });
    vm.runInContext(`${src.slice(0, m.index)};globalThis.__fengari = {${fields.join(', ')}};`, context);
    return context.__fengari;
}

/** @type {Record<string, any>} */
const engines = { fengari: createRequire(import.meta.url)('fengari'), 'vendor/fengari.js': loadBundle() };
/** @type {any} */
let fengari;
let engine = '';

/** @type {string[]} */
const problems = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
    if (!ok) problems.push(`${engine}: ${what}`);
};
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const verbose = process.argv.includes('-v');
/** @type {VirtualIii[]} */
const devices = [];

/** A device and what it printed, line by line. */
function makeDevice(storage = memoryStorage()) {
    /** @type {string[]} */
    const lines = [];
    let partial = '';
    const device = new VirtualIii({
        fengari,
        libLua,
        storage,
        output: (text) => {
            partial += text;
            const parts = partial.split('\n');
            partial = parts.pop() || '';
            for (const p of parts) if (p.replace(/\r$/, '')) lines.push(p.replace(/\r$/, ''));
        }
    });
    device.boot();
    devices.push(device);
    let seq = 0;
    return {
        device,
        lines,
        storage,
        /** @param {string} line */
        send(line) {
            device.receive(`${line}\n`);
        },
        /** greenhouse's executeLuaCapture @param {string} code */
        capture(code) {
            const id = ++seq;
            const from = lines.length;
            device.receive(`print('__webdiii_begin:${id}')\n`);
            for (const l of code.split('\n')) if (l.trim()) device.receive(`${l.trim()}\n`);
            device.receive(`print('__webdiii_end:${id}')\n`);
            const got = lines.slice(from);
            const a = got.indexOf(`__webdiii_begin:${id}`);
            const b = got.indexOf(`__webdiii_end:${id}`);
            return a >= 0 && b > a ? got.slice(a + 1, b) : [`(no capture: ${got.join(' | ')})`];
        },
        /** greenhouse's sendScriptLinesToiii @param {string} name @param {string} text */
        upload(name, text) {
            const from = lines.length;
            for (const l of ['^^s', name, '^^f', '^^s', ...text.split('\n'), '^^w']) device.receive(`${l}\n`);
            return lines.slice(from).includes(`-- file written: ${name}`);
        }
    };
}

function memoryStorage() {
    const map = new Map();
    return /** @type {Storage} */ (
        /** @type {unknown} */ ({
            getItem: (/** @type {string} */ k) => map.get(k) ?? null,
            setItem: (/** @type {string} */ k, /** @type {string} */ v) => map.set(k, String(v)),
            removeItem: (/** @type {string} */ k) => map.delete(k)
        })
    );
}

async function suite() {
    // ── the REPL and print ──────────────────────────────────────────────────
    {
        const d = makeDevice();
        check(d.capture('print(device_id())')[0] === 'grid', 'device_id() is "grid"');
        check(d.capture('print(1, 1.5, "x", true, nil)').join(',') === '1,1.500000,x,true,nil', 'print formats as iii');
        check(d.capture('print("10")')[0] === '10.000000', 'print shows a numeric string as a float, as iii does');
        check(d.capture('print(grid_size_x() .. "x" .. grid_size_y())')[0] === '16x8', 'grid size 16x8');
        check(d.capture('print(type(metro), type(midi_out), type(slew))')[0] === 'table', "lib.lua's metro is there");
        const err = d.capture('x = nil + 1');
        check(err[0] === '-- lua error:' && /attempt to perform arithmetic/.test(err[1] || ''), 'a REPL error reports');
        check(d.capture('print(1)')[0] === '1', 'the REPL works after an error');
        const before = d.lines.length;
        d.send(`x = "${'a'.repeat(LINE_BUFFER_SIZE)}"`);
        check(/line over 512/.test(d.lines.slice(before).join('\n')), 'a line over 512 bytes is dropped, and said so');
        const t0 = Date.now();
        const hang = d.capture('while true do end');
        check(Date.now() - t0 < 10000 && /stopped after/.test(hang.join('\n')), 'a loop that never returns is stopped');
        check(d.capture('print(2)')[0] === '2', 'the REPL works after a stopped loop');
    }

    // ── files ───────────────────────────────────────────────────────────────
    {
        const d = makeDevice();
        const hello = 'greeting = "hi"\nfunction hi() print(greeting) end';
        check(d.upload('hello.lua', hello), 'upload writes a file');
        check(!d.upload('bad.lua', 'function ('), "a script that doesn't compile isn't written");
        check(
            d.lines.some((l) => /^bad\.lua:1:/.test(l)),
            'compile errors name the file, as on parterre'
        );
        const files = d.capture('for _, f in ipairs(fs_list_files()) do print(f) end');
        check(files.includes('hello.lua') && files.includes('lib.lua') && !files.includes('bad.lua'), 'fs_list_files');
        check(d.capture('fs_run_file("hello.lua") hi()')[0] === 'hi', 'fs_run_file runs a file');
        check(d.capture('print(fs_file_size("hello.lua"))')[0] === '50', 'fs_file_size');
        d.send('^^c');
        check(d.capture('print(hi)')[0] === 'nil', '^^c starts a clean Lua state');
        check(d.capture('print(metro)')[0] === 'nil', '^^c leaves lib.lua to the host, as iii does');
        d.send('fs_run_file("lib.lua")');
        check(d.capture('print(type(metro))')[0] === 'table', 'lib.lua runs again');
        d.send('first("hello.lua")');
        d.send('^^i');
        check(d.capture('hi()')[0] === 'hi', '^^i runs lib.lua and init.lua');
        const dump = d.capture('gh_dump_file("hello.lua")');
        check(
            dump.length === 2 && atob(dump[0]) === `${hello}\n` && /^50 [0-9a-f]{8}$/.test(dump[1]),
            `gh_dump_file (${dump.join(' | ')})`
        );
        check(d.capture('print(gh_rename_file("hello.lua", "hi.lua"))')[0] === 'true', 'gh_rename_file');
        const again = makeDevice(d.storage);
        check(again.capture('print(fs_read_file("hi.lua") ~= false)')[0] === 'true', 'files outlast the device');
        again.send('pset_init("t") pset_write(1, {a = 5})');
        check(again.capture('print(pset_read(1).a)')[0] === '5', 'psets');
    }

    // ── metros, the grid mirror, keys, MIDI ─────────────────────────────────
    {
        const d = makeDevice();
        d.send('stages = {} m = metro.init(function(s) stages[#stages + 1] = s end, 0.02, 3) m:start()');
        await sleep(150);
        check(d.capture('print(table.concat(stages, ","))')[0] === '1,2,3', 'a counted metro gets stages 1..count');
        d.send('n = 0 m2 = metro.init(function() n = n + 1 end, 0.01) m2:start()');
        await sleep(200);
        d.send('m2:stop()');
        const n = Number(d.capture('print(n)')[0]);
        check(n >= 10 && n <= 22, `an endless metro at 10 ms ticks about 20 times in 200 ms (got ${n})`);

        d.send('gh_mirror(true) grid_led(1, 1, 15) grid_led(16, 8, 7) grid_refresh()');
        await sleep(80);
        const frame = d.lines.filter((l) => l.startsWith('^^grid(')).at(-1) || '';
        check(frame.length === 7 + 128 + 1, 'a ^^grid frame has 128 levels');
        check(frame[7] === 'f' && frame[7 + 127] === '7', 'the frame has the LEDs drawn');

        d.send('keys = {} function event_grid(x, y, z) keys[#keys + 1] = x .. "," .. y .. "," .. z end');
        d.send('gh_key(3, 4, 1) gh_key(3, 4, 0)');
        await sleep(20);
        check(
            d.capture('print(table.concat(keys, " "))')[0] === '3,4,1 3,4,0',
            'gh_key reaches event_grid as integers'
        );

        d.send('gh_midi_monitor(true) midi_note_on(60, 100, 2)');
        await sleep(5);
        check(d.lines.includes('^^midi(o,91,3c,64)'), 'the MIDI monitor reports what goes out');
        d.send('got = nil function event_midi(a, b, c) got = a .. " " .. b .. " " .. c end');
        d.device.midiIn(0x90, 64, 1);
        check(d.lines.includes('^^midi(i,90,40,01)'), 'and what comes in');
        check(d.capture('print(got)')[0] === '144 64 1', 'event_midi gets incoming MIDI');
        d.device.shutdown();
    }

    // ── graft ───────────────────────────────────────────────────────────────
    {
        const texts = Object.fromEntries(
            RUNTIME_SOURCES.map(({ file }) => [file, readFileSync(join(root, 'lua', file), 'utf8')])
        );
        const parts = parseRuntime(texts);
        for (const [name, make] of Object.entries(EXAMPLES)) {
            const patch = make();
            const runtime = buildRuntime(parts, patchTypes(patch), 'grid');
            const d = makeDevice();
            // as runPatch does: the runtime, then the patch line by line
            check(d.upload('blocks_run.lua', runtime.text), `${name}: the runtime uploads`);
            d.capture('fs_run_file("blocks_run.lua")');
            check(d.capture('print(B and B.build or "-")')[0] === runtime.build, `${name}: the runtime runs`);
            d.send('gh_mirror(true) gh_midi_monitor(true)');
            const from = d.lines.length;
            for (const line of liveLines(patch)) {
                check(
                    new TextEncoder().encode(line).length < LINE_BUFFER_SIZE,
                    `${name}: a live line fits iii's buffer`
                );
                d.send(line);
            }
            d.send('gh_key(1, 1, 1)');
            await sleep(400);
            d.send('gh_key(1, 1, 0)');
            await sleep(100);
            const out = d.lines.slice(from);
            const errors = out.filter((l) => /lua error|stack traceback|attempt to|stopped after/.test(l));
            if (verbose) {
                const frames = out.filter((l) => l.startsWith('^^grid(')).length;
                const midi = out.filter((l) => l.startsWith('^^midi(o')).length;
                const lit = (out.filter((l) => l.startsWith('^^grid(')).at(-1) || '')
                    .slice(7, -1)
                    .replace(/[^1-9a-f]/g, '').length;
                console.log(`${engine}: ${name}: ${frames} frames (${lit} LEDs lit in the last), ${midi} MIDI out`);
            }
            check(errors.length === 0, `${name}: runs without errors (${errors.slice(0, 3).join(' | ')})`);
            // and as a saved file, which carries its own runtime
            const file = patchFile(name, patch, runtime);
            check(d.upload(`${name}.lua`, file), `${name}: the saved patch uploads`);
            d.send('^^c');
            d.send('fs_run_file("lib.lua")');
            const before = d.lines.length;
            d.send(`fs_run_file("${name}.lua")`);
            await sleep(100);
            const fileErrors = d.lines.slice(before).filter((l) => /error|traceback|attempt to/.test(l));
            check(fileErrors.length === 0, `${name}: the saved patch runs (${fileErrors.slice(0, 3).join(' | ')})`);
            d.device.shutdown();
        }
    }
}

for ([engine, fengari] of Object.entries(engines)) await suite();

for (const d of devices) d.shutdown();

if (problems.length) {
    console.error(`virtual grid: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
console.log(
    `virtual grid: ok (${Object.keys(EXAMPLES).length} example patches, on ${Object.keys(engines).join(' and ')})`
);
