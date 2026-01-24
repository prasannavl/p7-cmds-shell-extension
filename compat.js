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
  return global.backend.get_cursor_tracker?.() ??
    Meta.CursorTracker.get_for_display(display);
}

export function hasSignal(obj, name) {
  const gtype = obj.constructor.$gtype;
  if (name.startsWith("notify::")) {
    const propName = name.slice("notify::".length);
    return !!obj.find_property(propName);
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

export function getPointerData() {
  const seat = global.backend.get_default_seat();
  if (seat.get_pointer_coords) {
    const [x, y] = seat.get_pointer_coords();
    const modifiers = seat.get_key_modifiers();
    return { x, y, modifiers };
  }

  const pointer = seat.get_pointer();
  if (pointer) {
    const [x, y] = pointer.get_coords();
    const modifiers = seat.get_key_modifiers?.() ??
      pointer.get_modifier_state();
    return { x, y, modifiers };
  }

  const deviceManager = Clutter.DeviceManager.get_default();
  const pointerDevice = deviceManager.get_core_device(
    Clutter.InputDeviceType.POINTER_DEVICE,
  );
  const [x, y] = pointerDevice.get_coords();
  const modifiers = pointerDevice.get_modifier_state();
  return { x, y, modifiers };
}
