// Copies the site into dist/ for hosting (the GitHub Pages workflow runs it).
// diii has no build step: this only leaves out the development files and
// gives the service worker a cache name per commit, so installed copies (PWA)
// switch to each release. No dependencies, so it runs without `npm install`.
//
//   node tools/dist.mjs

import { execFileSync } from 'node:child_process';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');

// development files; the site is everything else at the top level
const skip = new Set([
    '.git',
    '.github',
    '.gitignore',
    '.clang-format',
    '.prettierrc.json',
    'AGENTS.md',
    'README.md',
    'TODO',
    'dist',
    'docs',
    'node_modules',
    'package.json',
    'package-lock.json',
    'tools',
    'tsconfig.json',
    'web-diii.code-workspace'
]);

function revision() {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    try {
        // dist/ and node_modules/ are ignored, so only real changes count as dirty
        return git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain') ? '-dirty' : '');
    } catch {
        return 'dev';
    }
}

await rm(out, { recursive: true, force: true });
for (const name of await readdir(root)) {
    if (!skip.has(name)) await cp(join(root, name), join(out, name), { recursive: true });
}

const cache = `diii-${revision()}`;
const swPath = join(out, 'sw.js');
const sw = await readFile(swPath, 'utf8');
const stamped = sw.replace(/const CACHE = '[^']*';/, `const CACHE = '${cache}';`);
if (stamped === sw && !sw.includes(`const CACHE = '${cache}';`)) {
    console.error('could not stamp the cache name in sw.js');
    process.exit(1);
}
await writeFile(swPath, stamped);
console.log(`dist/ (cache ${cache})`);
