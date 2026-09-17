import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject';

/**
 * Modern GTK4 shortcut capture button widget.
 */
export const ShortcutWidget = GObject.registerClass(
  {
    Properties: {
      shortcut: GObject.ParamSpec.string(
        'shortcut',
        'shortcut',
        'shortcut',
        GObject.ParamFlags.READWRITE,
        '',
      ),
    },
    Signals: {
      changed: { param_types: [GObject.TYPE_STRING] },
    },
  },
  class ShortcutWidget extends Gtk.Button {
    _init(settings, settingsKey, parentWindow) {
      super._init({
        valign: Gtk.Align.CENTER,
        has_frame: true,
        css_classes: ['flat'],
      });

      this._settings = settings;
      this._settingsKey = settingsKey;
      this._parentWindow = parentWindow;

      this._label = new Gtk.ShortcutLabel({
        disabled_text: 'Click to set shortcut…',
      });
      this.set_child(this._label);

      this.bind_property(
        'shortcut',
        this._label,
        'accelerator',
        GObject.BindingFlags.DEFAULT,
      );

      const [stored] = this._settings.get_strv(this._settingsKey);
      this.shortcut = stored || '';

      this.connect('clicked', this._onClicked.bind(this));
    }

    _onClicked() {
      const dialog = new Gtk.Window({
        title: 'Set Shortcut',
        modal: true,
        transient_for: this._parentWindow || this.get_root(),
        default_width: 380,
        default_height: 220,
        resizable: false,
      });

      const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
        valign: Gtk.Align.CENTER,
      });

      const titleLabel = new Gtk.Label({
        label: '<b>Press key combination…</b>',
        use_markup: true,
        css_classes: ['title-3'],
      });

      const descLabel = new Gtk.Label({
        label: 'Press <small>Backspace</small> to clear or <small>Escape</small> to cancel.',
        use_markup: true,
        css_classes: ['dim-label'],
      });

      box.append(titleLabel);
      box.append(descLabel);
      dialog.set_child(box);

      const controller = new Gtk.EventControllerKey();
      controller.connect('key-pressed', (ctrl, keyval, keycode, state) => {
        let mask = state & Gtk.accelerator_get_default_mod_mask();
        mask &= ~Gdk.ModifierType.LOCK_MASK;

        // Escape cancels dialog
        if (!mask && keyval === Gdk.KEY_Escape) {
          dialog.close();
          return Gdk.EVENT_STOP;
        }

        // Backspace clears the shortcut
        if (!mask && keyval === Gdk.KEY_BackSpace) {
          this._applyShortcut('');
          dialog.close();
          return Gdk.EVENT_STOP;
        }

        // Must have valid modifier or function key
        const isModifierOnly = [
          Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
          Gdk.KEY_Control_L, Gdk.KEY_Control_R,
          Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
          Gdk.KEY_Super_L, Gdk.KEY_Super_R,
          Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
        ].includes(keyval);

        if (isModifierOnly) {
          return Gdk.EVENT_PROPAGATE;
        }

        const name = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
        if (name) {
          this._applyShortcut(name);
          dialog.close();
          return Gdk.EVENT_STOP;
        }

        return Gdk.EVENT_PROPAGATE;
      });

      dialog.add_controller(controller);
      dialog.present();
    }

    _applyShortcut(accel) {
      this.shortcut = accel;
      this.emit('changed', accel);
      this._settings.set_strv(this._settingsKey, accel ? [accel] : []);
    }
  },
);
