import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';

/**
 * Manages global keyboard shortcuts for Quick Light.
 * Ensures trigger callbacks are dispatched on an idle tick to prevent Clutter 18
 * synchronous event-handler re-entrancy issues.
 */
export class KeybindManager {
  constructor() {
    this._bindings = new Map();
    this._displaySignalId = 0;
    this._enabled = false;
  }

  enable() {
    if (this._enabled) return;

    this._displaySignalId = global.display.connect(
      'accelerator-activated',
      (display, action) => {
        const entry = this._bindings.get(action);
        if (entry && typeof entry.callback === 'function') {
          // Defer callback to idle loop so the input dispatch completes
          // before any actor manipulation or focus grabbing occurs.
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            entry.callback();
            return GLib.SOURCE_REMOVE;
          });
        }
      },
    );

    this._enabled = true;
  }

  disable() {
    this.unbindAll();

    if (this._displaySignalId && global.display) {
      global.display.disconnect(this._displaySignalId);
      this._displaySignalId = 0;
    }

    this._enabled = false;
  }

  /**
   * Bind an accelerator string (e.g. '<Control><Super>Space') to a callback.
   * @param {string} tag Unique identifier for this binding (e.g. 'primary')
   * @param {string} accelerator Accelerator expression
   * @param {Function} callback Function to call on trigger
   */
  bind(tag, accelerator, callback) {
    this.unbind(tag);

    if (!accelerator || accelerator.trim() === '') return;

    const action = global.display.grab_accelerator(accelerator, 0);
    if (action === Meta.KeyBindingAction.NONE) {
      console.warn(`[Quick Light] Unable to grab accelerator: ${accelerator}`);
      return;
    }

    const bindingName = Meta.external_binding_name_for_action(action);
    Main.wm.allowKeybinding(bindingName, Shell.ActionMode.ALL);

    this._bindings.set(action, {
      tag,
      action,
      bindingName,
      accelerator,
      callback,
    });
  }

  /**
   * Unbind a specific shortcut tag.
   * @param {string} tag
   */
  unbind(tag) {
    for (const [action, entry] of this._bindings.entries()) {
      if (entry.tag === tag) {
        if (Main.wm && entry.bindingName) {
          Main.wm.removeKeybinding(entry.bindingName, Shell.ActionMode.ALL);
        }
        if (global.display) {
          global.display.ungrab_accelerator(action);
        }
        this._bindings.delete(action);
        break;
      }
    }
  }

  /**
   * Remove and release all grabbed accelerators.
   */
  unbindAll() {
    for (const [action, entry] of this._bindings.entries()) {
      if (Main.wm && entry.bindingName) {
        Main.wm.removeKeybinding(entry.bindingName, Shell.ActionMode.ALL);
      }
      if (global.display) {
        global.display.ungrab_accelerator(action);
      }
    }
    this._bindings.clear();
  }
}
