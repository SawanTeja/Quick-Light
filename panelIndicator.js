import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

/**
 * Top bar status icon button to toggle Quick Light using GNOME Shell's standard PanelMenu.Button.
 */
export const PanelIndicator = GObject.registerClass(
  class PanelIndicator extends PanelMenu.Button {
    _init(onToggleCallback) {
      // 0.0 alignment, accessible name 'Quick Light', dontCreateMenu = true
      super._init(0.0, 'Quick Light', true);

      this._onToggle = onToggleCallback;
      this._idleId = 0;

      this.add_style_class_name('quick-light-panel-button');

      this._icon = new St.Icon({
        icon_name: 'system-search-symbolic',
        style_class: 'system-status-icon quick-light-panel-icon',
      });
      this.add_child(this._icon);

      // Defer toggle callback to an idle tick so Clutter's press gesture
      // finishes completely before opening or focusing the search modal.
      this.connect('button-press-event', () => {
        if (this._idleId) {
          GLib.source_remove(this._idleId);
          this._idleId = 0;
        }

        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          this._idleId = 0;
          if (typeof this._onToggle === 'function') {
            this._onToggle();
          }
          return GLib.SOURCE_REMOVE;
        });

        return Clutter.EVENT_PROPAGATE;
      });
    }

    destroy() {
      if (this._idleId) {
        GLib.source_remove(this._idleId);
        this._idleId = 0;
      }
      super.destroy();
    }
  },
);
