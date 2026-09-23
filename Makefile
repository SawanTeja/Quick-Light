UUID = quick-light@tejashvi.dev
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
EXTRA_SOURCES = --extra-source=keybindManager.js \
                --extra-source=monitorManager.js \
                --extra-source=panelIndicator.js \
                --extra-source=quickLightModal.js \
                --extra-source=shortcuts.js \
                --extra-source=themeStyler.js

.PHONY: all build install uninstall enable disable prefs pack clean

all: build

build:
	@echo "Compiling GSettings schemas..."
	glib-compile-schemas --strict --targetdir=schemas/ schemas/

install: build
	@echo "Installing $(UUID) to $(INSTALL_DIR)..."
	@mkdir -p $(INSTALL_DIR)
	@cp -r metadata.json stylesheet.css *.js schemas $(INSTALL_DIR)/
	@echo "Installation complete!"
	@echo "You can now enable the extension via: make enable"

uninstall:
	@echo "Removing $(INSTALL_DIR)..."
	@rm -rf $(INSTALL_DIR)
	@echo "Uninstalled $(UUID)."

enable:
	@gnome-extensions enable $(UUID)
	@echo "Quick Light enabled."

disable:
	@gnome-extensions disable $(UUID)
	@echo "Quick Light disabled."

prefs:
	@gnome-extensions prefs $(UUID)

pack: build
	@echo "Packaging $(UUID).shell-extension.zip with gnome-extensions pack..."
	@rm -f $(UUID).shell-extension.zip $(UUID).zip
	gnome-extensions pack $(EXTRA_SOURCES) --force --out-dir=. .
	@cp -f $(UUID).shell-extension.zip $(UUID).zip
	@echo "Created $(UUID).shell-extension.zip and $(UUID).zip successfully for extensions.gnome.org upload."

clean:
	@rm -rf build $(UUID).shell-extension.zip $(UUID).zip schemas/gschemas.compiled
