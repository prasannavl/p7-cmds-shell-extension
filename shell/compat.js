// compat.js

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import {
  acceleratorsEqual as compareAccelerators,
  createAcceleratorKeyNormalizer,
} from "../common/config.js";

export const MaximizeFlags = Meta.MaximizeFlags;

export function getDisplay() {
  return global.display;
}

export function getFocusedWindow() {
  return getDisplay().get_focus_window();
}

export function getWindowMonitor(win) {
  const monitor = win.get_monitor();
  const monitorCount = getDisplay().get_n_monitors();
  return monitor >= 0 && monitor < monitorCount ? monitor : null;
}

export function resolveTopLevelWindow(win) {
  if (!win) {
    return null;
  }

  let current = win;
  const seen = new Set([current]);
  while (true) {
    const parent = current.get_transient_for();
    if (!parent || seen.has(parent)) break;
    current = parent;
    seen.add(current);
  }

  return current;
}

export function getMaximizeState(metaWindow) {
  const flags = metaWindow.get_maximize_flags?.() ?? 0;
  const hFlag = Meta.MaximizeFlags?.HORIZONTAL ?? 1;
  const vFlag = Meta.MaximizeFlags?.VERTICAL ?? 2;
  const bothFlag = Meta.MaximizeFlags?.BOTH ?? hFlag | vFlag;

  let horizontal = (flags & hFlag) !== 0;
  let vertical = (flags & vFlag) !== 0;

  if (!flags) {
    horizontal = !!metaWindow.maximized_horizontally;
    vertical = !!metaWindow.maximized_vertically;
  }

  const any = horizontal || vertical;
  const full = flags ? (flags & bothFlag) === bothFlag : horizontal && vertical;

  return { any, full, horizontal, vertical };
}

export function isWindowMaximized(win) {
  return getMaximizeState(win).any;
}

export function isWindowFullscreen(win) {
  return win.is_fullscreen();
}

export function normalizeWindow(win) {
  let changed = false;
  if (isWindowFullscreen(win)) {
    win.unmake_fullscreen();
    changed = true;
  }
  if (isWindowMaximized(win)) {
    win.unmaximize(MaximizeFlags.BOTH);
    changed = true;
  }
  return changed;
}

export function isWindowRestored(win) {
  return !isWindowFullscreen(win) && !getMaximizeState(win).any;
}

export function connectWhenWindowRestored(win, owner, onRestored, onUnmanaged) {
  let finished = false;
  const finish = (callback) => {
    if (finished) return;
    finished = true;
    win.disconnectObject?.(owner);
    callback?.();
  };
  const applyIfReady = () => {
    if (isWindowRestored(win)) finish(onRestored);
  };

  win.connectObject(
    "size-changed",
    applyIfReady,
    "position-changed",
    applyIfReady,
    "unmanaged",
    () => finish(onUnmanaged),
    owner,
  );
  for (
    const signal of [
      "notify::fullscreen",
      "notify::maximized-horizontally",
      "notify::maximized-vertically",
    ]
  ) {
    connectObjectIfSignal(win, signal, applyIfReady, owner);
  }
  applyIfReady();
}

export function getCursorTracker() {
  const display = getDisplay();
  const tracker = global.backend.get_cursor_tracker
    ? global.backend.get_cursor_tracker()
    : Meta.CursorTracker.get_for_display(display);
  if (!tracker) return null;
  return {
    connect(handler, owner) {
      tracker.connectObject("position-invalidated", handler, owner);
    },
    disconnect(owner) {
      tracker.disconnectObject(owner);
    },
  };
}

// Do not assume obj is a GObject since this is low level method
// used across different abstractions; higher ones depend on this to
// validate and handle gracefully.
export function hasSignal(obj, name) {
  if (!obj) {
    return false;
  }
  if (name.startsWith("notify::")) {
    const propName = name.slice("notify::".length);
    return (
      typeof obj.find_property === "function" && !!obj.find_property(propName)
    );
  }
  const gtype = obj.constructor?.$gtype;
  if (!gtype || !GObject.type_is_a(gtype, GObject.TYPE_OBJECT)) {
    return false;
  }
  return GObject.signal_lookup(name, gtype);
}

export function connectObjectIfSignal(obj, name, handler, owner) {
  if (!hasSignal(obj, name)) {
    return false;
  }
  obj.connectObject(name, handler, owner);
  return true;
}

export function getMonitorManager() {
  return global.backend.get_monitor_manager();
}

export function setResizeCursor(active) {
  const display = getDisplay();

  // GNOME 45-47 use the older Meta cursor names and display API.
  if (Meta.Cursor?.MOVE_OR_RESIZE_WINDOW !== undefined) {
    const cursor = active
      ? Meta.Cursor.MOVE_OR_RESIZE_WINDOW
      : Meta.Cursor.DEFAULT;
    display.set_cursor(cursor);
    return;
  }

  // GNOME 48-50 use the modern cursor names. GNOME 50 moves them and the
  // cursor setter from Meta.Display to Clutter.Stage.
  const cursors = Meta.Cursor ?? Clutter.CursorType;
  const cursor = active
    ? (cursors.ALL_RESIZE ?? cursors.MOVE)
    : cursors.DEFAULT;
  if (Meta.Cursor) {
    display.set_cursor(cursor);
  } else {
    global.stage.set_cursor_type(cursor);
  }
}

export function getPointerData() {
  const [x, y, modifiers] = global.get_pointer();
  return { x, y, modifiers };
}

export const normalizeAcceleratorKey = createAcceleratorKeyNormalizer(
  Clutter,
  (keyval) => Clutter.keyval_convert_case(keyval)[0],
);

export function acceleratorsEqual(left, right) {
  return compareAccelerators(left, right, normalizeAcceleratorKey);
}
