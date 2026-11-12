# greenhouse

**greenhouse**, by Voltage Foundry Modular, is where iii devices are tended from the browser:
a REPL, the scripts on the device and an editor for them, a view of the device you can play,
and **graft**, a patch editor that wires blocks into a script without code. It is a fork of
monome's [web-diii](https://github.com/monome/web-diii), whose own description follows.

---

![](docs/images/diii.png)

## diii (fka web-diii), upstream

A web-based live-coding and management interface for iii devices, available [here](https://monome.org/diii). The iii sibling of [web-druid](https://github.com/dessertplanet/web-druid) that communicates with [crow](https://monome.org/docs/crow) and is in turn based on the python-based [druid](https://monome.org/docs/crow/druid) terminal app. Send commands, get text feedback, and manage the files on your iii device.

This repo has the source code for this static web app. For docs, go [here](https://monome.org/docs/iii/diii).

## this fork

A fork of [monome/web-diii](https://github.com/monome/web-diii) (GPL-3.0), published at
**[greenhouse.vfmod.com](https://greenhouse.vfmod.com)** (diii.vfmod.com redirects there). It works with any iii device, and adds views and
tools for devices whose firmware supports them, so scripts can be tried without the hardware
attached:

- [parterre](https://vfmod.com/parterre/) (repo: [VoltageFoundryMod/parterre](https://github.com/VoltageFoundryMod/parterre); it was called Open Grid until November 2026): a **grid** drawer
  that shows the grid's LEDs live and lets you press keys from the browser. Shift-click or
  right-click holds a key down (click it again to let go).
- achene, a MIDI controller on iii (not published yet): an **achene** drawer with the
  controller's panel, drawn to scale from its PCB layout. It shows the keys' LEDs and the OLED
  live, and plays the encoders (drag, scroll or arrow keys; click to push) and the keys (several
  at once with touch; shift-click or right-click holds one; with the panel focused, the computer
  keyboard plays them). **full screen** shows the panel alone, for playing. A XIAO breadboard
  build (4 encoders, 4 keys) greys out the rest.

- **graft**, the patch editor (the **graft** drawer; any iii device, with achene's and the
  grid's own blocks when one is connected): wire blocks (encoder, key, LFO,
  value, scale, toggle, MIDI CC and note, key LED, display) into a script and play it live; every
  edit goes to the device as you make it, and **save…** writes a script that runs on its own.
  See [docs/VISUAL-EDITOR.md](docs/VISUAL-EDITOR.md), and [docs/ROADMAP.md](docs/ROADMAP.md) for
  what's next.

Also on top of upstream:

- installs as an app (PWA) from any path; **update ready** in the header when a newer greenhouse is
  published;
- **edit** in a file's menu opens a code editor next to the console (Ctrl+S, save as, run,
  autocomplete and help for iii functions, clickable errors, line wrap); Tab completes names in
  the REPL; **+** creates a script, **rename** renames one; drag files in to upload several;
- **backup** downloads every file on the device as one zip, **restore** uploads it again;
- a **midi** drawer with the MIDI the device sends and receives;
- **device ▾ → firmware** shows the firmware version and offers updates from parterre's and achene's
  releases.

The extras that need a device's own firmware hide themselves or say so:

|                                                                                               | Stock iii firmware                                               | parterre firmware                                |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| REPL, history, Tab completion, uploads (several at once), run, new, delete, first / not first | ✅                                                               | ✅                                               |
| Editor: autocomplete, hover help, reference, drafts, clickable errors, line wrap              | ✅                                                               | ✅                                               |
| Read, edit, download, backup: files come back exactly (blank lines and all)                   | ✅ slower: read in 3 KB pieces                                   | ✅ fast (`gh_dump_file`, og-0.3.4+)              |
| Rename                                                                                        | ✅ copy, then delete                                             | ✅ one atomic step (`gh_rename_file`, og-0.3.5+) |
| Save from the editor with a syntax error                                                      | ⚠ the device's copy is deleted (your text stays in the editor)  | ✅ the device keeps the old file                 |
| Scripts bigger than 32 KB                                                                     | ❌ stock iii's upload limit                                      | ✅                                               |
| Memory in the explorer footer                                                                 | Lua's share only                                                 | ✅ Lua and the C heap (`gh_mem`)                 |
| Virtual grid drawer (LEDs, press keys from the browser)                                       | ❌ hidden                                                        | ✅ (`gh_mirror`, `gh_key`)                       |
| MIDI monitor list                                                                             | ❌ says it needs og-0.3.8                                        | ✅ og-0.3.8+                                     |
| MIDI counts and clock tempo with the drawer closed                                            | ❌                                                               | ✅ og-0.3.9+                                     |
| Firmware update dialog                                                                        | shows the version and links to monome's firmware; no UF2 offered | ✅ newest release for your board                 |

The firmware calls behind these are greenhouse's tools, `gh_*` (parterre 0.4 and later; until
0.3.16 they were `og_*`, and parterre keeps those names working). greenhouse uses the `gh_` name
and falls back to the `og_` one, so older parterre builds and achene, which carries the same
tools as `og_*` (it started from parterre's), work too. achene's firmware updates come from
achene's own releases.

The ⚠ and ❌ rows on stock firmware are limits of iii itself; the fixes are in the
[iii pull requests](https://codeberg.org/tehn/iii/pulls) (#10–#12).

### development

No build step: the browser loads the files as they are. Node is only needed for the tools
(`make` runs them; `make help` lists the targets).

```sh
make serve          # http://localhost:8000 (Web Serial works on localhost), reloading on every edit; PORT=8080 to change
make test           # format check and type check, before a commit
make format         # format the JS (Prettier)
make dist           # the site into dist/, as GitHub Pages publishes it
make vendor         # rebuild the code editor bundle in vendor/ (committed)
```

`make serve` watches the files: a CSS edit restyles the open page in place (the serial
connection stays up), any other edit reloads it. In that mode the service worker caches nothing,
so every load is what's on disk. The tools install themselves from `package-lock.json` the first
time a target needs them.
Without make, `node tools/serve.mjs` and `node tools/dist.mjs` need nothing installed. Pushing
to `main` publishes the site (`.github/workflows/pages.yml`). See [AGENTS.md](AGENTS.md) for
conventions.

**Upstream:** `make upstream` merges monome's `main`. Fixes that suit every iii device go to
monome as pull requests, from a branch based on `upstream/main`; device views stay here.

### history

Developed inside Open-Grid-Controller as a git subtree at `diii/` until November 2026, then
split out with its history (`git subtree split`), so the commits here are the same work.

## requirements

Uses the Web Serial API that is only available in chromium-based browsers like Chrome, Chromium, Edge, and Opera.

Can be installed as a progressive web app via the install app button in the browser address bar, allowing for use without an internet connection.

## a note for web developers

to run locally for development on the site itself, run this in the web-diii root directory then browse to localhost:8000

```bash
python3 -m http.server 8000
```

This is **not** necessary for using greenhouse offline, see the note above about installing as a progressive web app for the best experience there.
