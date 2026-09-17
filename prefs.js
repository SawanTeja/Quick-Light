import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { ShortcutWidget } from './shortcuts.js';

/**
 * Modern Libadwaita Preferences Window for Quick Light.
 */
export default class QuickLightPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const _ = this.gettext ? this.gettext.bind(this) : (s) => s;
    const settings = this.getSettings();

    window.set_default_size(680, 720);
    window.set_search_enabled(true);

    // ==========================================
    // PAGE 1: General (Shortcuts & Monitors)
    // ==========================================
    const generalPage = new Adw.PreferencesPage({
      title: _('General'),
      icon_name: 'preferences-system-symbolic',
    });

    // Shortcuts Group
    const shortcutsGroup = new Adw.PreferencesGroup({
      title: _('Keyboard Shortcuts'),
      description: _('Configure key combinations to trigger Quick Light.'),
    });

    // Primary shortcut row
    const primaryRow = new Adw.ActionRow({
      title: _('Primary Shortcut'),
      subtitle: _('Default trigger key combination'),
    });
    const primaryShortcutBtn = new ShortcutWidget(settings, 'shortcut-primary', window);
    primaryRow.add_suffix(primaryShortcutBtn);
    primaryRow.set_activatable_widget(primaryShortcutBtn);
    shortcutsGroup.add(primaryRow);

    // Secondary shortcut row
    const secondaryRow = new Adw.ActionRow({
      title: _('Secondary Shortcut'),
      subtitle: _('Optional secondary trigger shortcut'),
    });
    const secondaryShortcutBtn = new ShortcutWidget(settings, 'shortcut-secondary', window);
    secondaryRow.add_suffix(secondaryShortcutBtn);
    secondaryRow.set_activatable_widget(secondaryShortcutBtn);
    shortcutsGroup.add(secondaryRow);

    generalPage.add(shortcutsGroup);

    // Monitor & Display Group
    const displayGroup = new Adw.PreferencesGroup({
      title: _('Display and Position'),
      description: _('Choose which screen displays the spotlight search popup.'),
    });

    // Popup at cursor monitor
    const cursorRow = new Adw.SwitchRow({
      title: _('Follow Mouse Cursor'),
      subtitle: _('Always show Quick Light on the display where your mouse is located'),
    });
    settings.bind('popup-at-cursor', cursorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    displayGroup.add(cursorRow);

    // Preferred monitor dropdown
    const monitorRow = new Adw.ComboRow({
      title: _('Preferred Monitor'),
      subtitle: _('Display to use when cursor tracking is disabled'),
    });
    const monitorList = new Gtk.StringList();
    monitorList.append(_('Primary Monitor'));

    const detectedCount = settings.get_int('monitor-count') || 1;
    for (let i = 1; i <= Math.max(1, detectedCount); i++) {
      monitorList.append(_(`Display Monitor ${i}`));
    }
    monitorRow.set_model(monitorList);

    const initialMonitor = settings.get_int('preferred-monitor');
    monitorRow.set_selected(Math.min(initialMonitor, monitorList.get_n_items() - 1));

    monitorRow.connect('notify::selected', () => {
      settings.set_int('preferred-monitor', monitorRow.get_selected());
    });
    displayGroup.add(monitorRow);

    generalPage.add(displayGroup);

    // Top Panel Group
    const panelGroup = new Adw.PreferencesGroup({
      title: _('Top Panel Integration'),
    });

    const panelRow = new Adw.SwitchRow({
      title: _('Show Top Panel Icon'),
      subtitle: _('Display a magnifying glass icon in the GNOME status bar'),
    });
    settings.bind('show-panel-indicator', panelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    panelGroup.add(panelRow);

    generalPage.add(panelGroup);

    // Google Web Search Group
    const webSearchGroup = new Adw.PreferencesGroup({
      title: _('Google Web Search'),
      description: _('Search keywords in your default browser directly from Quick Light.'),
    });

    const webSearchEnableRow = new Adw.SwitchRow({
      title: _('Enable Google Web Search'),
      subtitle: _('Search keywords on Google in your default browser'),
    });
    settings.bind('enable-web-search', webSearchEnableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    webSearchGroup.add(webSearchEnableRow);

    const webSearchModeRow = new Adw.ComboRow({
      title: _('Enter Key Action'),
      subtitle: _('Choose what happens when pressing Enter in search'),
    });
    const webSearchModes = new Gtk.StringList();
    webSearchModes.append(_('Always search Google on Enter'));
    webSearchModes.append(_('Search Google if no local app matches (Smart Fallback)'));
    webSearchModes.append(_('Search Google with Shift + Enter only'));
    webSearchModeRow.set_model(webSearchModes);

    const initialMode = settings.get_int('web-search-mode');
    webSearchModeRow.set_selected(Math.min(initialMode, webSearchModes.get_n_items() - 1));
    webSearchModeRow.connect('notify::selected', () => {
      settings.set_int('web-search-mode', webSearchModeRow.get_selected());
    });
    webSearchGroup.add(webSearchModeRow);

    const engineUrlRow = new Adw.EntryRow({
      title: _('Search Engine URL Template'),
      text: settings.get_string('web-search-engine-url') || 'https://www.google.com/search?q=%s',
    });
    engineUrlRow.connect('changed', () => {
      const val = engineUrlRow.get_text()?.trim();
      if (val && val.includes('%s')) {
        settings.set_string('web-search-engine-url', val);
      }
    });
    webSearchGroup.add(engineUrlRow);

    generalPage.add(webSearchGroup);
    window.add(generalPage);

    // ==========================================
    // PAGE 2: Appearance (Framing, Colors, Fonts)
    // ==========================================
    const appearancePage = new Adw.PreferencesPage({
      title: _('Appearance'),
      icon_name: 'preferences-desktop-appearance-symbolic',
    });

    // Window Sizing
    const sizingGroup = new Adw.PreferencesGroup({
      title: _('Window Sizing'),
      description: _('Adjust width and height scaling of the search window.'),
    });

    const widthScaleRow = new Adw.SpinRow({
      title: _('Width Scale Factor'),
      subtitle: _('Scale window relative to display width'),
      adjustment: new Gtk.Adjustment({
        lower: -0.4,
        upper: 0.8,
        step_increment: 0.05,
        page_increment: 0.1,
      }),
      digits: 2,
    });
    settings.bind('window-width-scale', widthScaleRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    sizingGroup.add(widthScaleRow);

    const heightScaleRow = new Adw.SpinRow({
      title: _('Height Scale Factor'),
      subtitle: _('Scale results box relative to display height'),
      adjustment: new Gtk.Adjustment({
        lower: -0.4,
        upper: 0.8,
        step_increment: 0.05,
        page_increment: 0.1,
      }),
      digits: 2,
    });
    settings.bind('window-height-scale', heightScaleRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    sizingGroup.add(heightScaleRow);

    appearancePage.add(sizingGroup);

    // Window Frame & Geometry
    const frameGroup = new Adw.PreferencesGroup({
      title: _('Frame and Borders'),
    });

    const radiusRow = new Adw.SpinRow({
      title: _('Corner Border Radius'),
      subtitle: _('Corner curvature in pixels'),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 40,
        step_increment: 2,
        page_increment: 4,
      }),
      digits: 0,
    });
    settings.bind('border-radius', radiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    frameGroup.add(radiusRow);

    const borderThicknessRow = new Adw.SpinRow({
      title: _('Border Thickness'),
      subtitle: _('Window border width in pixels (0 for borderless)'),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 8,
        step_increment: 1,
        page_increment: 2,
      }),
      digits: 0,
    });
    settings.bind('border-thickness', borderThicknessRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    frameGroup.add(borderThicknessRow);

    // Border color row
    const borderColorRow = new Adw.ActionRow({
      title: _('Border Color'),
      subtitle: _('Color and opacity of the window outline'),
    });
    const borderColorBtn = new Gtk.ColorButton({
      use_alpha: true,
      valign: Gtk.Align.CENTER,
    });
    this._initColorButton(borderColorBtn, settings, 'border-color');
    borderColorRow.add_suffix(borderColorBtn);
    borderColorRow.set_activatable_widget(borderColorBtn);
    frameGroup.add(borderColorRow);

    appearancePage.add(frameGroup);

    // Backdrop & Palette
    const colorGroup = new Adw.PreferencesGroup({
      title: _('Colors and Background'),
    });

    // Background color
    const bgColorRow = new Adw.ActionRow({
      title: _('Background Color'),
      subtitle: _('Modal window background tone and opacity'),
    });
    const bgColorBtn = new Gtk.ColorButton({
      use_alpha: true,
      valign: Gtk.Align.CENTER,
    });
    this._initColorButton(bgColorBtn, settings, 'background-color');
    bgColorRow.add_suffix(bgColorBtn);
    bgColorRow.set_activatable_widget(bgColorBtn);
    colorGroup.add(bgColorRow);

    // Custom text color
    const textColorRow = new Adw.ActionRow({
      title: _('Custom Text Color'),
      subtitle: _('Override font color (set alpha to 0 for automatic adaptive color)'),
    });
    const textColorBtn = new Gtk.ColorButton({
      use_alpha: true,
      valign: Gtk.Align.CENTER,
    });
    this._initColorButton(textColorBtn, settings, 'text-color');
    textColorRow.add_suffix(textColorBtn);
    textColorRow.set_activatable_widget(textColorBtn);
    colorGroup.add(textColorRow);

    appearancePage.add(colorGroup);

    // Typography
    const typographyGroup = new Adw.PreferencesGroup({
      title: _('Typography'),
    });

    const entryFontRow = new Adw.SpinRow({
      title: _('Search Input Font Size'),
      subtitle: _('Size in points for the search bar text'),
      adjustment: new Gtk.Adjustment({
        lower: 11,
        upper: 26,
        step_increment: 1,
        page_increment: 2,
      }),
      digits: 0,
    });
    settings.bind('entry-font-size', entryFontRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    typographyGroup.add(entryFontRow);

    const resultsFontRow = new Adw.SpinRow({
      title: _('Results List Font Size'),
      subtitle: _('Size in points for search results text'),
      adjustment: new Gtk.Adjustment({
        lower: 10,
        upper: 20,
        step_increment: 1,
        page_increment: 2,
      }),
      digits: 0,
    });
    settings.bind('results-font-size', resultsFontRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    typographyGroup.add(resultsFontRow);

    appearancePage.add(typographyGroup);
    window.add(appearancePage);

    // ==========================================
    // PAGE 3: Behavior & Animations
    // ==========================================
    const behaviorPage = new Adw.PreferencesPage({
      title: _('Behavior'),
      icon_name: 'emblem-synchronizing-symbolic',
    });

    const animationGroup = new Adw.PreferencesGroup({
      title: _('Window Transitions'),
    });

    const animRow = new Adw.SwitchRow({
      title: _('Smooth Fade and Scale Animations'),
      subtitle: _('Animate the spotlight modal when opening and closing'),
    });
    settings.bind('enable-animations', animRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    animationGroup.add(animRow);

    const durationRow = new Adw.SpinRow({
      title: _('Transition Duration (ms)'),
      subtitle: _('Animation speed in milliseconds'),
      adjustment: new Gtk.Adjustment({
        lower: 50,
        upper: 400,
        step_increment: 10,
        page_increment: 50,
      }),
      digits: 0,
    });
    settings.bind('animation-duration', durationRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    animationGroup.add(durationRow);

    behaviorPage.add(animationGroup);
    window.add(behaviorPage);

    // ==========================================
    // PAGE 4: About
    // ==========================================
    const aboutPage = new Adw.PreferencesPage({
      title: _('About'),
      icon_name: 'help-about-symbolic',
    });

    const aboutGroup = new Adw.PreferencesGroup();
    const bannerBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
      margin_top: 24,
      margin_bottom: 24,
      halign: Gtk.Align.CENTER,
    });

    const appTitle = new Gtk.Label({
      label: '<b>Quick Light</b>',
      use_markup: true,
      css_classes: ['title-1'],
    });

    const appDesc = new Gtk.Label({
      label: _('Spotlight-style instant search launcher for GNOME Shell.'),
      css_classes: ['dim-label'],
    });

    const appVer = new Gtk.Label({
      label: 'Version 1.0 (GNOME 46 - 50+ Compatible)',
      css_classes: ['caption'],
    });

    bannerBox.append(appTitle);
    bannerBox.append(appDesc);
    bannerBox.append(appVer);
    aboutGroup.add(bannerBox);

    const linksGroup = new Adw.PreferencesGroup({
      title: _('Information and Source'),
    });

    const sourceRow = new Adw.ActionRow({
      title: _('GitHub Repository'),
      subtitle: 'https://github.com/tejashvi/quick-light',
    });
    const sourceBtn = new Gtk.Button({
      icon_name: 'web-browser-symbolic',
      valign: Gtk.Align.CENTER,
      has_frame: false,
    });
    sourceBtn.connect('clicked', () => {
      Gtk.show_uri(window, 'https://github.com/tejashvi/quick-light', Gdk.CURRENT_TIME);
    });
    sourceRow.add_suffix(sourceBtn);
    sourceRow.set_activatable_widget(sourceBtn);
    linksGroup.add(sourceRow);

    aboutPage.add(aboutGroup);
    aboutPage.add(linksGroup);
    window.add(aboutPage);
  }

  /**
   * Helper to bind a GtkColorButton to an RGBA (dddd) GSettings key.
   */
  _initColorButton(colorButton, settings, key) {
    const rawValue = settings.get_value(key).deepUnpack();
    if (rawValue && rawValue.length >= 4) {
      colorButton.set_rgba(
        new Gdk.RGBA({
          red: rawValue[0],
          green: rawValue[1],
          blue: rawValue[2],
          alpha: rawValue[3],
        }),
      );
    }

    colorButton.connect('color-set', () => {
      const rgba = colorButton.get_rgba();
      settings.set_value(
        key,
        new GLib.Variant('(dddd)', [rgba.red, rgba.green, rgba.blue, rgba.alpha]),
      );
    });
  }
}
