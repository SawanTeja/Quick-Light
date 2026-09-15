import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/**
 * Top bar status icon button to toggle Quick Light with gesture-safe idle dispatch.
 */
export class PanelIndicator {
  constructor(onToggleCallback) {
    this._onToggle = onToggleCallback;
    this._button = null;
    this._icon = null;
  }

  show(visible = true) {
    if (!this._button) {
      this._button = new St.Button({
        style_class: 'panel-button quick-light-panel-button',
        can_focus: true,
        track_hover: true,
      });

      this._icon = new St.Icon({
        icon_name: 'system-search-symbolic',
        style_class: 'system-status-icon quick-light-panel-icon',
      });

      this._button.set_child(this._icon);

      // Defer toggle callback to an idle tick so Clutter's press gesture
      // finishes completely before opening or reparenting the search actors.
      this._button.connect('button-press-event', () => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (typeof this._onToggle === 'function') {
            this._onToggle();
          }
          return GLib.SOURCE_REMOVE;
        });
        return St.CLUTTER_EVENT_PROPAGATE ?? 0;
      });

      try {
        Main.panel._rightBox.insert_child_at_index(this._button, 0);
      } catch (err) {
        console.warn(`[Quick Light] Could not add panel indicator: ${err.message}`);
      }
    }

    this._button.visible = visible;
  }

  hide() {
    if (this._button) {
      this._button.visible = false;
    }
  }

  destroy() {
    if (this._button) {
      if (this._button.get_parent()) {
        this._button.get_parent().remove_child(this._button);
      }
      this._button.destroy();
      this._button = null;
      this._icon = null;
    }
  }
}
