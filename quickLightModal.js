import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

const DEFAULT_SEARCH_PREFIXES = [
  { prefix: 'g', name: 'Google', url: 'https://www.google.com/search?q=%s', icon: 'system-search-symbolic' },
  { prefix: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', icon: 'video-x-generic-symbolic' },
  { prefix: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s', icon: 'software-properties-symbolic' },
  { prefix: 'wiki', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s', icon: 'accessories-dictionary-symbolic' },
  { prefix: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', icon: 'network-wired-symbolic' },
  { prefix: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', icon: 'help-about-symbolic' },
  { prefix: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', icon: 'web-browser-symbolic' },
];

/**
 * QuickLightModal is the spotlight overlay container widget.
 * It borrows the GNOME Shell overview search controller and entry field,
 * housing them in a centered, floating, glassmorphic window.
 */
export const QuickLightModal = GObject.registerClass(
  {},
  class QuickLightModal extends St.Widget {
    _init(extension) {
      super._init({
        name: 'quickLightModal',
        reactive: true,
        track_hover: true,
        can_focus: true,
        offscreen_redirect: Clutter.OffscreenRedirect.ALWAYS,
        layout_manager: new Clutter.BinLayout(),
      });

      this.set_pivot_point(0.5, 0.5);

      this._ext = extension;
      this._settings = extension.settings;
      this._monitorManager = extension.monitorManager;

      this._isVisible = false;
      this._isTransitioning = false;
      this._isClosing = false;

      // Inner vertical layout container
      this._box = new St.BoxLayout({
        name: 'quickLightBox',
        orientation: Clutter.Orientation.VERTICAL,
        reactive: true,
        track_hover: true,
        can_focus: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
      });
      this.add_child(this._box);

      // Search controller and entry references
      this._entry = null;
      this._entryParent = null;
      this._entryAllocId = 0;
      this._searchController = null;
      this._searchParent = null;
      this._searchResults = null;
      this._textChangedId = 0;
      this._textKeyPressId = 0;
      this._entryKeyPressId = 0;
      this._controllerKeyPressId = 0;
      this._resultsScrollId = 0;
      this._termsChangedId = 0;

      // Overview override hooks
      this._origOverviewToggle = null;
      this._origOverviewHide = null;

      // Event signal IDs
      this._stageKeyFocusId = 0;
      this._stageKeyPressId = 0;
      this._stageCaptureId = 0;
      this._windowCreatedId = 0;
      this._fullscreenId = 0;

      // Quick Preview & Toast overlays
      this._previewOverlay = null;
      this._activePreviewFile = null;
      this._toast = null;
      this._toastTimeoutId = 0;
      this._closeFailsafeId = 0;
      this._sourceIds = new Set();

      // Initial dimensions
      this._modalWidth = 620;
      this._modalHeight = 440;
      this._initialHeight = 64;

      this._setupWebSearchWidget();

      this.hide();
      this.opacity = 0;
    }

    /**
     * Tracked timeout helper to ensure all main loop sources are cleaned up on disable.
     */
    _addTimeout(priority, interval, callback) {
      let id = 0;
      id = GLib.timeout_add(priority, interval, () => {
        const res = callback();
        if (res === GLib.SOURCE_REMOVE) {
          this._sourceIds.delete(id);
        }
        return res;
      });
      this._sourceIds.add(id);
      return id;
    }

    /**
     * Tracked idle helper to ensure all main loop sources are cleaned up on disable.
     */
    _addIdle(priority, callback) {
      let id = 0;
      id = GLib.idle_add(priority, () => {
        const res = callback();
        if (res === GLib.SOURCE_REMOVE) {
          this._sourceIds.delete(id);
        }
        return res;
      });
      this._sourceIds.add(id);
      return id;
    }

    /**
     * Remove a tracked mainloop source ID.
     */
    _removeSource(id) {
      if (id && this._sourceIds.has(id)) {
        GLib.source_remove(id);
        this._sourceIds.delete(id);
      }
    }

    /**
     * Cancel and remove all tracked main loop sources.
     */
    _clearSources() {
      for (const id of this._sourceIds) {
        GLib.source_remove(id);
      }
      this._sourceIds.clear();
      this._toastTimeoutId = 0;
      this._closeFailsafeId = 0;
    }

    _setupWebSearchWidget() {
      this._webSearchItem = new St.Button({
        name: 'quickLightWebSearch',
        style_class: 'quick-light-web-search-item',
        can_focus: true,
        reactive: true,
        track_hover: true,
        visible: false,
      });

      const webBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style_class: 'quick-light-web-search-box',
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._webSearchIcon = new St.Icon({
        icon_name: 'system-search-symbolic',
        style_class: 'quick-light-web-search-icon',
      });

      this._webSearchLabel = new St.Label({
        text: 'Search Google…',
        style_class: 'quick-light-web-search-label',
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._webSearchBadge = new St.Label({
        text: '↵ Enter',
        style_class: 'quick-light-web-search-badge',
        y_align: Clutter.ActorAlign.CENTER,
      });

      webBox.add_child(this._webSearchIcon);
      webBox.add_child(this._webSearchLabel);
      webBox.add_child(this._webSearchBadge);
      this._webSearchItem.set_child(webBox);

      this._webSearchItem.connect('clicked', () => {
        const text = this._searchController?._text?.get_text() || '';
        const enableWeb = this._settings?.get_boolean('enable-web-search');
        if (enableWeb) {
          const prefixInfo = this._parseSearchPrefix(text);
          if (prefixInfo.matched && prefixInfo.query.length > 0) {
            this._openWebSearch(prefixInfo.query, prefixInfo.engine.url);
            return;
          }
        }
        this._openWebSearch(text.trim());
      });

      this._webSearchItem.connect('key-press-event', (actor, event) => {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space) {
          const text = this._searchController?._text?.get_text() || '';
          const enableWeb = this._settings?.get_boolean('enable-web-search');
          if (enableWeb) {
            const prefixInfo = this._parseSearchPrefix(text);
            if (prefixInfo.matched && prefixInfo.query.length > 0) {
              this._openWebSearch(prefixInfo.query, prefixInfo.engine.url);
              return Clutter.EVENT_STOP;
            }
          }
          this._openWebSearch(text.trim());
          return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab) {
          if (isShift || symbol === Clutter.KEY_ISO_Left_Tab) {
            if (this._searchResults?._defaultResult) {
              this._searchResults.navigateFocus(St.DirectionType.TAB_BACKWARD);
            } else {
              this._grabSearchFocus();
            }
          } else {
            this._grabSearchFocus();
          }
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      });

      this._webSearchItem.connect('notify::hover', () => {
        this._updateWebSearchBadge();
      });
    }

    /**
     * Dynamically update web search tile badge text based on focus and result availability.
     */
    _updateWebSearchBadge() {
      if (!this._webSearchBadge) return;

      const enableWeb = this._settings?.get_boolean('enable-web-search');
      if (!enableWeb) return;

      const text = this._searchController?._text?.get_text() || '';
      const prefixInfo = this._parseSearchPrefix(text);
      if (prefixInfo.matched && prefixInfo.query.length > 0) {
        this._webSearchBadge.set_text('↵ Enter');
        return;
      }

      // Contextual action shortcuts when a file result is active
      const fileResult = this._getSelectedFileResult();
      if (fileResult) {
        if (fileResult.isImage || fileResult.isPdf) {
          this._webSearchBadge.set_text('↵ Open  •  ^↵ Preview  •  ^C Copy');
        } else {
          this._webSearchBadge.set_text('↵ Open  •  ^↵ Reveal  •  ^C Copy');
        }
        return;
      }

      const mode = this._settings?.get_int('web-search-mode') ?? 0;
      const isItemFocused = this._webSearchItem?.has_key_focus();

      if (isItemFocused) {
        this._webSearchBadge.set_text('↵ Enter');
        return;
      }

      if (mode === 2) {
        // Mode 2: Always search Google on Enter
        this._webSearchBadge.set_text('↵ Enter');
      } else if (mode === 1) {
        // Mode 1: Shift+Enter only
        this._webSearchBadge.set_text('⇧↵ Shift+Enter');
      } else {
        // Mode 0: Smart Fallback (Google only if no search results appear)
        const hasResults = !!this._searchResults?._defaultResult;
        this._webSearchBadge.set_text(hasResults ? '⇧↵ Shift+Enter' : '↵ Enter');
      }
    }

    /**
     * Check whether a search query represents a mathematical expression or calculation.
     */
    _isMathQuery(query) {
      if (!query || typeof query !== 'string') return false;
      const text = query.trim();
      if (!text) return false;

      // 1. Math functions and constants
      if (/\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|log|ln|abs|pow|round|floor|ceil|exp|pi|tau)\b/i.test(text)) {
        return true;
      }

      // 2. Percentage expressions (e.g. "15% of 85000", "20%")
      if (/\d+\s*%\s*(of\s*\d+)?/i.test(text)) {
        return true;
      }

      // 3. Numbers combined with arithmetic operators (+, -, *, /, ^, =, ×, ÷)
      if (/[0-9]/.test(text) && /[\+\-\*\/\^\=x×÷]/.test(text)) {
        if (/[\d\)]\s*[\+\-\*\/\^\=×÷]\s*[\d\(]/.test(text) || /\d+\s*[\*\/x×÷]\s*\d+/.test(text)) {
          return true;
        }
        if (/^[0-9\s\+\-\*\/\^\%\(\)\.\,\=x×÷]+$/.test(text) && /[\+\*\/\^\=×÷]/.test(text)) {
          return true;
        }
      }

      return false;
    }

    /**
     * Dynamically prioritize Calculator search results above files,
     * and give Calculator absolute top priority on math queries.
     */
    _reorderSearchProviders(query = '') {
      if (!this._searchResults || !Array.isArray(this._searchResults._providers)) return;

      const text = (query || this._searchController?._text?.get_text() || '').trim();
      const isMath = this._isMathQuery(text);

      const getPriority = (provider) => {
        const id = provider?.id || provider?.appInfo?.get_id() || '';

        // If math query, Calculator has absolute top priority (#0 above everything)
        if (isMath && (id === 'org.gnome.Calculator.desktop' || id.toLowerCase().includes('calculator'))) {
          return 0;
        }

        if (id === 'applications') return 1;
        if (id === 'org.gnome.Calculator.desktop' || id.toLowerCase().includes('calculator')) return 2;
        if (id === 'org.gnome.Settings.desktop' || id.toLowerCase().includes('settings')) return 3;
        if (id === 'org.gnome.clocks.desktop' || id.toLowerCase().includes('clocks')) return 4;
        if (id === 'org.gnome.Calendar.desktop' || id.toLowerCase().includes('calendar')) return 5;
        if (id === 'org.gnome.Contacts.desktop' || id.toLowerCase().includes('contacts')) return 6;
        if (id === 'org.gnome.Characters.desktop' || id.toLowerCase().includes('characters')) return 7;
        // Files (Nautilus) should always be ranked lower than Calculator and core tools
        if (id === 'org.gnome.Nautilus.desktop' || id.toLowerCase().includes('nautilus')) return 20;
        if (id.toLowerCase().includes('chrome') || id.toLowerCase().includes('web') || id.toLowerCase().includes('search')) return 30;
        return 10;
      };

      // 1. Sort _providers array in place
      this._searchResults._providers.sort((a, b) => getPriority(a) - getPriority(b));

      // 2. Reorder child actor displays in _content
      const content = this._searchResults._content;
      if (content && typeof content.set_child_at_index === 'function') {
        let targetIndex = 0;
        for (const provider of this._searchResults._providers) {
          if (provider.display && provider.display.get_parent() === content) {
            try {
              content.set_child_at_index(provider.display, targetIndex);
              targetIndex++;
            } catch (e) {
              // ignore
            }
          }
        }
      }
    }

    get isVisible() {
      return this._isVisible;
    }

    /**
     * Safely toggle the modal visibility with re-entrancy prevention.
     */
    toggle() {
      if (Main.overview.visible) return;

      if (this._isVisible) {
        this.close();
      } else {
        this.open();
      }
    }

    /**
     * Open Quick Light search modal.
     */
    open() {
      if (this._isVisible || this._isTransitioning) return;
      if (Main.overview.visible) return;

      this._isClosing = false;
      this._acquireUI();
      this._layoutPosition();
      this._connectEvents();

      global.compositor?.disable_unredirect?.();

      this._isVisible = true;
      this._isTransitioning = true;
      this.show();

      const useAnimations = this._settings.get_boolean('enable-animations');
      const duration = this._settings.get_double('animation-duration') || 140;

      if (useAnimations) {
        this.opacity = 0;
        this.scale_x = 0.94;
        this.scale_y = 0.94;
        this.ease({
          opacity: 255,
          scale_x: 1.0,
          scale_y: 1.0,
          duration: duration,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          onComplete: () => {
            this._isTransitioning = false;
            this._grabSearchFocus();
          },
        });
      } else {
        this.opacity = 255;
        this.scale_x = 1.0;
        this.scale_y = 1.0;
        this._isTransitioning = false;
        this._grabSearchFocus();
      }
    }

    /**
     * Close Quick Light search modal.
     */
    close() {
      if (!this._isVisible) return;
      if (this._isClosing) return;

      this._isClosing = true;
      this._isTransitioning = false;
      this.remove_all_transitions?.();
      this._disconnectEvents();

      if (this._closeFailsafeId) {
        this._removeSource(this._closeFailsafeId);
        this._closeFailsafeId = 0;
      }

      // Release key focus immediately
      global.stage.set_key_focus(null);

      // Cleanly clear search entry text and searchController state
      if (this._entry) {
        this._entry.text = '';
      }
      if (this._searchController) {
        if (typeof this._searchController._origReset === 'function') {
          this._searchController._origReset.call(this._searchController);
        } else if (typeof this._searchController.reset === 'function') {
          this._searchController.reset();
        }
      }

      if (this._previewOverlay) {
        this._previewOverlay.hide();
        this._activePreviewFile = null;
      }

      const useAnimations = this._settings.get_boolean('enable-animations');
      const duration = this._settings.get_double('animation-duration') || 120;

      let finished = false;
      const finishClosing = () => {
        if (finished) return;
        finished = true;
        if (this._closeFailsafeId) {
          this._removeSource(this._closeFailsafeId);
          this._closeFailsafeId = 0;
        }
        this.opacity = 0;
        this.hide();
        this._isVisible = false;
        this._isTransitioning = false;
        this._isClosing = false;
        this._releaseUI();
        global.compositor?.enable_unredirect?.();
      };

      if (useAnimations) {
        // Failsafe timer in case Clutter transition onComplete is dropped
        this._closeFailsafeId = this._addTimeout(GLib.PRIORITY_DEFAULT, Math.round(duration) + 50, () => {
          this._closeFailsafeId = 0;
          finishClosing();
          return GLib.SOURCE_REMOVE;
        });

        this.ease({
          opacity: 0,
          scale_x: 0.94,
          scale_y: 0.94,
          duration: duration,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          onComplete: () => {
            finishClosing();
          },
        });
      } else {
        finishClosing();
      }
    }

    /**
     * Compute exact natural height of the modal when collapsed to search entry.
     */
    _updateInitialHeight() {
      const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;

      const [, modalNatHeight] = this.get_preferred_height(this._modalWidth);
      if (modalNatHeight > 0) {
        this._initialHeight = Math.round(modalNatHeight);
      } else {
        const [, entryNatHeight] = this._entry?.get_preferred_height(this._modalWidth) || [0, 48];
        const baseHeight = entryNatHeight > 0 ? entryNatHeight : (this._entry?.height > 0 ? this._entry.height : 48);
        this._initialHeight = Math.round(baseHeight + 20 * scaleFactor);
      }
    }

    /**
     * Calculate dimensions and position the modal on the designated monitor.
     */
    _layoutPosition() {
      const monitor = this._monitorManager.getTargetMonitor();
      if (!monitor) return;

      this._monitorManager.updateMonitorCount();

      const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
      const widthScale = this._settings.get_double('window-width-scale') || 0.15;
      const heightScale = this._settings.get_double('window-height-scale') || 0.15;

      this._modalWidth = Math.round(620 + (monitor.width / 2) * widthScale * scaleFactor);
      this._modalHeight = Math.round(440 + (monitor.height / 2) * heightScale * scaleFactor);

      // Measure height of search entry with exact preferred height
      this._updateInitialHeight();

      const posX = Math.round(monitor.x + (monitor.width - this._modalWidth) / 2);
      const posY = Math.round(monitor.y + (monitor.height - this._modalHeight) / 3);

      this.set_position(posX, posY);
      this.set_size(this._modalWidth, this._initialHeight);
    }

    /**
     * Reparent GNOME's overview search entry and search controller into our box.
     */
    _acquireUI() {
      if (this._entry) return;

      // Intercept overview toggle so it doesn't fight for focus
      if (!Main.overview._origToggle) {
        Main.overview._origToggle = Main.overview.toggle;
        Main.overview.toggle = () => {
          if (this._isVisible) {
            this._grabSearchFocus();
          } else {
            Main.overview._origToggle();
          }
        };
      }

      // Borrow searchEntry
      this._entry = Main.overview.searchEntry;
      if (this._entry) {
        this._entryParent = this._entry.get_parent();
        this._entry.add_style_class_name('quick-light-entry');
        this._entry.x_expand = true;
        this._entry.x_align = Clutter.ActorAlign.FILL;
        this._entry.y_align = Clutter.ActorAlign.CENTER;
        if (this._entryParent) {
          this._entryParent.remove_child(this._entry);
        }
        this._box.add_child(this._entry);
        this._entry.show();

        this._entryAllocId = this._entry.connect('notify::allocation', () => {
          if (!this._searchController?.visible && this._isVisible) {
            const [, natH] = this.get_preferred_height(this._modalWidth);
            if (natH > 0 && Math.abs(natH - this.height) > 1) {
              this._initialHeight = Math.round(natH);
              this.set_size(this._modalWidth, this._initialHeight);
            }
          }
        });

        // Intercept Escape directly on the search entry
        this._entryKeyPressId = this._entry.connect('key-press-event', (actor, event) => {
          if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        });
      }

      // Borrow searchController
      this._searchController = Main.overview.searchController;
      if (this._searchController) {
        this._searchParent = this._searchController.get_parent();
        this._searchResults = this._searchController._searchResults;

        // Intercept Escape via searchController.reset() and _onKeyPress
        if (!this._searchController._origReset) {
          this._searchController._origReset = this._searchController.reset;
          this._searchController.reset = () => {
            if (this._isVisible) {
              this.close();
              return;
            }
            this._searchController._origReset.call(this._searchController);
          };
        }

        if (typeof this._searchController._onKeyPress === 'function' && !this._searchController._origOnKeyPress) {
          this._searchController._origOnKeyPress = this._searchController._onKeyPress;
          this._searchController._onKeyPress = (entry, event) => {
            if (this._isVisible && event.get_key_symbol() === Clutter.KEY_Escape) {
              this.close();
              return Clutter.EVENT_STOP;
            }
            return this._searchController._origOnKeyPress.call(this._searchController, entry, event);
          };
        }

        this._controllerKeyPressId = this._searchController.connect('key-press-event', (actor, event) => {
          if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        });

        // Hook into result activation to dismiss modal instantly or perform smart web search fallback
        if (this._searchResults && !this._searchResults._origActivateDefault) {
          this._searchResults._origActivateDefault = this._searchResults.activateDefault;
          this._searchResults.activateDefault = () => {
            const text = this._searchController?._text?.get_text() || '';
            const query = text.trim();
            const enableWeb = this._settings.get_boolean('enable-web-search');
            const mode = this._settings.get_int('web-search-mode');

            // 1. Search prefix intent takes highest priority on Enter (e.g. yt lofi, !gh asio)
            if (enableWeb) {
              const prefixInfo = this._parseSearchPrefix(text);
              if (prefixInfo.matched && prefixInfo.query.length > 0) {
                this._openWebSearch(prefixInfo.query, prefixInfo.engine.url);
                return;
              }
            }

            // 2. Explicit web search mode 2 (Always search Google on Enter)
            if (enableWeb && mode === 2 && query.length > 0) {
              this._openWebSearch(query);
              return;
            }

            // 3. Immediately check for any currently highlighted, focused, or default result
            const activeResult = this._findSelectedResult();
            if (activeResult) {
              this.opacity = 0;
              if (typeof activeResult.activate === 'function') {
                activeResult.activate();
              } else if (typeof this._searchResults._origActivateDefault === 'function') {
                this._searchResults._origActivateDefault();
              }
              this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.close();
                return GLib.SOURCE_REMOVE;
              });
              return;
            }

            // 4. Synchronous AppSystem search fallback: handles fast-typed app names (e.g. "Disc" -> Discord)
            if (query.length > 0) {
              const appSys = Shell.AppSystem.get_default();
              if (appSys) {
                const installed = appSys.get_installed() || [];
                const q = query.toLowerCase();

                // Exact name or exact id match
                let matchedApp = installed.find(app => {
                  const name = app.get_name()?.toLowerCase() || '';
                  const id = app.get_id()?.toLowerCase() || '';
                  return name === q || id === q || id === `${q}.desktop`;
                });

                // Prefix match (e.g. "disc" -> "Discord")
                if (!matchedApp) {
                  matchedApp = installed.find(app => {
                    const name = app.get_name()?.toLowerCase() || '';
                    const id = app.get_id()?.toLowerCase() || '';
                    return name.startsWith(q) || id.startsWith(q);
                  });
                }

                // Substring match
                if (!matchedApp) {
                  matchedApp = installed.find(app => {
                    const name = app.get_name()?.toLowerCase() || '';
                    const id = app.get_id()?.toLowerCase() || '';
                    return name.includes(q) || id.includes(q);
                  });
                }

                if (matchedApp) {
                  this.opacity = 0;
                  matchedApp.activate();
                  this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this.close();
                    return GLib.SOURCE_REMOVE;
                  });
                  return;
                }
              }
            }

            // 5. If asynchronous search providers are still running, wait for results before fallback
            if (this._searchResults.searchInProgress) {
              let checkTicks = 0;
              this._addTimeout(GLib.PRIORITY_DEFAULT, 20, () => {
                checkTicks++;
                const res = this._findSelectedResult();
                if (res) {
                  this.opacity = 0;
                  if (typeof res.activate === 'function') {
                    res.activate();
                  } else if (typeof this._searchResults?._origActivateDefault === 'function') {
                    this._searchResults._origActivateDefault();
                  }
                  this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this.close();
                    return GLib.SOURCE_REMOVE;
                  });
                  return GLib.SOURCE_REMOVE;
                }

                // After up to 800ms or when search finishes
                if (!this._searchResults?.searchInProgress || checkTicks > 40) {
                  const finalRes = this._findSelectedResult();
                  if (finalRes) {
                    this.opacity = 0;
                    if (typeof finalRes.activate === 'function') {
                      finalRes.activate();
                    } else if (typeof this._searchResults?._origActivateDefault === 'function') {
                      this._searchResults._origActivateDefault();
                    }
                    this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                      this.close();
                      return GLib.SOURCE_REMOVE;
                    });
                  } else if (enableWeb && query.length > 0 && mode === 0) {
                    this._openWebSearch(query);
                  }
                  return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
              });
              return;
            }

            // 6. No local results found: opt for Google search only on Smart Fallback (mode 0)
            if (enableWeb && query.length > 0 && mode === 0) {
              this._openWebSearch(query);
            }
          };

          if (this._searchResults._scrollView) {
            this._resultsScrollId = this._searchResults._scrollView.connect(
              'notify::visible',
              () => this._updateWebSearchBadge(),
            );
          }
          this._termsChangedId = this._searchResults.connect(
            'terms-changed',
            () => this._updateWebSearchBadge(),
          );

          if (!this._searchResults._origMaybeSetInitialSelection) {
            this._searchResults._origMaybeSetInitialSelection = this._searchResults._maybeSetInitialSelection;
            this._searchResults._maybeSetInitialSelection = () => {
              this._reorderSearchProviders();
              this._searchResults._origMaybeSetInitialSelection();
            };
          }
          this._reorderSearchProviders();
        }

        if (this._searchParent) {
          this._searchParent.remove_child(this._searchController);
        }
        this._box.add_child(this._searchController);
        this._searchController.hide();

        // Add web search action tile at bottom of box
        if (this._webSearchItem) {
          if (this._webSearchItem.get_parent()) {
            this._webSearchItem.get_parent().remove_child(this._webSearchItem);
          }
          this._box.add_child(this._webSearchItem);
          this._webSearchItem.hide();
        }

        // Intercept Enter key for Google search
        if (this._searchController._text) {
          this._textKeyPressId = this._searchController._text.connect(
            'key-press-event',
            (actor, event) => {
              const symbol = event.get_key_symbol();
              const state = event.get_state();
              const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
              const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

              // If Quick Preview is open, handle its dismissal or activation
              if (this._previewOverlay?.visible) {
                if (symbol === Clutter.KEY_Escape || symbol === Clutter.KEY_space) {
                  this._hideQuickPreview();
                  return Clutter.EVENT_STOP;
                }
                if (isCtrl && (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter)) {
                  this._hideQuickPreview();
                  return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                  this._openActivePreviewFile();
                  return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_STOP;
              }

              if (symbol === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
              }

              // Ctrl+C: copy file path if a file result is active and no text in entry is selected
              if (isCtrl && (symbol === Clutter.KEY_c || symbol === Clutter.KEY_C)) {
                const hasSelection = actor.get_selection && actor.get_selection().length > 0;
                if (!hasSelection) {
                  const fileResult = this._getSelectedFileResult();
                  if (fileResult) {
                    this._copyFilePath(fileResult);
                    return Clutter.EVENT_STOP;
                  }
                }
              }

              if (symbol === Clutter.KEY_Down) {
                if (!this._searchResults?._defaultResult && this._webSearchItem?.visible) {
                  this._webSearchItem.grab_key_focus();
                  return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
              }

              const isEnter = (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter);
              if (!isEnter) return Clutter.EVENT_PROPAGATE;

              // Ctrl+Enter on file result: Quick Preview (Image/PDF) or Reveal in Files
              if (isCtrl) {
                const fileResult = this._getSelectedFileResult();
                if (fileResult) {
                  if (fileResult.isImage || fileResult.isPdf) {
                    this._showQuickPreview(fileResult);
                  } else {
                    this._revealInFileManager(fileResult.file);
                  }
                  return Clutter.EVENT_STOP;
                }
              }

              const text = this._searchController._text.get_text() || '';
              const query = text.trim();
              if (!query) return Clutter.EVENT_PROPAGATE;

              const enableWeb = this._settings.get_boolean('enable-web-search');
              const mode = this._settings.get_int('web-search-mode');

              // 1. Shift+Enter -> Always web search
              if (isShift && enableWeb) {
                this._openWebSearch(query);
                return Clutter.EVENT_STOP;
              }

              // 2. Search prefix intent (e.g. yt lofi, gh boost, !wiki distributed systems, etc.)
              if (enableWeb) {
                const prefixInfo = this._parseSearchPrefix(text);
                if (prefixInfo.matched && prefixInfo.query.length > 0) {
                  this._openWebSearch(prefixInfo.query, prefixInfo.engine.url);
                  return Clutter.EVENT_STOP;
                }
              }

              // 3. Mode 2: Always search Google on Enter
              if (enableWeb && mode === 2) {
                this._openWebSearch(query);
                return Clutter.EVENT_STOP;
              }

              // 4. If an active or selected result is visible, activate it directly!
              const activeResult = this._findSelectedResult();
              if (activeResult) {
                this.opacity = 0;
                if (typeof activeResult.activate === 'function') {
                  activeResult.activate();
                } else if (typeof this._searchResults?._origActivateDefault === 'function') {
                  this._searchResults._origActivateDefault();
                }
                this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                  this.close();
                  return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_STOP;
              }

              // Otherwise propagate to activateDefault to handle local result activation or fallback
              return Clutter.EVENT_PROPAGATE;
            },
          );

          // When text changes, expand modal and update web search bar
          this._textChangedId = this._searchController._text.connect(
            'text-changed',
            () => {
              const text = this._searchController._text.get_text() || '';
              const query = text.trim();
              const enableWeb = this._settings.get_boolean('enable-web-search');

              if (query.length > 0) {
                this.set_size(this._modalWidth, this._modalHeight);
                this._searchController.show();
                this._reorderSearchProviders(query);

                if (enableWeb) {
                  const prefixInfo = this._parseSearchPrefix(text);
                  if (prefixInfo.matched) {
                    const engineName = prefixInfo.engine.name || 'Web';
                    if (prefixInfo.query.length > 0) {
                      this._webSearchLabel.set_text(`Search ${engineName} for "${prefixInfo.query}"`);
                    } else {
                      this._webSearchLabel.set_text(`Search ${engineName}…`);
                    }
                    if (this._webSearchIcon && prefixInfo.engine.icon) {
                      this._webSearchIcon.set_icon_name(prefixInfo.engine.icon);
                    }
                  } else {
                    this._webSearchLabel.set_text(`Search Google for "${query}"`);
                    if (this._webSearchIcon) {
                      this._webSearchIcon.set_icon_name('system-search-symbolic');
                    }
                  }
                  this._updateWebSearchBadge();
                  this._webSearchItem.show();
                } else {
                  this._webSearchItem.hide();
                }
              } else {
                this._searchController.hide();
                this._webSearchItem.hide();
                this._updateInitialHeight();
                this.set_size(this._modalWidth, this._initialHeight);
                this._grabSearchFocus();
              }
            },
          );
        }
      }
    }

    /**
     * Restore borrowed search UI back to GNOME Shell's overview.
     * Crucial Clutter 18 safety: hide elements before detaching!
     */
    _releaseUI() {
      if (this._textChangedId && this._searchController?._text) {
        this._searchController._text.disconnect(this._textChangedId);
        this._textChangedId = 0;
      }

      if (this._textKeyPressId && this._searchController?._text) {
        this._searchController._text.disconnect(this._textKeyPressId);
        this._textKeyPressId = 0;
      }

      if (this._controllerKeyPressId && this._searchController) {
        this._searchController.disconnect(this._controllerKeyPressId);
        this._controllerKeyPressId = 0;
      }

      if (this._searchController?._origReset) {
        this._searchController.reset = this._searchController._origReset;
        delete this._searchController._origReset;
      }

      if (this._searchController?._origOnKeyPress) {
        this._searchController._onKeyPress = this._searchController._origOnKeyPress;
        delete this._searchController._origOnKeyPress;
      }

      if (this._webSearchItem) {
        this._webSearchItem.hide();
        if (this._webSearchItem.get_parent() === this._box) {
          this._box.remove_child(this._webSearchItem);
        }
      }

      if (this._searchController) {
        this._searchController.hide();
        if (this._searchController.get_parent() === this._box) {
          this._box.remove_child(this._searchController);
        }
        if (this._searchParent) {
          this._searchParent.add_child(this._searchController);
        }

        if (this._resultsScrollId && this._searchResults?._scrollView) {
          this._searchResults._scrollView.disconnect(this._resultsScrollId);
          this._resultsScrollId = 0;
        }

        if (this._termsChangedId && this._searchResults) {
          this._searchResults.disconnect(this._termsChangedId);
          this._termsChangedId = 0;
        }

        if (this._searchResults?._origMaybeSetInitialSelection) {
          this._searchResults._maybeSetInitialSelection = this._searchResults._origMaybeSetInitialSelection;
          delete this._searchResults._origMaybeSetInitialSelection;
        }

        if (this._searchResults?._origActivateDefault) {
          this._searchResults.activateDefault = this._searchResults._origActivateDefault;
          delete this._searchResults._origActivateDefault;
        }

        this._searchController = null;
        this._searchParent = null;
        this._searchResults = null;
      }

      if (this._entry) {
        if (this._entryAllocId) {
          this._entry.disconnect(this._entryAllocId);
          this._entryAllocId = 0;
        }
        if (this._entryKeyPressId) {
          this._entry.disconnect(this._entryKeyPressId);
          this._entryKeyPressId = 0;
        }
        this._entry.remove_style_class_name('quick-light-entry');
        this._entry.hide(); // Unmap before detaching to avoid Clutter 18 assertion!
        if (this._entry.get_parent() === this._box) {
          this._box.remove_child(this._entry);
        }
        if (this._entryParent) {
          this._entryParent.add_child(this._entry);
          this._entry.show();
        }
        this._entry = null;
        this._entryParent = null;
      }

      if (Main.overview._origToggle) {
        Main.overview.toggle = Main.overview._origToggle;
        delete Main.overview._origToggle;
      }

      if (this._previewOverlay) {
        this._previewOverlay.hide();
        if (this._previewOverlay.get_parent() === this) {
          this.remove_child(this._previewOverlay);
        }
        this._previewOverlay = null;
        this._activePreviewFile = null;
      }

      if (this._toastTimeoutId) {
        this._removeSource(this._toastTimeoutId);
        this._toastTimeoutId = 0;
      }

      if (this._toast) {
        this._toast.hide();
        if (this._toast.get_parent() === this) {
          this.remove_child(this._toast);
        }
        this._toast = null;
      }
    }

    /**
     * Retrieve configured search prefixes from GSettings or fallback to defaults.
     * @returns {Array<{prefix: string, name: string, url: string, icon?: string}>}
     */
    _getSearchPrefixes() {
      try {
        const jsonStr = this._settings?.get_string('search-prefixes');
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn(`[Quick Light] Failed to parse search-prefixes: ${e.message}`);
      }
      return DEFAULT_SEARCH_PREFIXES;
    }

    /**
     * Parse input text for a search prefix (e.g. "yt lofi coding", "gh boost", "!wiki linux", "g query").
     * @param {string} rawQuery
     * @returns {{matched: boolean, engine: Object|null, query: string}}
     */
    _parseSearchPrefix(rawQuery) {
      if (!rawQuery || typeof rawQuery !== 'string') {
        return { matched: false, engine: null, query: '' };
      }

      const trimmed = rawQuery.trimStart();
      if (!trimmed) {
        return { matched: false, engine: null, query: '' };
      }

      const spaceIndex = trimmed.search(/\s/);
      let token = '';
      let query = '';
      let hasSpace = false;

      if (spaceIndex !== -1) {
        hasSpace = true;
        token = trimmed.substring(0, spaceIndex).trim();
        query = trimmed.substring(spaceIndex).trim();
      } else {
        hasSpace = false;
        token = trimmed;
        query = '';
      }

      // If no space, only consider it a prefix intent if it starts with '!' or is '?'
      if (!hasSpace && !token.startsWith('!') && token !== '?') {
        return { matched: false, engine: null, query: '' };
      }

      const engines = this._getSearchPrefixes();
      const lowerToken = token.toLowerCase();
      const normToken = lowerToken.replace(/^!+/, '');

      // Legacy/universal '?' shortcut
      if (lowerToken === '?' || normToken === '?') {
        const googleEngine = engines.find(
          (e) => e.prefix.toLowerCase() === 'g' || e.prefix.toLowerCase() === '!g',
        ) || {
          prefix: 'g',
          name: 'Google',
          url: this._settings?.get_string('web-search-engine-url') || 'https://www.google.com/search?q=%s',
          icon: 'system-search-symbolic',
        };
        return {
          matched: true,
          engine: googleEngine,
          query,
        };
      }

      for (const engine of engines) {
        if (!engine.prefix) continue;
        const lowerPrefix = engine.prefix.toLowerCase();
        const normPrefix = lowerPrefix.replace(/^!+/, '');

        if (
          lowerToken === lowerPrefix ||
          normToken === normPrefix ||
          lowerToken === `!${normPrefix}` ||
          `!${lowerToken}` === lowerPrefix
        ) {
          return {
            matched: true,
            engine,
            query,
          };
        }
      }

      return { matched: false, engine: null, query: '' };
    }

    /**
     * Launch web search with query in the user's default browser.
     * @param {string} query - The search query
     * @param {string} [customUrlTemplate] - Optional URL template containing %s
     */
    _openWebSearch(query, customUrlTemplate = null) {
      if (!query || !query.trim()) return;

      const template = customUrlTemplate || this._settings?.get_string('web-search-engine-url') || 'https://www.google.com/search?q=%s';
      const url = template.replace('%s', encodeURIComponent(query.trim()));

      this.opacity = 0;
      this.close();

      this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
          Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (err) {
          try {
            Gio.Subprocess.new(['xdg-open', url], Gio.SubprocessFlags.NONE);
          } catch (e) {
            console.warn(`[Quick Light] Error opening web search: ${e.message}`);
          }
        }
        return GLib.SOURCE_REMOVE;
      });
    }

    /**
     * Find currently selected or default result actor in the search results view.
     */
    _findSelectedResult() {
      if (!this._searchResults) return null;

      // 1. Check current keyboard focus on stage
      const currentFocus = global.stage.get_key_focus();
      if (currentFocus && this._searchResults.contains(currentFocus)) {
        let actor = currentFocus;
        while (actor && actor !== this._searchResults) {
          if (typeof actor.activate === 'function') {
            return actor;
          }
          actor = actor.get_parent();
        }
      }

      // 2. Default result designated by search results view
      if (this._searchResults._defaultResult) {
        return this._searchResults._defaultResult;
      }

      // 3. Scan providers for any selected item or first visible result
      const providers = this._searchResults._providerList ?? this._searchResults._providers;
      if (Array.isArray(providers)) {
        for (const provider of providers) {
          const display = provider?.display;
          if (!display || !display.visible) continue;

          if (display._selected && typeof display._selected.activate === 'function') {
            return display._selected;
          }

          if (display._content) {
            for (const child of display._content) {
              if (child.has_style_pseudo_class?.('selected') && typeof child.activate === 'function') {
                return child;
              }
            }
          }

          if (display._grid) {
            for (const child of display._grid) {
              if (child.has_style_pseudo_class?.('selected') && typeof child.activate === 'function') {
                return child;
              }
            }
          }
        }

        // Check for the first result from the top visible provider (e.g. Applications)
        for (const provider of providers) {
          const display = provider?.display;
          if (!display || !display.visible) continue;

          if (typeof display.getFirstResult === 'function') {
            const first = display.getFirstResult();
            if (first && typeof first.activate === 'function') {
              return first;
            }
          }
        }
      }

      return null;
    }

    /**
     * Get the active or focused file search result if one exists.
     * @returns {{file: Gio.File, filePath: string, resultActor: Object, isImage: boolean, isPdf: boolean, name: string, size: number}|null}
     */
    _getSelectedFileResult() {
      if (!this._searchResults) return null;

      const currentFocus = global.stage.get_key_focus();
      let candidate = null;

      // 1. If keyboard focus is inside search results, find the containing SearchResult actor
      if (currentFocus && this._searchResults.contains(currentFocus)) {
        let actor = currentFocus;
        while (actor && actor !== this._searchResults) {
          if (actor.metaInfo || actor.provider) {
            candidate = actor;
            break;
          }
          actor = actor.get_parent();
        }
      }

      // 2. Otherwise fallback to the default result
      if (!candidate && this._searchResults._defaultResult) {
        candidate = this._searchResults._defaultResult;
      }

      if (!candidate) return null;

      return this._extractFileInfoFromResult(candidate);
    }

    /**
     * Inspect a SearchResult actor and determine if it represents a local file.
     * @param {Object} actor - The SearchResult actor
     * @returns {Object|null}
     */
    _extractFileInfoFromResult(actor) {
      if (!actor) return null;

      const meta = actor.metaInfo;
      const provider = actor.provider;
      const provId = (provider?.id || provider?.appInfo?.get_id() || '').toLowerCase();

      let uriOrPath = meta?.id || '';
      if (!uriOrPath && typeof actor.getId === 'function') {
        uriOrPath = actor.getId();
      }

      let file = null;
      if (typeof uriOrPath === 'string') {
        if (uriOrPath.startsWith('file://')) {
          try { file = Gio.File.new_for_uri(uriOrPath); } catch (e) {}
        } else if (uriOrPath.startsWith('/')) {
          try { file = Gio.File.new_for_path(uriOrPath); } catch (e) {}
        }
      }

      // If not yet found, check meta.description or fallback for Nautilus provider
      if (!file && meta?.description) {
        const desc = meta.description.trim();
        if (desc.startsWith('/') || desc.startsWith('~')) {
          const p = desc.startsWith('~') ? desc.replace(/^~/, GLib.get_home_dir()) : desc;
          try {
            const testFile = Gio.File.new_for_path(p);
            if (testFile.query_exists(null)) file = testFile;
          } catch (e) {}
        }
      }

      if (!file && (provId.includes('nautilus') || provId.includes('files'))) {
        try {
          const testFile = Gio.File.new_for_commandline_arg(uriOrPath);
          if (testFile.query_exists(null)) file = testFile;
        } catch (e) {}
      }

      if (!file) return null;

      try {
        if (!file.query_exists(null)) return null;

        const info = file.query_info(
          'standard::content-type,standard::size,standard::display-name',
          Gio.FileQueryInfoFlags.NONE,
          null,
        );

        const filePath = file.get_path();
        const contentType = info.get_content_type() || '';
        const size = info.get_size() || 0;
        const name = info.get_display_name() || file.get_basename();

        const ext = (file.get_basename() || '').split('.').pop().toLowerCase();
        const imageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'tiff', 'avif'];

        const isImage = contentType.startsWith('image/') ||
                        Gio.content_type_is_a(contentType, 'image/*') ||
                        imageExtensions.includes(ext);

        const isPdf = contentType === 'application/pdf' ||
                      Gio.content_type_is_a(contentType, 'application/pdf') ||
                      ext === 'pdf';

        return {
          file,
          filePath,
          resultActor: actor,
          isImage,
          isPdf,
          name,
          size,
          contentType,
        };
      } catch (e) {
        return null;
      }
    }

    /**
     * Copy the path of a file to system clipboard and show toast confirmation.
     */
    _copyFilePath(fileResult) {
      if (!fileResult?.filePath) return;

      St.Clipboard.get_default().set_text(
        St.ClipboardType.CLIPBOARD,
        fileResult.filePath,
      );

      this._showToast(`✓ Copied: ${fileResult.filePath}`);
    }

    /**
     * Display a transient glassmorphic toast notification inside the modal.
     */
    _showToast(message) {
      if (!this._toast) {
        this._toast = new St.Label({
          style_class: 'quick-light-toast',
          y_align: Clutter.ActorAlign.CENTER,
          x_align: Clutter.ActorAlign.CENTER,
          opacity: 0,
        });
        this.add_child(this._toast);
      }

      this._toast.set_text(message);
      this._toast.show();
      this._toast.remove_all_transitions();

      const toastWidth = Math.min(540, Math.max(160, message.length * 8 + 32));
      this._toast.set_width(toastWidth);
      this._toast.set_position(
        Math.max(10, Math.floor((this.width - toastWidth) / 2)),
        this.height - 48,
      );

      if (this._toastTimeoutId) {
        this._removeSource(this._toastTimeoutId);
        this._toastTimeoutId = 0;
      }

      this._toast.ease({
        opacity: 255,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          this._toastTimeoutId = this._addTimeout(GLib.PRIORITY_DEFAULT, 1600, () => {
            this._toastTimeoutId = 0;
            if (this._toast && this._toast.visible) {
              this._toast.ease({
                opacity: 0,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                  this._toast?.hide();
                },
              });
            }
            return GLib.SOURCE_REMOVE;
          });
        },
      });
    }

    /**
     * Reveal a file in Nautilus / GNOME Files.
     */
    _revealInFileManager(file) {
      if (!file) return;

      const uri = file.get_uri();
      const filePath = file.get_path();

      this.opacity = 0;
      this.close();

      this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
          const bus = Gio.DBus.session;
          bus.call(
            'org.freedesktop.FileManager1',
            '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1',
            'ShowItems',
            new GLib.Variant('(ass)', [[uri], '']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
              try {
                connection.call_finish(res);
              } catch (e) {
                try {
                  Gio.Subprocess.new(['nautilus', '--select', filePath], Gio.SubprocessFlags.NONE);
                } catch (err) {
                  console.warn(`[Quick Light] Error revealing file: ${err.message}`);
                }
              }
            },
          );
        } catch (e) {
          try {
            Gio.Subprocess.new(['nautilus', '--select', filePath], Gio.SubprocessFlags.NONE);
          } catch (err) {
            console.warn(`[Quick Light] Error revealing file: ${err.message}`);
          }
        }
        return GLib.SOURCE_REMOVE;
      });
    }

    /**
     * Show Quick Preview overlay for Image or PDF files.
     */
    _showQuickPreview(fileResult) {
      if (!fileResult) return;

      if (!this._previewOverlay) {
        this._previewOverlay = new St.Widget({
          style_class: 'quick-light-preview-overlay',
          layout_manager: new Clutter.BinLayout(),
          reactive: true,
          can_focus: true,
          visible: false,
          x_expand: true,
          y_expand: true,
        });

        // Click outside card closes preview
        this._previewOverlay.connect('button-press-event', (actor, event) => {
          if (event.get_source() === this._previewOverlay) {
            this._hideQuickPreview();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        });

        this.add_child(this._previewOverlay);
      }

      this._activePreviewFile = fileResult;
      this._previewOverlay.destroy_all_children();

      const card = new St.BoxLayout({
        style_class: 'quick-light-preview-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        x_expand: true,
        y_expand: true,
      });

      // 1. Header
      const headerBox = new St.BoxLayout({
        style_class: 'quick-light-preview-header',
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
      });

      const iconName = fileResult.isImage ? 'image-x-generic-symbolic' : 'application-pdf-symbolic';
      const typeIcon = new St.Icon({
        icon_name: iconName,
        style_class: 'quick-light-web-search-icon',
        y_align: Clutter.ActorAlign.CENTER,
      });
      headerBox.add_child(typeIcon);

      const titleVBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        margin_left: 8,
      });

      const titleLabel = new St.Label({
        text: fileResult.name || fileResult.file.get_basename(),
        style_class: 'quick-light-preview-title',
      });
      titleVBox.add_child(titleLabel);

      // Format metadata: size & dimensions
      let metaText = this._formatFileSize(fileResult.size);
      if (fileResult.isImage && fileResult.filePath) {
        try {
          const [info, w, h] = GdkPixbuf.Pixbuf.get_file_info(fileResult.filePath);
          if (w && h) metaText += `  •  ${w} × ${h} px`;
        } catch (e) {}
      } else if (fileResult.isPdf) {
        metaText += '  •  PDF Document';
      }

      const metaLabel = new St.Label({
        text: metaText,
        style_class: 'quick-light-preview-meta',
      });
      titleVBox.add_child(metaLabel);
      headerBox.add_child(titleVBox);

      const closeBtn = new St.Button({
        style_class: 'quick-light-preview-close-btn',
        child: new St.Icon({
          icon_name: 'window-close-symbolic',
          icon_size: 14,
        }),
        can_focus: true,
      });
      closeBtn.connect('clicked', () => this._hideQuickPreview());
      headerBox.add_child(closeBtn);

      card.add_child(headerBox);

      // 2. Image / Preview Viewport
      const contentBox = new St.Bin({
        style_class: 'quick-light-preview-content-box',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
      });

      if (fileResult.isImage) {
        contentBox.style = `
          background-image: url("${fileResult.filePath}");
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
        `;
      } else if (fileResult.isPdf) {
        const previewPath = this._getPdfPreviewPath(fileResult);
        if (previewPath) {
          contentBox.style = `
            background-image: url("${previewPath}");
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
          `;
        } else {
          this._generatePdfPreview(fileResult, (generatedPath) => {
            if (this._activePreviewFile === fileResult && contentBox) {
              contentBox.style = `
                background-image: url("${generatedPath}");
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
              `;
            }
          });
        }
      }

      card.add_child(contentBox);

      // 3. Footer with shortcut hints
      const footerBox = new St.BoxLayout({
        style_class: 'quick-light-preview-footer',
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
      });

      const enterBadge = new St.Label({
        text: '↵ Enter',
        style_class: 'quick-light-preview-key-badge',
      });
      const enterHint = new St.Label({
        text: 'Open File   ',
        style_class: 'quick-light-preview-hint',
        y_align: Clutter.ActorAlign.CENTER,
      });

      const escBadge = new St.Label({
        text: 'Esc / Space',
        style_class: 'quick-light-preview-key-badge',
      });
      const escHint = new St.Label({
        text: 'Close Preview',
        style_class: 'quick-light-preview-hint',
        y_align: Clutter.ActorAlign.CENTER,
      });

      footerBox.add_child(enterBadge);
      footerBox.add_child(enterHint);
      footerBox.add_child(escBadge);
      footerBox.add_child(escHint);

      card.add_child(footerBox);
      this._previewOverlay.set_child(card);

      // Animate opening
      this._previewOverlay.show();
      this._previewOverlay.opacity = 0;
      this._previewOverlay.set_scale(0.94, 0.94);
      this._previewOverlay.set_pivot_point(0.5, 0.5);

      this._previewOverlay.ease({
        opacity: 255,
        scale_x: 1.0,
        scale_y: 1.0,
        duration: 200,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });

      this._previewOverlay.grab_key_focus();
    }

    _hideQuickPreview() {
      if (!this._previewOverlay || !this._previewOverlay.visible) return;

      this._previewOverlay.remove_all_transitions();
      this._previewOverlay.ease({
        opacity: 0,
        scale_x: 0.95,
        scale_y: 0.95,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          this._previewOverlay.hide();
          this._activePreviewFile = null;
          this._grabSearchFocus();
        },
      });
    }

    _openActivePreviewFile() {
      if (!this._activePreviewFile) return;

      const fileObj = this._activePreviewFile;
      this.opacity = 0;
      this.close();

      this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
          if (fileObj.resultActor && typeof fileObj.resultActor.activate === 'function') {
            fileObj.resultActor.activate();
          } else if (fileObj.file) {
            Gio.AppInfo.launch_default_for_uri(fileObj.file.get_uri(), null);
          }
        } catch (e) {
          try {
            Gio.Subprocess.new(['xdg-open', fileObj.filePath], Gio.SubprocessFlags.NONE);
          } catch (err) {
            console.warn(`[Quick Light] Error opening file: ${err.message}`);
          }
        }
        return GLib.SOURCE_REMOVE;
      });
    }

    _formatFileSize(bytes) {
      if (!bytes || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      let val = bytes;
      while (val >= 1024 && i < units.length - 1) {
        val /= 1024;
        i++;
      }
      return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    _getPdfPreviewPath(fileResult) {
      const uri = fileResult.file.get_uri();
      const md5 = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uri, -1);
      const home = GLib.get_home_dir();
      const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'quick-light', 'pdf']);

      const candidatePaths = [
        `${home}/.cache/thumbnails/large/${md5}.png`,
        `${home}/.cache/thumbnails/normal/${md5}.png`,
        `${cacheDir}/ql_pdf_${md5}-1.png`,
        `${cacheDir}/ql_pdf_${md5}-01.png`,
      ];

      for (const p of candidatePaths) {
        if (GLib.file_test(p, GLib.FileTest.EXISTS)) {
          return p;
        }
      }
      return null;
    }

    _generatePdfPreview(fileResult, callback) {
      const uri = fileResult.file.get_uri();
      const md5 = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uri, -1);
      const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'quick-light', 'pdf']);
      GLib.mkdir_with_parents(cacheDir, 0o755);

      const outPrefix = `${cacheDir}/ql_pdf_${md5}`;
      const expectedFile = `${outPrefix}-1.png`;
      const altFile = `${outPrefix}-01.png`;

      try {
        const proc = Gio.Subprocess.new(
          ['pdftoppm', '-png', '-f', '1', '-l', '1', '-scale-to', '600', fileResult.filePath, outPrefix],
          Gio.SubprocessFlags.NONE,
        );

        proc.wait_check_async(null, (p, res) => {
          try {
            if (p.wait_check_finish(res)) {
              if (GLib.file_test(expectedFile, GLib.FileTest.EXISTS)) {
                callback(expectedFile);
              } else if (GLib.file_test(altFile, GLib.FileTest.EXISTS)) {
                callback(altFile);
              } else {
                callback(null);
              }
            } else {
              callback(null);
            }
          } catch (err) {
            callback(null);
          }
        });
      } catch (err) {
        callback(null);
      }
    }

    /**
     * Set keyboard focus onto the search entry.
     */
    _grabSearchFocus() {
      if (!this._entry) return;
      const textActor = this._searchController?._text || this._entry.clutter_text;
      if (textActor) {
        textActor.grab_key_focus();
        textActor.set_cursor_visible(true);
      } else {
        this._entry.grab_key_focus();
      }
    }

    /**
     * Connect global stage and window events while modal is visible.
     */
    _connectEvents() {
      this._disconnectEvents();

      // Monitor focus changes: ensure search entry retains focus while modal is open
      this._stageKeyFocusId = global.stage.connect(
        'notify::key-focus',
        this._onKeyFocusChanged.bind(this),
      );

      // Intercept key presses (Escape to dismiss, typing & navigation while browsing results)
      this._stageKeyPressId = global.stage.connect(
        'key-press-event',
        this._onStageKeyPressed.bind(this),
      );

      // Dismiss when clicking outside modal
      this._stageCaptureId = global.stage.connect(
        'captured-event',
        this._onStageCapturedEvent.bind(this),
      );

      // Close when full screen changes or windows are created
      if (global.display) {
        this._fullscreenId = global.display.connect(
          'in-fullscreen-changed',
          () => {
            this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
              this.close();
              return GLib.SOURCE_REMOVE;
            });
          },
        );

        this._windowCreatedId = global.display.connect(
          'window-created',
          () => {
            if (this._isVisible) {
              this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.close();
                return GLib.SOURCE_REMOVE;
              });
            }
          },
        );
      }
    }

    /**
     * Disconnect all modal event listeners.
     */
    _disconnectEvents() {
      if (this._stageKeyFocusId && global.stage) {
        global.stage.disconnect(this._stageKeyFocusId);
        this._stageKeyFocusId = 0;
      }
      if (this._stageKeyPressId && global.stage) {
        global.stage.disconnect(this._stageKeyPressId);
        this._stageKeyPressId = 0;
      }
      if (this._stageCaptureId && global.stage) {
        global.stage.disconnect(this._stageCaptureId);
        this._stageCaptureId = 0;
      }
      if (this._fullscreenId && global.display) {
        global.display.disconnect(this._fullscreenId);
        this._fullscreenId = 0;
      }
      if (this._windowCreatedId && global.display) {
        global.display.disconnect(this._windowCreatedId);
        this._windowCreatedId = 0;
      }
    }

    /**
     * Captured event handler on global.stage to intercept Escape key and clicks outside modal.
     * Running during Clutter's capture phase guarantees Escape dismisses Quick Light immediately,
     * before GNOME Shell's searchController can intercept it or merely reset/clear text.
     */
    _onStageCapturedEvent(actor, event) {
      if (!this._isVisible) return Clutter.EVENT_PROPAGATE;

      const type = event.type();

      // Intercept Escape key globally on stage during capture phase
      if (type === Clutter.EventType.KEY_PRESS) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
          this.close();
          return Clutter.EVENT_STOP;
        }
      }

      if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
        if (this._isTransitioning) return Clutter.EVENT_PROPAGATE;

        const targetActor = global.stage.get_event_actor(event);
        const insideActor = targetActor && (this.contains(targetActor) || targetActor === this);

        const [clickX, clickY] = event.get_coords();
        const [modalX, modalY] = this.get_transformed_position();
        const [modalW, modalH] = this.get_transformed_size();

        const insideBounds = (
          clickX >= modalX &&
          clickX <= modalX + modalW &&
          clickY >= modalY &&
          clickY <= modalY + modalH
        );

        if (!insideActor && !insideBounds) {
          this.close();
          return Clutter.EVENT_STOP;
        }
      }

      return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Key focus change handler. Ensure search entry retains focus while modal is open.
     */
    _onKeyFocusChanged() {
      if (!this._isVisible || !this._entry || this._isTransitioning) return;

      this._updateWebSearchBadge();

      const focus = global.stage.get_key_focus();
      const hasFocus = focus && (
        this.contains(focus) ||
        this._entry.contains(focus) ||
        this._searchResults?.contains(focus) ||
        this._webSearchItem?.contains(focus)
      );

      if (!hasFocus) {
        this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (this._isVisible && !this._isTransitioning) {
            const currentFocus = global.stage.get_key_focus();
            const stillHasFocus = currentFocus && (
              this.contains(currentFocus) ||
              this._entry?.contains(currentFocus) ||
              this._searchResults?.contains(currentFocus) ||
              this._webSearchItem?.contains(currentFocus)
            );
            if (!stillHasFocus) {
              this._grabSearchFocus();
            }
            this._updateWebSearchBadge();
          }
          return GLib.SOURCE_REMOVE;
        });
      }
    }

    /**
     * Global stage key press handler for Quick Light:
     * - Escape to dismiss
     * - Seamless editing: Any typing, Backspace, or Delete while browsing search results redirects
     *   immediately to the search entry so the user can always edit the search query.
     * - Up Arrow returns from the top search result back into the search entry.
     * - Down Arrow from the bottom search result moves focus to the web search action tile.
     */
    _onStageKeyPressed(actor, event) {
      if (!this._isVisible) return Clutter.EVENT_PROPAGATE;

      const symbol = event.get_key_symbol();
      const state = event.get_state();
      const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
      const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

      // Handle active Quick Preview overlay keys
      if (this._previewOverlay?.visible) {
        if (symbol === Clutter.KEY_Escape || symbol === Clutter.KEY_space) {
          this._hideQuickPreview();
          return Clutter.EVENT_STOP;
        }
        if (isCtrl && (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter)) {
          this._hideQuickPreview();
          return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
          this._openActivePreviewFile();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_STOP;
      }

      // 1. Escape: close the modal
      if (symbol === Clutter.KEY_Escape) {
        this.close();
        return Clutter.EVENT_STOP;
      }

      const textActor = this._searchController?._text;
      const currentFocus = global.stage.get_key_focus();
      const isEntryFocused = textActor && currentFocus && (currentFocus === textActor || this._entry.contains(currentFocus));

      // 2. If focus is NOT on the search entry (e.g. user pressed Down arrow into search results):
      if (!isEntryFocused && textActor) {
        const hasModifier = (state & (
          Clutter.ModifierType.CONTROL_MASK |
          Clutter.ModifierType.MOD1_MASK |
          Clutter.ModifierType.SUPER_MASK
        )) !== 0;

        // Ctrl+C: copy file path from focused search result
        if (isCtrl && (symbol === Clutter.KEY_c || symbol === Clutter.KEY_C)) {
          const fileResult = this._getSelectedFileResult();
          if (fileResult) {
            this._copyFilePath(fileResult);
            return Clutter.EVENT_STOP;
          }
        }

        // Ctrl+Enter on focused file result: Quick Preview (Image/PDF) or Reveal
        if (isCtrl && (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter)) {
          const fileResult = this._getSelectedFileResult();
          if (fileResult) {
            if (fileResult.isImage || fileResult.isPdf) {
              this._showQuickPreview(fileResult);
            } else {
              this._revealInFileManager(fileResult.file);
            }
            return Clutter.EVENT_STOP;
          }
        }

        // Return / Enter on focused search result: activate it and close modal
        if ((symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) && !isCtrl && currentFocus !== this._webSearchItem) {
          const activeResult = this._findSelectedResult();
          if (activeResult) {
            this.opacity = 0;
            if (typeof activeResult.activate === 'function') {
              activeResult.activate();
            } else if (typeof this._searchResults?._origActivateDefault === 'function') {
              this._searchResults._origActivateDefault();
            }
            this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
              this.close();
              return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_STOP;
          }
        }

        // 2a. Up arrow: return to search entry when at the top result or from web search item
        if (symbol === Clutter.KEY_Up) {
          let canGoUp = false;

          if (this._webSearchItem && currentFocus === this._webSearchItem) {
            // From web search item, go back into search results or entry
            if (this._searchResults?._defaultResult) {
              this._searchResults.navigateFocus(St.DirectionType.TAB_BACKWARD);
              return Clutter.EVENT_STOP;
            }
          } else if (this._searchResults && currentFocus && this._searchResults.contains(currentFocus)) {
            // If focused on the first/default result, we cannot go higher in results
            if (this._searchResults._defaultResult && currentFocus === this._searchResults._defaultResult) {
              canGoUp = false;
            } else {
              canGoUp = this._searchResults.navigateFocus(St.DirectionType.UP);
            }
          }

          if (!canGoUp) {
            this._grabSearchFocus();
            textActor.set_cursor_position(-1);
            textActor.set_selection(-1, -1);
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_STOP;
        }

        // 2b. Down arrow: navigate from bottom search result into web search item
        if (symbol === Clutter.KEY_Down) {
          if (this._webSearchItem && currentFocus === this._webSearchItem) {
            return Clutter.EVENT_STOP;
          }

          if (this._webSearchItem?.visible) {
            this._webSearchItem.grab_key_focus();
            return Clutter.EVENT_STOP;
          }
        }

        // 2c. Enter / Return or Space on web search item: execute web search
        if (this._webSearchItem && currentFocus === this._webSearchItem) {
          if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space) {
            const rawText = textActor.get_text() || '';
            const prefixInfo = this._parseSearchPrefix(rawText);
            if (prefixInfo.matched && prefixInfo.query.length > 0) {
              this._openWebSearch(prefixInfo.query, prefixInfo.engine.url);
            } else {
              this._openWebSearch(rawText.trim());
            }
            return Clutter.EVENT_STOP;
          }
        }

        // 2c. Backspace / Delete: immediately refocus search entry and edit
        if ((symbol === Clutter.KEY_BackSpace || symbol === Clutter.KEY_Delete) && !hasModifier) {
          textActor.grab_key_focus();
          textActor.set_cursor_visible(true);
          textActor.set_cursor_position(-1);
          textActor.set_selection(-1, -1);

          if (typeof this._searchController.startSearch === 'function') {
            this._searchController.startSearch(event);
          } else {
            textActor.event(event, false);
          }
          return Clutter.EVENT_STOP;
        }

        // 2d. Any printable text input (letters, numbers, punctuation, space):
        // Automatically refocus search entry and append/type character so editing is continuous!
        const unicode = Clutter.keysym_to_unicode(symbol);
        const isPrintable = (unicode !== 0 && unicode >= 32);

        if (isPrintable && !hasModifier) {
          textActor.grab_key_focus();
          textActor.set_cursor_visible(true);
          textActor.set_cursor_position(-1);
          textActor.set_selection(-1, -1);

          if (typeof this._searchController.startSearch === 'function') {
            this._searchController.startSearch(event);
          } else {
            textActor.event(event, false);
          }
          return Clutter.EVENT_STOP;
        }
      }

      return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Complete cleanup when extension is disabled.
     */
    destroy() {
      this.remove_all_transitions?.();
      this._clearSources();
      this._disconnectEvents();
      this._releaseUI();
      if (this._box) {
        this._box.destroy();
        this._box = null;
      }
      super.destroy();
    }
  },
);
