import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Handles monitor resolution detection and cursor-based monitor tracking.
 */
export class MonitorManager {
  constructor(settings) {
    this._settings = settings;
  }

  /**
   * Returns the list of all available monitors from the layout manager.
   */
  get monitors() {
    return Main.layoutManager.monitors || [];
  }

  /**
   * Returns the primary monitor.
   */
  get primaryMonitor() {
    return Main.layoutManager.primaryMonitor || this.monitors[0] || null;
  }

  /**
   * Determines the monitor where the cursor currently resides.
   */
  get cursorMonitor() {
    const [px, py] = global.get_pointer();
    for (const monitor of this.monitors) {
      if (
        px >= monitor.x &&
        px < monitor.x + monitor.width &&
        py >= monitor.y &&
        py < monitor.y + monitor.height
      ) {
        return monitor;
      }
    }
    return this.primaryMonitor;
  }

  /**
   * Returns the active target monitor for positioning Quick Light,
   * taking into account user settings (cursor monitor vs preferred monitor index).
   */
  getTargetMonitor() {
    const popupAtCursor = this._settings?.get_boolean('popup-at-cursor') ?? false;
    if (popupAtCursor) {
      return this.cursorMonitor;
    }

    const preferredIndex = this._settings?.get_int('preferred-monitor') ?? 0;
    if (preferredIndex === 0) {
      return this.primaryMonitor;
    }

    // Adjust for index in monitor array
    const monitors = this.monitors;
    if (preferredIndex > 0 && preferredIndex <= monitors.length) {
      return monitors[preferredIndex - 1];
    }

    return this.primaryMonitor;
  }

  /**
   * Updates the monitor count key in GSettings so preferences UI can present valid choices.
   */
  updateMonitorCount() {
    if (!this._settings) return;
    const count = this.monitors.length;
    if (this._settings.get_int('monitor-count') !== count) {
      this._settings.set_int('monitor-count', count);
    }
  }
}
