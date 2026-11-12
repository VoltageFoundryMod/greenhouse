# AGENTS.md: greenhouse

Context for anyone (agent or human) working here. Read `README.md` first.

## What this is

**greenhouse** (by Voltage Foundry Modular; was diii until November 2026): a fork of monome's
[web-diii](https://github.com/monome/web-diii), the browser app that talks to iii devices over
Web Serial (REPL, files, editor). This fork adds **device views** for devices whose firmware
supports them and **graft**, the patch editor; published at https://greenhouse.vfmod.com
(diii.vfmod.com redirects there). Owner: Carlos de Paula.

The rename covers what people see (title, header, welcome page, manifest, messages, docs, the
`-- graft patch:` header of saved patches). Internal names stay on purpose: `diii.js` and
`diiiApp`, the `__webdiii_*` markers in device output and the `webdiii.` localStorage keys
(renaming them would lose saved settings and patches for nothing anyone sees). Say
"greenhouse" and "graft" in new text.

Devices and their firmware repos:

- **parterre**, called Open Grid Controller until November 2026 (`github.com/VoltageFoundryMod/parterre`, locally
  `../parterre`): the virtual grid (`js/grid.js`), firmware updates
  (`js/firmware.js`, from that repo's GitHub releases: versions `parterre-X.Y.Z`, `og-X.Y.Z`
  before 0.4), greenhouse's tools `gh_*` (achene has them too; `og_*` until parterre 0.4 and achene
  0.0.6, no longer called) and parterre's own `pt_*`.
- **achene** (locally `../achene`, not published yet): a MIDI controller with 12 encoders, 16
  RGB keys and a 128×64 OLED. Its view: `js/achene.js` (the app side: detection, drawer,
  mirror, sending), `js/achene-panel.js` (the panel, no serial; also runs in
  `tools/achene-preview.html` with recorded frames from `tools/achene-fixture.txt`),
  `js/oled.js` (the OLED renderer, ported from ForgeSeries' VCV Rack display) and
  `achene.css`. Positions come from `js/achene-layout.js`, generated from achene's
  `hardware/layout.json` by `make achene-layout` (`tools/achene-layout.mjs`). The firmware
  streams `^^achled(<rrggbb per key>)` and `^^achscr(<page>,<256 hex>)` with
  `ach_mirror(true)` and takes `ach_enc` / `ach_enc_key` / `ach_key` calls
  (`../achene/docs/DESIGN.md` §9.5). Lines sent to the device must stay under 512 characters,
  iii's line buffer.

Until November 2026 this lived in Open-Grid-Controller as a git subtree at `diii/`; it was
split out with its history.

## How it's built

- **No build step**: the browser loads the files as they are. `diii.js` is the app class;
  features are mixins in `js/` (native ES modules). `index.html`, `style.css`, `refresh.css`.
- `make help` lists the tasks: `make serve`, `make test` (format check + type check),
  `make format`, `make dist`, `make vendor`, `make upstream`. They only call node, npm and git.
- `package.json` only holds development tools (Prettier, TypeScript, esbuild) and the code
  editor, which `npm run vendor` bundles into the committed `vendor/`.
- `node tools/serve.mjs [port] [--watch]` serves it on localhost (Web Serial needs localhost or
  HTTPS); `--watch` (what `make serve` uses) reloads pages on edits and swaps in a service worker
  that caches nothing;
  `node tools/dist.mjs` copies the site into `dist/` and stamps the service worker's cache name
  with the commit, which is what `.github/workflows/pages.yml` publishes on every push to `main`.
- `npm run check` type-checks the standalone modules listed in `tsconfig.json`.

## Patch editor

`js/patch.js` (the drawer, live sending), `js/patch-blocks.js` (the blocks as data, Lua
generation, `buildRuntime`), `lua/blocks*.lua` (the runtime's source, in `--@part name needs a b`
parts; greenhouse joins those a patch uses), `patch.css`, Drawflow in `vendor/` (bundled by `npm run
vendor`). A block exists twice, in `patch-blocks.js` and as a `B.type` (or screen `widget`) in a
part of its own: keep them in step, keep each part's `needs` right (every part uses only the
core's and its needs' locals), and bump `RUNTIME_VERSION` and `B.version` together when the
runtime changes. `tools/patch-preview.html` runs the drawer without a device. Design:
`docs/VISUAL-EDITOR.md`; plans: `docs/ROADMAP.md`.

## Device views

- A view **detects its device** with a Lua probe (e.g. `print(gh_mirror ~= nil and ...)`) and
  stays hidden otherwise; stock iii devices must keep working.
- Views talk to the firmware only through the serial protocol: Lua calls in, `^^name(...)`
  lines out. Nothing is shared at build time with the firmware repos, so document every
  message on both sides.

## The manual

`docs/manual/Manual.md` is the user manual, written once and shared: achene's and parterre's
printed manuals include it (`<!-- include: -->` in their `docs/manual/Manual.md`, built by
achene's `tools/manual/pdf.mjs`). Text only one device needs goes between `<!-- if: achene -->`
(or `grid`) and `<!-- end if -->`, so the other device's manual leaves it out.
`docs/manual/Blocks.md`, graft's block reference, is generated: after changing a block, a recipe
or an example in `js/patch-blocks.js`, run `make manual-blocks`.

## Conventions

- **Formatting**: Prettier (`.prettierrc.json`: 4 spaces, single quotes, 120 columns); run
  `make format` before committing; `make test` must pass.
- **Commits**: small, one topic, imperative subject with a scope prefix (`greenhouse:`, `docs:`,
  `build:`, `tools:`). The body says what and why.
- Keep generic fixes separate from device-specific work, so they can go to monome/web-diii as
  pull requests from a branch based on `upstream/main`.
- Push only when the owner asks.
- GPL-3.0 (web-diii).
