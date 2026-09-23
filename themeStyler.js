import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/**
 * Manages runtime dynamic CSS stylesheet generation and injection into GNOME Shell's ThemeContext.
 * Stores generated stylesheets in the standard user cache directory instead of /tmp.
 */
export class ThemeStyler {
  constructor() {
    this._customFile = null;
    this._lastCss = '';
  }

  /**
   * Helper to format a [r, g, b, a] array or variant into CSS rgba string.
   */
  rgbaString(color) {
    if (!color || color.length < 4) return '255, 255, 255, 1.0';
    const r = Math.round(color[0] * 255);
    const g = Math.round(color[1] * 255);
    const b = Math.round(color[2] * 255);
    const a = Number(color[3]).toFixed(2);
    return `${r}, ${g}, ${b}, ${a}`;
  }

  /**
   * Check if a color is dark (relative luminance).
   */
  isDark(color) {
    if (!color || color.length < 3) return true;
    const lum = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
    return lum < 0.5;
  }

  /**
   * Rebuilds and applies dynamic CSS based on settings.
   */
  applyStyles(settings) {
    if (!settings) return;

    const bgColor = settings.get_value('background-color').deepUnpack();
    const borderColor = settings.get_value('border-color').deepUnpack();
    const textColor = settings.get_value('text-color').deepUnpack();
    const indicatorColor = settings.get_value('indicator-color').deepUnpack();

    const borderRadius = settings.get_double('border-radius');
    const borderThickness = settings.get_int('border-thickness');
    const entryFontSize = settings.get_int('entry-font-size');
    const resultsFontSize = settings.get_int('results-font-size');

    const rules = [];

    // Modal background and border
    const bgRgba = this.rgbaString(bgColor);
    const borderRgba = this.rgbaString(borderColor);
    const borderCss = borderThickness > 0
      ? `border: ${borderThickness}px solid rgba(${borderRgba});`
      : 'border: none;';

    rules.push(`
      #quickLightModal {
        background-color: rgba(${bgRgba});
        ${borderCss}
        border-radius: ${borderRadius}px;
      }
      #quickLightBox {
        border-radius: ${borderRadius}px;
      }
      #quickLightBox .search-section-content {
        border-radius: ${Math.max(4, borderRadius - 4)}px;
      }
    `);

    // Search entry font size and typography
    if (entryFontSize > 0) {
      rules.push(`
        #quickLightBox StEntry,
        #quickLightBox StEntry:focus {
          font-size: ${entryFontSize}pt !important;
        }
      `);
    }

    // Results font size
    if (resultsFontSize > 0) {
      rules.push(`
        #quickLightBox .search-section-content,
        #quickLightBox .list-search-result,
        #quickLightBox .overview-tile {
          font-size: ${resultsFontSize}pt !important;
        }
      `);
    }

    // Custom text color (if alpha > 0)
    if (textColor && textColor[3] > 0.05) {
      const textRgba = this.rgbaString(textColor);
      rules.push(`
        #quickLightBox,
        #quickLightBox * {
          color: rgba(${textRgba}) !important;
        }
      `);
    }

    // Indicator icon color
    if (indicatorColor && indicatorColor[3] > 0) {
      const iconRgba = this.rgbaString(indicatorColor);
      rules.push(`
        .quick-light-panel-icon {
          color: rgba(${iconRgba}) !important;
        }
      `);
    }

    const compiledCss = rules.join('\n');
    if (compiledCss === this._lastCss) return;
    this._lastCss = compiledCss;

    const themeContext = St.ThemeContext.get_for_stage(global.stage);
    const theme = themeContext.get_theme();

    if (this._customFile) {
      try {
        theme.unload_stylesheet(this._customFile);
      } catch (e) {
        // ignore
      }
    } else {
      const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'quick-light']);
      GLib.mkdir_with_parents(cacheDir, 0o755);
      const cssPath = GLib.build_filenamev([cacheDir, 'theme.css']);
      this._customFile = Gio.File.new_for_path(cssPath);
    }

    try {
      this._customFile.replace_contents(
        compiledCss,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
      );
      theme.load_stylesheet(this._customFile);
    } catch (err) {
      console.warn(`[Quick Light] Error applying dynamic stylesheet: ${err.message}`);
    }
  }

  unload() {
    if (this._customFile) {
      try {
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const theme = themeContext.get_theme();
        theme.unload_stylesheet(this._customFile);
        this._customFile.delete(null);
      } catch (e) {
        // ignore
      }
      this._customFile = null;
    }
    this._lastCss = '';
  }
}
