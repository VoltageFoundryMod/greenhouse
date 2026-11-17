// Bundles the parts of prism-code-editor diii uses, and Drawflow, into vendor/, which is
// committed: diii itself has no build step, so the site and `make diii` work
// without `npm install`. Rerun after changing the version in package.json:
//
//   npm run vendor

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'vendor');
// the package's "exports" hides package.json, so go to the folder directly
const pkgDir = join(root, 'node_modules', 'prism-code-editor');
const { version } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));

const entry = `
export { createEditor } from 'prism-code-editor';
import 'prism-code-editor/prism/languages/lua';
import 'prism-code-editor/languages/lua';
export { editorCommands, editHistory, defaultKeymap } from 'prism-code-editor/commands';
export { searchWidget, highlightSelectionMatches } from 'prism-code-editor/search';
export { matchBrackets } from 'prism-code-editor/match-brackets';
export { highlightBracketPairs } from 'prism-code-editor/highlight-brackets';
export { indentGuides } from 'prism-code-editor/guides';
export { cursorPosition } from 'prism-code-editor/cursor';
export { autoComplete, registerCompletions, fuzzyFilter } from 'prism-code-editor/autocomplete';
export { editorHoverDescriptions } from 'prism-code-editor/hover';
`;

await mkdir(out, { recursive: true });
await build({
    stdin: { contents: entry, resolveDir: root, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    legalComments: 'none',
    banner: { js: `/* prism-code-editor ${version} (MIT), bundled by tools/vendor-editor.mjs */` },
    outfile: join(out, 'prism-code-editor.js')
});

const css = await Promise.all(
    ['layout.css', 'guides.css', 'search.css', 'scrollbar.css', 'autocomplete.css', 'autocomplete-icons.css'].map((f) =>
        readFile(join(pkgDir, 'dist', f), 'utf8')
    )
);
await writeFile(
    join(out, 'prism-code-editor.css'),
    `/* prism-code-editor ${version} (MIT): layout, guides, search, scrollbar, autocomplete */\n${css.join('\n')}`
);
await copyFile(join(pkgDir, 'LICENSE'), join(out, 'prism-code-editor.LICENSE'));
console.log(`vendor/prism-code-editor.{js,css} from prism-code-editor ${version}`);

// Drawflow, the node editor under the patch drawer (js/patch.js)
const flowDir = join(root, 'node_modules', 'drawflow');
const flow = JSON.parse(await readFile(join(flowDir, 'package.json'), 'utf8'));
await build({
    stdin: { contents: "export { default as Drawflow } from 'drawflow';", resolveDir: root, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    legalComments: 'none',
    banner: { js: `/* drawflow ${flow.version} (MIT), bundled by tools/vendor-editor.mjs */` },
    outfile: join(out, 'drawflow.js')
});
await writeFile(
    join(out, 'drawflow.css'),
    `/* drawflow ${flow.version} (MIT) */\n${await readFile(join(flowDir, 'dist', 'drawflow.min.css'), 'utf8')}`
);
await copyFile(join(flowDir, 'LICENSE'), join(out, 'drawflow.LICENSE'));
console.log(`vendor/drawflow.{js,css} from drawflow ${flow.version}`);

// Fengari, the Lua VM in JavaScript that runs the virtual grid (js/virtual-device.js).
// Only the core: no fengari-web interop, so a script can't reach the page.
// Its Node-only modules (fs, path, os...) sit behind `typeof process` checks
// that a browser never passes, so they're bundled as empty stubs; tools/
// check-virtual.mjs runs the page's bundle (vendor/fengari.js) too.
const fengariDir = join(root, 'node_modules', 'fengari');
const fengari = JSON.parse(await readFile(join(fengariDir, 'package.json'), 'utf8'));
const nodeOnly = /^(fs|path|os|tmp|child_process|crypto|readline-sync)$/;
await build({
    stdin: {
        contents: "export { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';",
        resolveDir: root,
        loader: 'js'
    },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    // luaconf.js reads this one outside any check
    define: { 'process.env.FENGARICONF': 'undefined' },
    plugins: [
        {
            name: 'node-only-stubs',
            setup(b) {
                b.onResolve({ filter: nodeOnly }, (args) => ({ path: args.path, namespace: 'stub' }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};' }));
            }
        }
    ],
    banner: { js: `/* fengari ${fengari.version} (MIT), bundled by tools/vendor-editor.mjs */` },
    outfile: join(out, 'fengari.js')
});
// sprintf-js (BSD-3-Clause, string.format) is bundled in too: its notice goes along
const sprintfDir = join(root, 'node_modules', 'sprintf-js');
await writeFile(
    join(out, 'fengari.LICENSE'),
    `fengari ${fengari.version} (MIT)

${await readFile(join(fengariDir, 'LICENSE'), 'utf8')}
` +
        `sprintf-js, bundled in for string.format (BSD-3-Clause)

` +
        (await readFile(join(sprintfDir, 'LICENSE'), 'utf8'))
);
console.log(`vendor/fengari.js from fengari ${fengari.version}`);
