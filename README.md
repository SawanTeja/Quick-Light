# Quick Light

**Quick Light** is a modern, responsive, and crash-resilient spotlight search launcher for GNOME Shell (supporting GNOME 46 through 50+).

Inspired by the concept of taking GNOME Shell's search out of the fullscreen Overview and putting it into a sleek macOS Spotlight / Alfred / Raycast style floating modal window, Quick Light is written from scratch with modern ES modules, Libadwaita preferences, and strict event-loop safety for GNOME 50 (Clutter 18).

---

## Highlights & Improvements over Search Light

- **GNOME 50 / Clutter 18 Zero-Crash Safety**:
  - Clutter 18 strictly forbids mutating the actor hierarchy (`add_child`/`remove_child`) synchronously during gesture, accelerator, or signal dispatches.
  - Quick Light schedules actor operations on the GLib idle loop (`GLib.idle_add`) and unmaps elements before detaching, eliminating the fatal `SIGABRT` crashes and GDM logout bugs reported in Search Light (#166, #167, #161).
- **Native Libadwaita Preferences**:
  - Full GTK4 / Libadwaita preference pages (`Adw.PreferencesPage`, `Adw.PreferencesGroup`, `Adw.ActionRow`, `Adw.SpinRow`, `Adw.SwitchRow`).
  - Interactive shortcut recorder widget with modifier detection and clear support.
  - Multi-monitor dropdown with dynamic primary / cursor tracking.
- **Glassmorphic Aesthetic**:
  - Modern translucent backdrop styling with customizable corner radius, subtle borders, and smooth Clutter ease animations.
- **Google Web Search Integration**:
  - Type any keyword or question and press <kbd>Enter</kbd> (or <kbd>Shift</kbd>+<kbd>Enter</kbd>) to instantly search Google in your default web browser.
  - Interactive Google Search action tile at the bottom with real-time query preview.
  - Configurable behavior: *Always on Enter*, *Smart Fallback (search Google when no local app matches)*, or *Shift+Enter only*. Supports `g ` or `? ` prefix shortcuts.
- **Modular ESM Codebase**:
  - Clean architecture with dedicated modules: `QuickLightModal`, `KeybindManager`, `MonitorManager`, `ThemeStyler`, and `PanelIndicator`.

---

## Default Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Super</kbd> + <kbd>Space</kbd> | Toggle Quick Light spotlight search |
| <kbd>Enter</kbd> | Search query on Google (or launch app if in smart fallback mode) |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> / <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Always search keyword on Google in default browser |
| `g <query>` or `? <query>` + <kbd>Enter</kbd> | Direct Google search prefix |
| <kbd>Escape</kbd> | Dismiss Quick Light |

> **Tip:** You can reconfigure shortcuts or customize the Enter key action anytime inside the **Quick Light Preferences** window.

---

## Installation

### From Source
```bash
# Clone the repository
git clone https://github.com/tejashvi/quick-light.git
cd quick-light

# Build schemas and install to ~/.local/share/gnome-shell/extensions/
make install

# Enable the extension
make enable
```

On Wayland, log out and log back in (or restart your session) if installing an extension for the first time. On X11, you can press <kbd>Alt</kbd> + <kbd>F2</kbd>, type `r`, and hit <kbd>Enter</kbd>.

### Preferences
Open the extension settings via:
```bash
make prefs
# or
gnome-extensions prefs quick-light@tejashvi.dev
```

---

## Architecture Overview

```
Quick Light/
├── metadata.json           # Extension descriptor & GNOME Shell version targets (46 - 50)
├── extension.js            # Top-level lifecycle coordinator (enable / disable)
├── quickLightModal.js      # Spotlight modal actor & overview search interception
├── keybindManager.js       # Accelerator binding & idle-deferred dispatch
├── monitorManager.js       # Multi-monitor detection & cursor tracking
├── themeStyler.js          # Dynamic CSS injection with ThemeContext
├── panelIndicator.js       # Top status bar quick-toggle button
├── prefs.js                # Native GTK4 / Libadwaita preferences window
├── shortcuts.js            # Interactive shortcut capture widget
├── stylesheet.css          # Base glassmorphic styling
├── Makefile                # Build, install, and pack automation
└── schemas/
    └── org.gnome.shell.extensions.quick-light.gschema.xml
```

---

## Configuration Options

- **Primary & Secondary Shortcuts**: Assign any combination of Super, Ctrl, Alt, Shift + Key.
- **Follow Mouse Cursor**: Automatically opens the search bar on whichever monitor your mouse pointer is currently on.
- **Window Scaling**: Adjust width and height factors to fit your monitor size.
- **Border & Corner Radius**: Customize corner curvature (e.g. 16px pill vs square) and border outline thickness/color.
- **Backdrop Color & Opacity**: Adjust background tone, glass opacity, and custom font colors.
- **Animations**: Toggle smooth easing transitions and customize duration in milliseconds.
- **Top Panel Icon**: Optional status bar icon for mouse-friendly launching.

---

## License

GPL-3.0-or-later.
