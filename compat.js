// compat.js

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Meta from "gi://Meta";

export const MaximizeFlags = Meta.MaximizeFlags;

export function getDisplay() {
  return global.display;
}

export function getFocusedWindow() {
  const display = getDisplay();
  return display.get_focus_window();
}

export function getMaximizeState(metaWindow) {
  const flags = metaWindow.get_maximize_flags();
  const horizontal = (flags & MaximizeFlags.HORIZONTAL) !== 0;
  const vertical = (flags & MaximizeFlags.VERTICAL) !== 0;
  const any = horizontal || vertical;
  const full = (flags & MaximizeFlags.BOTH) === MaximizeFlags.BOTH;

  return { any, full, horizontal, vertical };
}

export function isWindowMaximized(win) {
  return getMaximizeState(win).any;
}

export function isWindowFullscreen(win) {
  return win.is_fullscreen();
}

export function normalizeWindow(win) {
  if (!win) {
    return;
  }
  if (isWindowFullscreen(win)) {
    win.unmake_fullscreen();
  }
  if (isWindowMaximized(win)) {
    win.unmaximize(MaximizeFlags.BOTH);
  }
}

export function getCursorTracker() {
  const display = getDisplay();
  const tracker = typeof global.backend?.get_cursor_tracker === "function"
    ? global.backend.get_cursor_tracker()
    : typeof Meta.CursorTracker?.get_for_display === "function"
    ? Meta.CursorTracker.get_for_display(display)
    : typeof display?.get_cursor_tracker === "function"
    ? display.get_cursor_tracker()
    : null;
  if (!tracker) {
    return null;
  }
  const cursorChangeSignal = hasSignal(tracker, "position-invalidated")
    ? "position-invalidated"
    : hasSignal(tracker, "position-changed")
    ? "position-changed"
    : null;
  if (!cursorChangeSignal) {
    return null;
  }
  return {
    connect(handler, owner) {
      tracker.connectObject(cursorChangeSignal, handler, owner);
      tracker.track_position?.();
    },
    disconnect(owner) {
      tracker.disconnectObject?.(owner);
      tracker.untrack_position?.();
    },
  };
}

export function hasSignal(obj, name) {
  if (!obj) {
    return false;
  }
  if (name.startsWith("notify::")) {
    const propName = name.slice("notify::".length);
    return typeof obj.find_property === "function" &&
      !!obj.find_property(propName);
  }
  const gtype = obj.constructor?.$gtype;
  if (!gtype) {
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
  const display = getDisplay();
  return global.backend.get_monitor_manager?.() ??
    display.get_monitor_manager();
}

export function setResizeCursor(active) {
  const display = getDisplay();
  const cursors = Meta.Cursor;
  const defaultCursorName = "DEFAULT";
  const resizeCursorNames = ["ALL_RESIZE", "MOVE"];
  const cursorName = active
    ? resizeCursorNames.find((name) => name in cursors) ??
      defaultCursorName
    : defaultCursorName;
  display.set_cursor(cursors[cursorName]);
}

function getDefaultSeat() {
  if (global.backend && typeof global.backend.get_default_seat === "function") {
    return global.backend.get_default_seat();
  }
  if (typeof Clutter.get_default_backend === "function") {
    const backend = Clutter.get_default_backend();
    if (backend && typeof backend.get_default_seat === "function") {
      return backend.get_default_seat();
    }
  }
  return null;
}

function getModifiers(seat, pointer) {
  return seat && typeof seat.get_key_modifiers === "function"
    ? seat.get_key_modifiers()
    : pointer && typeof pointer.get_modifier_state === "function"
    ? pointer.get_modifier_state()
    : 0;
}

export function getPointerData() {
  const seat = getDefaultSeat();
  if (seat && typeof seat.get_pointer_coords === "function") {
    const [x, y] = seat.get_pointer_coords();
    const modifiers = getModifiers(seat, null);
    return { x, y, modifiers };
  }

  const pointer = seat && typeof seat.get_pointer === "function"
    ? seat.get_pointer()
    : null;
  if (pointer && typeof pointer.get_coords === "function") {
    const [x, y] = pointer.get_coords();
    const modifiers = getModifiers(seat, pointer);
    return { x, y, modifiers };
  }

  if (
    Clutter.DeviceManager &&
    typeof Clutter.DeviceManager.get_default === "function"
  ) {
    const deviceManager = Clutter.DeviceManager.get_default();
    const pointerDevice = deviceManager.get_core_device(
      Clutter.InputDeviceType.POINTER_DEVICE,
    );
    const [x, y] = pointerDevice.get_coords();
    const modifiers = getModifiers(null, pointerDevice);
    return { x, y, modifiers };
  }

  const [x, y, modifiers] = global.get_pointer();
  return { x, y, modifiers };
}
