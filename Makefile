# diii: common tasks. The site has no build step; these only run the
# development tools. Recipes only call node, npm and git, so they run the
# same from PowerShell, cmd or Git Bash.
#
#   make            serve diii at http://localhost:$(PORT)
#   make help       list all targets

NODE ?= node
NPM  ?= npm
PORT ?= 8000

UPSTREAM ?= https://github.com/monome/web-diii

.PHONY: all help serve dist clean install check format format-check vendor test upstream achene-layout

all: serve

help:
	@echo "Development:"
	@echo "  make serve          serve diii at http://localhost:$(PORT) (Web Serial works on localhost)"
	@echo "  make dist           the site into dist/, as GitHub Pages publishes it"
	@echo "  make clean          remove dist/"
	@echo "Tools (installed by the targets that need them):"
	@echo "  make install        install the dev tools from package-lock.json"
	@echo "  make check          type-check the modules listed in tsconfig.json"
	@echo "  make format         format the JS in place (Prettier)"
	@echo "  make format-check   fail if anything is not formatted"
	@echo "  make test           format-check and check, as before a commit"
	@echo "  make vendor         rebuild vendor/ (the code editor bundle)"
	@echo "Devices:"
	@echo "  make achene-layout  copy achene's panel layout (../achene/hardware/layout.json) into js/"
	@echo "Upstream:"
	@echo "  make upstream       merge monome/web-diii main into the current branch"
	@echo "Options: PORT=8080"

serve:
	$(NODE) tools/serve.mjs $(PORT)

dist:
	$(NODE) tools/dist.mjs

clean:
	$(NODE) tools/dist.mjs --clean

# --ignore-scripts: esbuild works without its install script, and npm 11
# would otherwise stop to ask about it
node_modules: package-lock.json
	$(NPM) ci --ignore-scripts --no-audit --no-fund

install: node_modules

check: node_modules
	$(NPM) run check

format: node_modules
	$(NPM) run format

format-check: node_modules
	$(NPM) run format:check

test: format-check check

vendor: node_modules
	$(NPM) run vendor

upstream:
	git pull --no-rebase $(UPSTREAM) main

# the achene view draws from achene's PCB layout; run after the PCB moves a part
achene-layout: node_modules
	$(NODE) tools/achene-layout.mjs
	$(NPM) exec -- prettier --log-level warn --write js/achene-layout.js
