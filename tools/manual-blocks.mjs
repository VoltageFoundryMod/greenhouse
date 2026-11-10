// graft's block reference for the manual, made from the blocks themselves
// (js/patch-blocks.js): every block's doc line, ports and settings, the
// recipes and the examples. Run it after changing a block, so the manual
// can't drift from graft:
//
//   make manual-blocks     (node tools/manual-blocks.mjs)
//
// Writes docs/manual/Blocks.md. Device-only parts sit between
// "<!-- if: achene -->" (or grid) and "<!-- end if -->": a device's manual
// that includes this file can leave out the other device's blocks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS, EXAMPLES, EXAMPLE_MENU, RECIPES, patchDevice } from '../js/patch-blocks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../docs/manual/Blocks.md');

// palette order, with what each group is for
const GROUPS = [
    ['achene', 'achene', "the panel's encoders, pushes, keys and key LEDs (with achene connected)"],
    ['screen', 'screen', "things drawn on achene's OLED, placed on a grid that lines up with E1–E4 and K1–K4"],
    ['grid', 'grid', 'widgets made of grid keys, and single keys and LEDs (with a grid connected)'],
    ['source', 'sources', 'start messages: an LFO, a metro, clock and MIDI coming in'],
    ['process', 'process', 'shape messages on their way'],
    ['math', 'math', 'arithmetic and functions'],
    ['memory', 'memory', 'keep values: samples, memories and variables'],
    ['output', 'output', 'send messages out: MIDI, the console'],
    ['custom', 'custom', 'a block of your own Lua']
];
const DEVICE_GROUPS = new Set(['achene', 'screen', 'grid']);
const groupDevice = (g) => (g === 'grid' ? 'grid' : DEVICE_GROUPS.has(g) ? 'achene' : null);

const esc = (s) => String(s).replace(/\|/g, '\\|');
const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';

function range(p) {
    if (p.type === 'select') return (p.options ?? []).map((o) => code(o)).join(', ');
    if (p.type === 'code') return 'Lua code';
    if (p.type === 'text') return 'text';
    const lo = p.min,
        hi = p.max;
    if (lo !== undefined && hi !== undefined) return `${lo} to ${hi}`;
    if (lo !== undefined) return `${lo} or more`;
    if (hi !== undefined) return `up to ${hi}`;
    return p.type === 'int' ? 'a whole number' : 'a number';
}

function defaultOf(p) {
    if (p.type === 'code') return 'example code';
    if (p.default === '' || p.default === undefined) return '(empty)';
    return code(p.default);
}

const ports = (n, word) => (n === 0 ? `no ${word}s` : n === 1 ? `1 ${word}` : `${n} ${word}s`);

const lines = [];
const say = (...l) => lines.push(...l);

say(
    '# graft blocks',
    '',
    '<!-- Made by tools/manual-blocks.mjs from js/patch-blocks.js: edit the blocks there, then run make manual-blocks. -->',
    '',
    "Every block in graft's palette, by group, in the order the palette shows them. Hover a",
    "block's title, a field or a port in graft for the same help. Numbers travel along the wires:",
    'a block with inputs acts when one arrives, and sends its result on from its outputs.',
    ''
);

for (const [group, title, about] of GROUPS) {
    const names = Object.keys(BLOCKS).filter((k) => BLOCKS[k].group === group);
    if (!names.length) continue;
    const device = groupDevice(group);
    if (device) say(`<!-- if: ${device} -->`, '');
    say(`## ${title}`, '', `${about[0].toUpperCase()}${about.slice(1)}.`, '');
    for (const name of names) {
        const b = BLOCKS[name];
        say(`### ${b.label}`, '', `${b.doc[0].toUpperCase()}${b.doc.slice(1)}.`.replace(/\.\.$/, '.'), '');
        say(`*${ports(b.inputs, 'input')}, ${ports(b.outputs, 'output')}*`, '');
        const params = Object.values(b.params ?? {});
        if (params.length) {
            say('| setting | default | takes |', '| --- | --- | --- |');
            for (const p of params) say(`| ${esc(p.label)} | ${esc(defaultOf(p))} | ${esc(range(p))} |`);
            say('');
        }
    }
    if (device) say('<!-- end if -->', '');
}

say(
    '## Recipes',
    '',
    "Small wirings to start from, in graft's guide (**? guide**, then **add**): each lands on the canvas",
    'beside what is there.',
    ''
);
const recipeRow = (r) => `| ${esc(r.title)} | ${esc(r.chain)} | ${esc(r.text)} |`;
for (const device of [null, 'achene', 'grid']) {
    const these = RECIPES.filter((r) => (patchDevice(r.patch) || null) === device);
    if (!these.length) continue;
    if (device) say(`<!-- if: ${device} -->`, '');
    say(`| ${device ? `with ${device}` : 'any device'} | wiring | what it shows |`, '| --- | --- | --- |');
    for (const r of these) say(recipeRow(r));
    say('');
    if (device) say('<!-- end if -->', '');
}

say('## Examples', '', "Whole patches, from **examples…** in graft's bar. Loading one replaces the canvas.", '');
for (const device of [null, 'achene', 'grid']) {
    const these = EXAMPLE_MENU.filter(([name]) => (patchDevice(EXAMPLES[name]()) || null) === device);
    if (!these.length) continue;
    if (device) say(`<!-- if: ${device} -->`, '');
    say(`- ${device ? `**with ${device}:** ` : '**any device:** '}${these.map(([, label]) => label).join(', ')}`, '');
    if (device) say('<!-- end if -->', '');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n'));
console.log(`${path.relative(process.cwd(), out)}: ${Object.keys(BLOCKS).length} blocks, ${RECIPES.length} recipes`);
