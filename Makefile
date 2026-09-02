UUID := p7-cmds@prasannavl.com
DIST_DIR := dist
SCHEMAS_DIR := schemas
TOPLEVEL_JS := $(wildcard *.js)
COMMON_JS := $(wildcard common/*.js)
CMD_JS := $(wildcard cmds/*.js)
SHELL_JS := $(wildcard shell/*.js)
PREFS_JS := $(wildcard prefs/*.js)
JS_FILES := $(TOPLEVEL_JS) $(COMMON_JS) $(CMD_JS) $(SHELL_JS) $(PREFS_JS)
EXTRA_SOURCES := README.md CHANGELOG.md common cmds shell prefs
EXTRA_SOURCE_ARGS := $(foreach f,$(EXTRA_SOURCES),--extra-source=$(f))

.PHONY: lint test test-package test-versions fmt schemas version pack install ginstall enable disable reload clean

lint:
	biome lint $(JS_FILES) tests

test: lint schemas
	deno test --allow-read=. tests/config.test.js tests/geometry.test.js tests/metadata.test.js tests/optsize.test.js tests/resize.test.js
	bash tests/run-gjs-tests.sh
	$(MAKE) test-package

test-package: pack
	bash tests/package.test.sh

test-versions:
	bash tests/versions.test.sh

fmt:
	treefmt

schemas:
	glib-compile-schemas $(SCHEMAS_DIR)

version:
	@current=$$(sed -nE 's/.*"version":[[:space:]]*([0-9]+).*/\1/p' metadata.json); \
	new=$$((current + 1)); \
	tmp=$$(mktemp); \
	sed -E "s/\"version\": [0-9]+/\"version\": $$new/" metadata.json > $$tmp && mv $$tmp metadata.json; \
	echo "version $$new"

pack: schemas
	mkdir -p $(DIST_DIR)
	gnome-extensions pack --force --out-dir $(DIST_DIR) $(EXTRA_SOURCE_ARGS)

install: pack
	dest=$(DESTDIR)/share/gnome-shell/extensions/$(UUID); \
	mkdir -p "$$dest"; \
	unzip -q -o $(DIST_DIR)/$(UUID).shell-extension.zip -d "$$dest"; \
	cp -r schemas "$$dest"/

ginstall: pack
	gnome-extensions install --force $(DIST_DIR)/$(UUID).shell-extension.zip

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload: disable enable

clean:
	rm -rf $(DIST_DIR)
	rm -rf $(SCHEMAS_DIR)/*.gschema.compiled
