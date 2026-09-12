UUID = quick-light@tejashvi.dev
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

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
	@echo "Packaging $(UUID).zip..."
	@rm -rf build $(UUID).zip
	@mkdir -p build
	@cp -r metadata.json stylesheet.css *.js schemas build/
	@cd build && zip -qr ../$(UUID).zip .
	@rm -rf build
	@echo "Created $(UUID).zip successfully."

clean:
	@rm -rf build $(UUID).zip schemas/gschemas.compiled
