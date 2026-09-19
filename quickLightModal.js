import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

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

      // Initial dimensions
      this._modalWidth = 620;
      this._modalHeight = 440;
      this._initialHeight = 64;

      this._setupWebSearchWidget();

      this.hide();
      this.opacity = 0;
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

      const webIcon = new St.Icon({
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

      webBox.add_child(webIcon);
      webBox.add_child(this._webSearchLabel);
      webBox.add_child(this._webSearchBadge);
      this._webSearchItem.set_child(webBox);

      this._webSearchItem.connect('clicked', () => {
        const text = this._searchController?._text?.get_text() || '';
        this._openWebSearch(text.trim());
      });

      this._webSearchItem.connect('key-press-event', (actor, event) => {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space) {
          const text = this._searchController?._text?.get_text() || '';
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

      const useAnimations = this._settings.get_boolean('enable-animations');
      const duration = this._settings.get_double('animation-duration') || 120;

      const finishClosing = () => {
        this.opacity = 0;
        this.hide();
        this._isVisible = false;
        this._isTransitioning = false;
        this._isClosing = false;
        this._releaseUI();
        global.compositor?.enable_unredirect?.();
      };

      if (useAnimations) {
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
      }

      // Borrow searchController
      this._searchController = Main.overview.searchController;
      if (this._searchController) {
        this._searchParent = this._searchController.get_parent();
        this._searchResults = this._searchController._searchResults;

        // Hook into result activation to dismiss modal instantly or perform smart web search fallback
        if (this._searchResults && !this._searchResults._origActivateDefault) {
          this._searchResults._origActivateDefault = this._searchResults.activateDefault;
          this._searchResults.activateDefault = () => {
            const text = this._searchController?._text?.get_text() || '';
            const query = text.trim();
            const enableWeb = this._settings.get_boolean('enable-web-search');
            const mode = this._settings.get_int('web-search-mode');

            // Explicit web search mode 2 (Always search Google on Enter)
            if (enableWeb && mode === 2 && query.length > 0) {
              this._openWebSearch(query);
              return;
            }

            // Force search execution if debounced search is queued
            if (this._searchResults._searchTimeoutId > 0) {
              this._searchResults._doSearch();
            }

            // 1. If we already have a default result (e.g. Discord, Calc, Files):
            if (this._searchResults._defaultResult) {
              this.opacity = 0;
              this._searchResults._origActivateDefault();
              GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.close();
                return GLib.SOURCE_REMOVE;
              });
              return;
            }

            // 2. If default result is not yet rendered, check Shell.AppSystem synchronously
            const appMatches = Shell.AppSystem.search(query);
            let topAppId = null;
            if (Array.isArray(appMatches)) {
              for (const group of appMatches) {
                if (Array.isArray(group) && group.length > 0) {
                  topAppId = group[0];
                  break;
                }
              }
            }

            if (topAppId) {
              const app = Shell.AppSystem.get_default()?.lookup_app(topAppId);
              if (app) {
                this.opacity = 0;
                app.activate();
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                  this.close();
                  return GLib.SOURCE_REMOVE;
                });
                return;
              }
            }

            // 3. If asynchronous search providers are still running, wait briefly before fallback
            if (this._searchResults.searchInProgress) {
              let checkTicks = 0;
              const checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
                checkTicks++;
                if (this._searchResults?._defaultResult) {
                  this.opacity = 0;
                  this._searchResults._origActivateDefault();
                  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this.close();
                    return GLib.SOURCE_REMOVE;
                  });
                  return GLib.SOURCE_REMOVE;
                }

                if (!this._searchResults?.searchInProgress || checkTicks > 12) {
                  if (this._searchResults?._defaultResult) {
                    this.opacity = 0;
                    this._searchResults._origActivateDefault();
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
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

            // 4. No local results found: opt for Google search only on Smart Fallback (mode 0)
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

              if (symbol === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
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

              const state = event.get_state();
              const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
              const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

              const text = this._searchController._text.get_text() || '';
              const query = text.trim();
              if (!query) return Clutter.EVENT_PROPAGATE;

              const enableWeb = this._settings.get_boolean('enable-web-search');
              if (!enableWeb) return Clutter.EVENT_PROPAGATE;

              const mode = this._settings.get_int('web-search-mode');

              // 1. Shift+Enter or Ctrl+Enter -> Always Google search
              if (isShift || isCtrl) {
                this._openWebSearch(query);
                return Clutter.EVENT_STOP;
              }

              // 2. Explicit 'g ' or '? ' prefix -> Always Google search
              if (query.startsWith('g ') || query.startsWith('? ')) {
                const cleaned = query.replace(/^(g|\?)\s+/, '');
                this._openWebSearch(cleaned);
                return Clutter.EVENT_STOP;
              }

              // 3. Mode 2: Always search Google on Enter
              if (mode === 2) {
                this._openWebSearch(query);
                return Clutter.EVENT_STOP;
              }

              // 4. Normal Enter in Smart Fallback (mode 0) or Shift+Enter only (mode 1):
              // Propagate to activateDefault to handle local result activation or fallback
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
                  this._webSearchLabel.set_text(`Search Google for "${query}"`);
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
    }

    /**
     * Launch Google search with query in the user's default browser.
     */
    _openWebSearch(query) {
      if (!query || !query.trim()) return;

      const template = this._settings?.get_string('web-search-engine-url') || 'https://www.google.com/search?q=%s';
      const url = template.replace('%s', encodeURIComponent(query.trim()));

      this.opacity = 0;
      this.close();

      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
          Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (err) {
          try {
            GLib.spawn_command_line_async(`xdg-open "${url}"`);
          } catch (e) {
            console.warn(`[Quick Light] Error opening web search: ${e.message}`);
          }
        }
        return GLib.SOURCE_REMOVE;
      });
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
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
              this.close();
              return GLib.SOURCE_REMOVE;
            });
          },
        );

        this._windowCreatedId = global.display.connect(
          'window-created',
          () => {
            if (this._isVisible) {
              GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
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
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
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
        const state = event.get_state();
        const hasModifier = (state & (
          Clutter.ModifierType.CONTROL_MASK |
          Clutter.ModifierType.MOD1_MASK |
          Clutter.ModifierType.SUPER_MASK
        )) !== 0;

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
            const query = textActor.get_text()?.trim() || '';
            this._openWebSearch(query);
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
