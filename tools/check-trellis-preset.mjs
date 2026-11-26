// Checks js/trellis-preset.js against presets trellis itself saved (in
// achene's PC simulator): each one read and written back must come out
// byte for byte, and edits must land where trellis would read them.
//
//   node tools/check-trellis-preset.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CHANCE_TOP,
    chanceName,
    defaultSlot,
    emptyPreset,
    laneAt,
    newTrack,
    parseLuaValue,
    parseChance,
    parsePreset,
    patternOf,
    serializePreset,
    setLane,
    switchPattern
} from '../js/trellis-preset.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (/** @type {string} */ name, /** @type {boolean} */ ok, /** @type {any} */ info = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` -> ${info}`}`);
};

// a preset trellis 1.7.0 saved: tracks, patterns, scenes, song, assign
const fixture = fs.readFileSync(path.join(here, 'trellis-preset-fixture.lua'), 'utf8');
const p = parsePreset(fixture);
const back = serializePreset(p);
if (back !== fixture) {
    const a = fixture.split('\n'), b = back.split('\n'); // prettier-ignore
    const k = a.findIndex((l, j) => l !== b[j]);
    check('the fixture comes back byte for byte', false, `line ${k + 1}:\n  ${a[k]}\n  ${b[k]}`);
} else check('the fixture comes back byte for byte', true);

check('a named slot', p.slots[1].name === 'cut', p.slots[1].name);
check('an LFO on E5', p.slots[0].mod === 'lfo' && p.slots[0].lwave === 'ramp', p.slots[0].mod);
check('C is a melodic track on P2', p.tracks[3]?.kind === 'melodic' && p.tracks[3].pat === 2);
check('its P1 kept, step 1 on', p.tracks[3] && laneAt(p.tracks[3].pats[1], 'on', 1) === 1);
check('a song of two scenes', p.song.length === 2 && p.song[1][1] === 8, JSON.stringify(p.song));
check('scene 1: C on pattern 2', p.scenes[1]?.pat[2] === 2);

// one with encoders turned: their places are floats, written as Lua's %.5g
const fixture2 = fs.readFileSync(path.join(here, 'trellis-preset-fixture-2.lua'), 'utf8');
check('turned encoders come back byte for byte', serializePreset(parsePreset(fixture2)) === fixture2);

// an empty preset reads back as one
const empty = serializePreset(emptyPreset());
check('an empty preset round trips', serializePreset(parsePreset(empty)) === empty);

// edits
const e = parsePreset(fixture);
e.names[0] = 'synth "lead"';
e.slots[8].ecc = 74;
e.slots[8].lrate = 0.3;
e.tracks[2] = newTrack(2);
e.tracks[2].kind = 'drums';
setLane(e.tracks[2], 'd1', 1, 128 + 100);
setLane(e.tracks[3], 'on', 2, 0); // its only step on, off: the lane is as it starts
const text = serializePreset(e);
const r = parsePreset(text);
check('a name with quotes survives', r.names[0] === 'synth "lead"', r.names[0]);
check('B1 sends cc74', r.slots[8].ecc === 74);
check('a float written as trellis does', text.includes(',0.3,'), '');
check('a new drums track with a hit', r.tracks[2]?.kind === 'drums' && laneAt(r.tracks[2], 'd1', 1) === 228);
check('a lane back to its start is left out', !('on' in r.tracks[3].lanes));

// patterns: a look at an empty one writes nothing; switching keeps both
const q = parsePreset(fixture);
patternOf(q.tracks[3], 5);
check('an empty pattern looked at is left out', serializePreset(q) === fixture);
switchPattern(q.tracks[3], 1);
const q2 = parsePreset(serializePreset(q));
check(
    'switched to P1: its step 1 plays, P2 kept',
    q2.tracks[3].pat === 1 && laneAt(q2.tracks[3], 'on', 1) === 1 && laneAt(q2.tracks[3].pats[2], 'on', 2) === 1
);

// 16 scenes (trellis 1.10.0): S12 and a song entry of S16 survive
const sc = parsePreset(fixture);
sc.scenes[12] = { pat: [0, 0, 1, 0, 1, 0, 0, 0], mute: [0, 0, 0, 0, 1, 0, 0, 0] };
sc.song.push([16, 3]);
const sc2 = parsePreset(serializePreset(sc));
check('S12 kept', sc2.scenes[12]?.mute[4] === 1, JSON.stringify(sc2.scenes[12]));
check('a song entry of S16 kept', sc2.song.at(-1)?.[0] === 16, JSON.stringify(sc2.song));

// Lua literal details
const v = parseLuaValue('return {1, 2.5, -3, "a\\"b\\\\c\\n", x = true, ["y z"] = {}, [3] = nil} -- end');
check('Lua literals', v[1] === 1 && v[2] === 2.5 && v[3] === null && v[4] === 'a"b\\c\n' && v.x === true);
check(
    'an older slot: missing fields take their defaults',
    parsePreset('return {slots = {{"cc", 1, 99}}}').slots[0].kvel === defaultSlot(1, 1).kvel
);

// trig conditions past 100 in the chance lanes, as trellis numbers them (Q.CONDS)
check('conditions: 1:2 is 101, 8:8 is 135', chanceName(101) === '1:2' && chanceName(135) === '8:8');
check('then 1st and !1st, the top', chanceName(136) === '1st' && chanceName(137) === '!1st' && CHANCE_TOP === 137);
check('chances keep their %', chanceName(50) === '50%' && parseChance('50') === 50 && parseChance('75%') === 75);
check(
    'every name reads back as its number',
    Array.from({ length: CHANCE_TOP + 1 }, (_, v) => v).every((v) => parseChance(chanceName(v)) === v)
);
check('nonsense is refused', parseChance('9:9') === null && parseChance('lots') === null);

if (failed) {
    console.error(`${failed} failed`);
    process.exit(1);
}
console.log('all ok');
