# AGENTS.md: diii

Context for anyone (agent or human) working here. Read `README.md` first.

## What this is

A fork of monome's [web-diii](https://github.com/monome/web-diii): the browser app that talks to
iii devices over Web Serial (REPL, files, editor). This fork adds **device views** for devices
whose firmware supports them, published at https://diii.vfmod.com. Owner: Carlos de Paula.

Devices and their firmware repos:

- **Open Grid Controller** (`github.com/carlosedp/Open-Grid-Controller`, locally
  `../Open-Grid-Controller`): the virtual grid (`js/grid.js`), firmware updates
  (`js/firmware.js`, from that repo's GitHub releases), the `og_*` tools.
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
parts; diii joins those a patch uses), `patch.css`, Drawflow in `vendor/` (bundled by `npm run
vendor`). A block exists twice, in `patch-blocks.js` and as a `B.type` (or screen `widget`) in a
part of its own: keep them in step, keep each part's `needs` right (every part uses only the
core's and its needs' locals), and bump `RUNTIME_VERSION` and `B.version` together when the
runtime changes. `tools/patch-preview.html` runs the drawer without a device. Design:
`docs/VISUAL-EDITOR.md`; plans: `docs/ROADMAP.md`.

## Device views

- A view **detects its device** with a Lua probe (e.g. `print(og_mirror ~= nil and ...)`) and
  stays hidden otherwise; stock iii devices must keep working.
- Views talk to the firmware only through the serial protocol: Lua calls in, `^^name(...)`
  lines out. Nothing is shared at build time with the firmware repos, so document every
  message on both sides.

## Conventions

- **Formatting**: Prettier (`.prettierrc.json`: 4 spaces, single quotes, 120 columns); run
  `make format` before committing; `make test` must pass.
- **Commits**: small, one topic, imperative subject with a scope prefix (`diii:`, `docs:`,
  `build:`, `tools:`). The body says what and why.
- Keep generic fixes separate from device-specific work, so they can go to monome/web-diii as
  pull requests from a branch based on `upstream/main`.
- Push only when the owner asks.
- GPL-3.0 (web-diii).
