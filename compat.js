// compat.js

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Meta from "gi://Meta";

export const MaximizeFlags = Meta.MaximizeFlags ?? {
  HORIZONTAL: 1,
  VERTICAL: 2,
  BOTH: 3,
};

const RESIZE_CURSOR_CANDIDATES = ["ALL_RESIZE", "MOVE"];

export function getDisplay() {
  if (global.display) {
    return global.display;
  }
  if (typeof global.get_display === "function") {
    return global.get_display();
  }
  if (typeof global.backend?.get_display === "function") {
    return global.backend.get_display();
  }
  return null;
}

export function getFocusedWindow() {
  const display = getDisplay();
  if (!display) {
    return null;
  }
  if (typeof display.get_focus_window === "function") {
    return display.get_focus_window();
  }
  return display.focus_window || null;
}

export function getMaximizeState(metaWindow) {
  const flags = metaWindow?.get_maximize_flags?.() ?? 0;

  let horizontal = (flags & MaximizeFlags.HORIZONTAL) !== 0;
  let vertical = (flags & MaximizeFlags.VERTICAL) !== 0;

  if (!flags) {
    horizontal = !!metaWindow?.maximized_horizontally;
    vertical = !!metaWindow?.maximized_vertically;
  }

  const any = horizontal || vertical;
  const full = flags
    ? (flags & MaximizeFlags.BOTH) === MaximizeFlags.BOTH
    : horizontal && vertical;

  return { any, full, horizontal, vertical };
}

export function isWindowMaximized(win) {
  return getMaximizeState(win).any;
}

export function isWindowFullscreen(win) {
  if (!win) {
    return false;
  }
  if (typeof win.is_fullscreen === "function") {
    return win.is_fullscreen();
  }
  return !!win.fullscreen;
}

export function normalizeWindow(win) {
  if (!win) {
    return;
  }
  if (isWindowFullscreen(win) && typeof win.unmake_fullscreen === "function") {
    win.unmake_fullscreen();
  }
  if (isWindowMaximized(win) && typeof win.unmaximize === "function") {
    win.unmaximize(MaximizeFlags.BOTH);
  }
}

export function getCursorTracker() {
  // GNOME 49+ often consolidates backend access
  if (typeof global.backend?.get_cursor_tracker === "function") {
    return global.backend.get_cursor_tracker();
  }
  // Standard Mutter API (Stable across many versions)
  const display = getDisplay();
  if (display && typeof Meta.CursorTracker?.get_for_display === "function") {
    return Meta.CursorTracker.get_for_display(display);
  }
  // Fallback for older Shell versions or specific builds
  if (display && typeof display.get_cursor_tracker === "function") {
    return display.get_cursor_tracker();
  }
  return null;
}

export function getCursorPositionSignalName(tracker) {
  if (!tracker) {
    return null;
  }
  const gtype = tracker.constructor?.$gtype;
  if (!gtype) {
    return null;
  }
  if (GObject.signal_lookup("position-invalidated", gtype)) {
    return "position-invalidated";
  }
  if (GObject.signal_lookup("position-changed", gtype)) {
    return "position-changed";
  }
  return null;
}

export function hasSignal(obj, name) {
  const gtype = obj?.constructor?.$gtype;
  if (!gtype) {
    return false;
  }
  if (name.startsWith("notify::")) {
    const propName = name.slice("notify::".length);
    if (!propName) {
      return false;
    }
    if (typeof obj.find_property === "function") {
      return !!obj.find_property(propName);
    }
    return false;
  }
  return GObject.signal_lookup(name, gtype);
}

export function connectObjectIfSignal(obj, name, handler, owner) {
  if (!obj || !hasSignal(obj, name)) {
    return false;
  }
  obj.connectObject(name, handler, owner);
  return true;
}

export function getMonitorManager() {
  if (typeof global.backend?.get_monitor_manager === "function") {
    return global.backend.get_monitor_manager();
  }
  const display = getDisplay();
  if (display && typeof display.get_monitor_manager === "function") {
    return display.get_monitor_manager();
  }
  return null;
}

export function setResizeCursor(active) {
  const display = getDisplay();
  if (!display || typeof display.set_cursor !== "function") {
    return;
  }
  const cursors = Meta.Cursor || {};
  let cursor = null;
  if (active) {
    for (const name of RESIZE_CURSOR_CANDIDATES) {
      if (name in cursors) {
        cursor = cursors[name];
        break;
      }
    }
  } else if ("DEFAULT" in cursors) {
    cursor = cursors.DEFAULT;
  }
  if (cursor !== null) {
    display.set_cursor(cursor);
  }
}

export function getPointerData() {
  const backend =
    global.backend && typeof global.backend.get_default_seat === "function"
      ? global.backend
      : typeof Clutter.get_default_backend === "function"
      ? Clutter.get_default_backend()
      : null;
  const seat = backend && typeof backend.get_default_seat === "function"
    ? backend.get_default_seat()
    : null;

  // Try Seat API (GNOME 49+ preferred)
  if (seat) {
    if (typeof seat.get_pointer_coords === "function") {
      const [x, y] = seat.get_pointer_coords();
      const modifiers = seat.get_key_modifiers();
      return { x, y, modifiers };
    }
    const pointer = typeof seat.get_pointer === "function"
      ? seat.get_pointer()
      : null;
    if (pointer && typeof pointer.get_coords === "function") {
      const [x, y] = pointer.get_coords();
      const modifiers = typeof seat.get_key_modifiers === "function"
        ? seat.get_key_modifiers()
        : typeof pointer.get_modifier_state === "function"
        ? pointer.get_modifier_state()
        : 0;
      return { x, y, modifiers };
    }
  }

  // Fallback to DeviceManager (GNOME 45-48)
  if (
    Clutter.DeviceManager &&
    typeof Clutter.DeviceManager.get_default === "function"
  ) {
    const deviceManager = Clutter.DeviceManager.get_default();
    const pointer = deviceManager.get_core_device(
      Clutter.InputDeviceType.POINTER_DEVICE,
    );
    if (pointer) {
      const [x, y] = pointer.get_coords();
      const modifiers = pointer.get_modifier_state();
      return { x, y, modifiers };
    }
  }

  // Absolute fallback
  const [x, y, modifiers] = global.get_pointer();
  return { x, y, modifiers };
}
