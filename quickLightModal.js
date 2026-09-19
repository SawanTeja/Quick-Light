import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
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

      // Overview override hooks
      this._origOverviewToggle = null;
      this._origOverviewHide = null;

      // Event signal IDs
      this._stageKeyFocusId = 0;
      this._stageKeyPressId = 0;
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
      if (!this._isVisible || this._isTransitioning) return;

      this._isTransitioning = true;
      this._disconnectEvents();

      const useAnimations = this._settings.get_boolean('enable-animations');
      const duration = this._settings.get_double('animation-duration') || 120;

      const finishClosing = () => {
        this.opacity = 0;
        this.hide();
        this._isVisible = false;
        this._isTransitioning = false;
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

      const scVisible = this._searchController?.visible;
      const wsVisible = this._webSearchItem?.visible;
      if (this._searchController) this._searchController.hide();
      if (this._webSearchItem) this._webSearchItem.hide();

      const [, modalNatHeight] = this.get_preferred_height(this._modalWidth);
      if (modalNatHeight > 0) {
        this._initialHeight = Math.round(modalNatHeight);
      } else {
        const [, entryNatHeight] = this._entry?.get_preferred_height(this._modalWidth) || [0, 48];
        const baseHeight = entryNatHeight > 0 ? entryNatHeight : (this._entry?.height > 0 ? this._entry.height : 48);
        this._initialHeight = Math.round(baseHeight + 20 * scaleFactor);
      }

      if (scVisible && this._searchController) this._searchController.show();
      if (wsVisible && this._webSearchItem) this._webSearchItem.show();
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

        // Hook into result activation to dismiss modal instantly or perform web search
        if (this._searchResults && !this._searchResults._origActivateDefault) {
          this._searchResults._origActivateDefault = this._searchResults.activateDefault;
          this._searchResults.activateDefault = () => {
            const text = this._searchController?._text?.get_text() || '';
            const query = text.trim();
            const enableWeb = this._settings.get_boolean('enable-web-search');
            const mode = this._settings.get_int('web-search-mode');

            if (enableWeb && mode === 0 && query.length > 0) {
              this._openWebSearch(query);
              return;
            }

            if (this._searchResults._defaultResult) {
              this.opacity = 0;
              this._searchResults._origActivateDefault();
              GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.close();
                return GLib.SOURCE_REMOVE;
              });
            } else if (enableWeb && query.length > 0 && mode !== 2) {
              this._openWebSearch(query);
            }
          };
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

              if (symbol === Clutter.KEY_Down) {
                if (!this._searchResults?._defaultResult && this._webSearchItem?.visible) {
                  this._webSearchItem.grab_key_focus();
                  return Clutter.EVENT_STOP;
                }
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

              // 3. Mode 0: Always search Google on Enter
              if (mode === 0) {
                this._openWebSearch(query);
                return Clutter.EVENT_STOP;
              }

              // 4. Mode 1: Fallback (if no local app or default result matches)
              if (mode === 1) {
                if (this._searchResults?._defaultResult) {
                  return Clutter.EVENT_PROPAGATE;
                } else {
                  this._openWebSearch(query);
                  return Clutter.EVENT_STOP;
                }
              }

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
              const mode = this._settings.get_int('web-search-mode');

              if (query.length > 0) {
                this.set_size(this._modalWidth, this._modalHeight);
                this._searchController.show();

                if (enableWeb) {
                  this._webSearchLabel.set_text(`Search Google for "${query}"`);
                  this._webSearchBadge.set_text(mode === 2 ? '⇧↵ Shift+Enter' : '↵ Enter');
                  this._webSearchItem.show();
                } else {
                  this._webSearchItem.hide();
                }
              } else {
                this._searchController.hide();
                this._webSearchItem.hide();
                this._updateInitialHeight();
                this.set_size(this._modalWidth, this._initialHeight);
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
      if (this._searchController?._text) {
        this._searchController._text.grab_key_focus();
        this._searchController._text.set_cursor_visible(true);
      } else {
        this._entry.grab_key_focus();
      }
    }

    /**
     * Connect global stage and window events while modal is visible.
     */
    _connectEvents() {
      this._disconnectEvents();

      // Monitor focus changes
      this._stageKeyFocusId = global.stage.connect(
        'notify::key-focus',
        this._onKeyFocusChanged.bind(this),
      );

      // Intercept key presses (Escape to dismiss, typing & navigation while browsing results)
      this._stageKeyPressId = global.stage.connect(
        'key-press-event',
        this._onStageKeyPressed.bind(this),
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
     * Key focus change handler. If focus moves away from Quick Light, dismiss.
     */
    _onKeyFocusChanged() {
      if (!this._isVisible || !this._entry) return;

      const focus = global.stage.get_key_focus();
      const hasFocus = focus && (
        this.contains(focus) ||
        this._entry?.contains(focus) ||
        this._searchResults?.contains(focus) ||
        this._webSearchItem?.contains(focus)
      );

      if (!hasFocus) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (this._isVisible) {
            const currentFocus = global.stage.get_key_focus();
            const stillHasFocus = currentFocus && (
              this.contains(currentFocus) ||
              this._entry?.contains(currentFocus) ||
              this._searchResults?.contains(currentFocus) ||
              this._webSearchItem?.contains(currentFocus)
            );
            if (!stillHasFocus) {
              this.close();
            }
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
     */
    _onStageKeyPressed(actor, event) {
      if (!this._isVisible) return Clutter.EVENT_PROPAGATE;

      const symbol = event.get_key_symbol();

      // 1. Escape: close the modal
      if (symbol === Clutter.KEY_Escape) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          this.close();
          return GLib.SOURCE_REMOVE;
        });
        return Clutter.EVENT_STOP;
      }

      const textActor = this._searchController?._text;
      const currentFocus = global.stage.get_key_focus();
      const isEntryFocused = textActor && (currentFocus === textActor || this._entry.contains(currentFocus));

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

        // 2b. Down arrow on web search item: stop
        if (symbol === Clutter.KEY_Down && this._webSearchItem && currentFocus === this._webSearchItem) {
          return Clutter.EVENT_STOP;
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
