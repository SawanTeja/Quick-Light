import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { KeybindManager } from './keybindManager.js';
import { MonitorManager } from './monitorManager.js';
import { ThemeStyler } from './themeStyler.js';
import { PanelIndicator } from './panelIndicator.js';
import { QuickLightModal } from './quickLightModal.js';

/**
 * QuickLightExtension is the top-level lifecycle coordinator.
 */
export default class QuickLightExtension extends Extension {
  enable() {
    this.settings = this.getSettings('org.gnome.shell.extensions.quick-light');
    this.monitorManager = new MonitorManager(this.settings);
    this.themeStyler = new ThemeStyler();
    this.keybindManager = new KeybindManager();

    // Instantiate spotlight modal and add to GNOME Shell chrome
    this._modal = new QuickLightModal(this);
    Main.layoutManager.addChrome(this._modal, {
      affectsStruts: false,
      trackFullscreen: false,
    });

    // Panel status indicator
    this._panelIndicator = null;
    this._updatePanelIndicator();

    // Enable keybind manager
    this.keybindManager.enable();
    this._updateShortcuts();

    // Initial styling
    this.themeStyler.applyStyles(this.settings);

    // Connect settings changes
    this._settingsSignalIds = [];
    this._connectSettings();
  }

  disable() {
    // Disconnect settings listeners
    if (this._settingsSignalIds && this.settings) {
      for (const id of this._settingsSignalIds) {
        this.settings.disconnect(id);
      }
      this._settingsSignalIds = [];
    }

    // Disable keybindings
    if (this.keybindManager) {
      this.keybindManager.disable();
      this.keybindManager = null;
    }

    // Destroy panel indicator
    if (this._panelIndicator) {
      this._panelIndicator.destroy();
      this._panelIndicator = null;
    }

    // Remove modal from Chrome and destroy
    if (this._modal) {
      Main.layoutManager.removeChrome(this._modal);
      this._modal.destroy();
      this._modal = null;
    }

    // Unload dynamic stylesheet
    if (this.themeStyler) {
      this.themeStyler.unload();
      this.themeStyler = null;
    }

    this.monitorManager = null;
    this.settings = null;
  }

  _updatePanelIndicator() {
    const show = this.settings.get_boolean('show-panel-indicator');
    if (show) {
      if (!this._panelIndicator) {
        this._panelIndicator = new PanelIndicator(() => {
          this._modal?.toggle();
        });
        Main.panel.addToStatusArea('quick-light', this._panelIndicator);
      }
    } else {
      if (this._panelIndicator) {
        this._panelIndicator.destroy();
        this._panelIndicator = null;
      }
    }
  }

  _connectSettings() {
    const watchKey = (key, handler) => {
      const id = this.settings.connect(`changed::${key}`, handler);
      this._settingsSignalIds.push(id);
    };

    watchKey('shortcut-primary', () => this._updateShortcuts());
    watchKey('shortcut-secondary', () => this._updateShortcuts());
    watchKey('show-panel-indicator', () => this._updatePanelIndicator());

    const styleKeys = [
      'background-color',
      'border-radius',
      'border-thickness',
      'border-color',
      'text-color',
      'entry-font-size',
      'results-font-size',
      'indicator-color',
    ];

    for (const k of styleKeys) {
      watchKey(k, () => {
        this.themeStyler?.applyStyles(this.settings);
      });
    }
  }

  _updateShortcuts() {
    if (!this.keybindManager) return;

    // Primary shortcut
    const primaryShortcuts = this.settings.get_strv('shortcut-primary');
    const primary = primaryShortcuts?.[0] || '<Control><Super>space';
    this.keybindManager.bind('primary', primary, () => {
      this._modal?.toggle();
    });

    // Secondary shortcut
    const secondaryShortcuts = this.settings.get_strv('shortcut-secondary');
    const secondary = secondaryShortcuts?.[0];
    if (secondary) {
      this.keybindManager.bind('secondary', secondary, () => {
        this._modal?.toggle();
      });
    } else {
      this.keybindManager.unbind('secondary');
    }
  }
}
