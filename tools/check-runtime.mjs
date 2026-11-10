// Checks the blocks runtime's parts (lua/blocks*.lua, docs/VISUAL-EDITOR.md):
// every block in js/patch-blocks.js is defined by one part, every `needs`
// names an earlier part, and each part's needs cover the other parts'
// top-level locals and B fields it uses. A part that uses one it doesn't
// need would find it missing in a runtime built without that part (a nil
// global on the device). Run by `npm run check:runtime` (and `make test`).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCKS, RUNTIME_SOURCES, parseRuntime } from '../js/patch-blocks.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const texts = Object.fromEntries(
    RUNTIME_SOURCES.map(({ file }) => [file, readFileSync(join(root, 'lua', file), 'utf8')])
);
const parts = parseRuntime(texts);
const problems = [];

// names and B fields each part defines at its top level, and what it uses
const strip = (/** @type {string} */ s) =>
    s.replace(/--.*$/gm, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
const info = parts.map((p) => {
    const code = strip(p.source);
    const locals = new Set();
    const fields = new Set();
    for (const line of code.split('\n')) {
        const local = /^local function (\w+)/.exec(line) || /^local ([\w, ]+?)\s*(?:=|$)/.exec(line);
        if (local) local[1].split(',').forEach((n) => locals.add(n.trim()));
        const field = /^function B\.(\w+)/.exec(line) || /^B\.(\w+)\s*=/.exec(line);
        if (field) fields.add(field[1]);
    }
    const names = new Set([...code.matchAll(/(?<![.:\w])([A-Za-z_]\w*)/g)].map((m) => m[1]));
    const bfields = new Set([...code.matchAll(/\bB\.(\w+)/g)].map((m) => m[1]));
    return { part: p, locals, fields, names, bfields };
});

const index = new Map(parts.map((p, i) => [p.name, i]));
if (index.size !== parts.length) problems.push('two parts have the same name');

for (const [type] of Object.entries(BLOCKS)) {
    const by = parts.filter((p) => p.types.includes(type)).map((p) => p.name);
    if (by.length !== 1) problems.push(`block ${type}: defined by ${by.length ? by.join(', ') : 'no part'}`);
}

info.forEach(({ part, locals, fields, names, bfields }, i) => {
    if (part.name === 'core') return;
    // what it may use: the core and its needs, and theirs
    const allowed = new Set(['core']);
    const add = (/** @type {string} */ name) => {
        const at = index.get(name);
        if (at === undefined) problems.push(`${part.name}: needs ${name}, which isn't a part`);
        else if (at >= i) problems.push(`${part.name}: needs ${name}, which comes after it`);
        else if (!allowed.has(name)) {
            allowed.add(name);
            parts[at].needs.forEach(add);
        }
    };
    part.needs.forEach(add);
    const owner = (/** @type {'locals' | 'fields'} */ kind, /** @type {string} */ name) => {
        for (let j = i - 1; j >= 0; j--) if (info[j][kind].has(name)) return parts[j].name;
        return null;
    };
    for (const name of names) {
        const from = !locals.has(name) && owner('locals', name);
        if (from && !allowed.has(from)) problems.push(`${part.name}: uses ${name} from ${from}, not in its needs`);
    }
    for (const name of bfields) {
        const from = !fields.has(name) && owner('fields', name);
        if (from && !allowed.has(from)) problems.push(`${part.name}: uses B.${name} from ${from}, not in its needs`);
    }
});

if (problems.length) {
    for (const p of problems) console.error(`runtime: ${p}`);
    process.exit(1);
}
console.log(`runtime: ${parts.length} parts, ${Object.keys(BLOCKS).length} blocks, needs ok`);
