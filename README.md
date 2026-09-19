# Quick Light

A fast, beautiful spotlight-style application search launcher for GNOME Shell.

Quick Light brings a macOS Spotlight and Raycast style floating search overlay to your GNOME desktop. Instead of switching to the fullscreen overview, invoke a sleek, centered search bar from anywhere to quickly launch applications, calculate, search files, or query Google in your default web browser.

---

## Features

- **Spotlight Search Modal**: Centered floating search bar with translucent glassmorphic styling and smooth fade/scale animations.
- **Search Prefixes & Bangs**: Instant web queries using built-in or custom prefixes (`yt`, `gh`, `wiki`, `r`, `so`, `g`, `ddg`, or DuckDuckGo-style `!yt`, `!gh`, `!wiki`).
- **Web Search Integration**: Search queries directly in your default browser on <kbd>Enter</kbd>, with smart local app fallback or instant prefix actions.
- **Prioritized Calculations**: Direct math expression parsing with GNOME Calculator prioritized over file results.
- **Multi-Monitor Support**: Automatically summons the search overlay to the active display where your mouse cursor is located, or lock to a preferred monitor.
- **Customizable Appearance**: Tailor corner curvature (pill vs square), border thickness/color, backdrop opacity, and font sizing to match your theme.
- **Native Libadwaita Preferences**: Modern GTK4 settings dialog with prefix manager and interactive shortcut recorder widget.
- **Top Panel Quick-Launch**: Optional status bar icon for mouse-friendly launching.
- **Modern GNOME Compatibility**: Engineered for GNOME Shell 46 through 50+ with smooth Clutter event-loop safety.

---

## Search Prefixes & Bangs

Type a prefix followed by your search query to search directly in your favorite engine or website:

| Prefix | Engine | Example |
| :--- | :--- | :--- |
| `g` or `!g` | Google | `g linux nvidia` |
| `yt` or `!yt` | YouTube | `yt lofi coding` |
| `gh` or `!gh` | GitHub | `gh boost asio` |
| `wiki` or `!wiki` | Wikipedia | `wiki distributed systems` |
| `r` or `!r` | Reddit | `r linux` |
| `so` or `!so` | Stack Overflow | `so boost asio` |
| `ddg` or `!ddg` | DuckDuckGo | `ddg privacy tips` |

*You can add, edit, delete, or reset custom search prefixes anytime in Extension Preferences.*

---

## Search Result Actions (Files, Images & PDFs)

Quick Light turns file search results into an efficient workflow tool:

| Action | Key Combination | Behavior |
| :--- | :--- | :--- |
| **Open** | <kbd>Enter</kbd> | Opens the selected file in its default application |
| **Quick Preview** | <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Opens an animated Quick Preview for **Images** & **PDFs** |
| **Reveal in Files** | <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Reveals the file highlighted in Nautilus / File Manager |
| **Copy Path** | <kbd>Ctrl</kbd> + <kbd>C</kbd> | Copies the absolute file path to system clipboard |

*While inside Quick Preview, press <kbd>Enter</kbd> to open the file in its default app, or <kbd>Esc</kbd> / <kbd>Space</kbd> to close the preview.*

---

## Default Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Super</kbd> + <kbd>Space</kbd> | Toggle Quick Light search modal |
| <kbd>Enter</kbd> | Launch app, open file, or execute search prefix |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Quick Preview (Images/PDFs) or Reveal in Files |
| <kbd>Ctrl</kbd> + <kbd>C</kbd> | Copy selected file's absolute path to clipboard |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> | Always search query in default web browser |
| <kbd>Escape</kbd> | Dismiss search window (or close Quick Preview) |

*Shortcuts and search behavior can be customized anytime in extension preferences.*

---

## License

GPL-3.0-or-later
