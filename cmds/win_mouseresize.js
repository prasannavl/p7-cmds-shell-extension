// cmds/win_mouseresize.js

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  connectObjectIfSignal,
  getCursorTracker,
  getDisplay,
  getFocusedWindow,
  getMonitorManager,
  getPointerData,
  normalizeWindow,
  setResizeCursor,
} from "../compat.js";
import { STATE_KEYS, STATE_MAP } from "../cmds.js";
import { createConflictKeybindingIndex } from "../utils.js";

const MIN_RESIZE_SIZE = 10;
const KEYBOARD_RESIZE_STEP = 100;
const DEFAULT_INDICATOR_BORDER = 3;
const DEFAULT_INDICATOR_BORDER_COLOR = "rgba(230, 105, 105, 0.8)";
const DEFAULT_INDICATOR_BACKGROUND_COLOR = "rgba(70, 70, 70, 0.2)";

export function win_mouseresize(config, logger) {
  const state = createState();
  const win = getFocusedWindow();
  if (!win) {
    logger.verboseLog("win_mouseresize: no focused window");
    return;
  }
  logger.verboseLog("win_mouseresize: enter resize mode");

  normalizeWindow(win);

  const exitResize = (reason) => {
    if (!state.active) {
      return;
    }
    end();
    logger.verboseLog(`win_mouseresize: exit resize mode (${reason})`);
  };

  if (!beginModalGrab(state, exitResize)) {
    logger.verboseLog("win_mouseresize: failed to grab modal input");
    end(state);
    return;
  }
  suppressSuperArrowBindings(state, logger);

  state.active = true;
  state.win = win;
  state.winId = win.get_id();
  const indicatorConfig = resolveIndicatorConfig(config);
  state.indicatorColors = indicatorConfig.colors;
  state.indicatorBorderSize = indicatorConfig.borderSize;
  state.edges = null;
  state.startRect = cloneRect(win.get_frame_rect());
  state.currentRect = cloneRect(state.startRect);
  state.minSize = getWindowMinSize(win);
  state.startPoint = getPointerPoint();
  state.shiftPressed = hasShiftKeyPressed();

  const handlePointerMove = () => {
    const point = getPointerPoint();

    if (!ensureLockedEdges(state, point, state.startRect)) {
      return true;
    }

    const targetRect = computeResizeRect(
      state.startRect,
      state.edges,
      state.startPoint,
      point,
      state.minSize,
    );
    if (targetRect) {
      queueResizeRect(state, targetRect, point, "mouse");
    }
    return true;
  };

  setResizeCursor(true);
  updateResizeIndicator(state, state.startRect);

  const handleWindowRectChange = () => {
    if (!state.active || !state.win) {
      return;
    }
    const rect = state.win.get_frame_rect?.();
    if (rect) {
      const anchoredRect = enforceLastRequestedAnchors(state, rect);
      syncCurrentRect(state, anchoredRect);
      queueIndicatorSync(state, anchoredRect);
    }
  };
  state.win.connectObject("size-changed", handleWindowRectChange, state);
  state.win.connectObject("position-changed", handleWindowRectChange, state);

  const tracker = getCursorTracker();
  if (!tracker) {
    logger.verboseLog("win_mouseresize: no cursor tracker");
    end(state);
    return;
  }

  state.cursorTracker = tracker;
  tracker.connect(handlePointerMove, state);

  connectExitSignals(state, exitResize);
}

export function win_mouseresize_destroy() {
  end();
}

function end(existingState) {
  const state = existingState || STATE_MAP.get(STATE_KEYS.WIN_MOUSE_RESIZE);
  if (!state) {
    return;
  }
  restoreSuppressedBindings(state);
  releaseModalGrab(state);
  setResizeCursor(false);
  Main.overview?.disconnectObject?.(state);
  global.workspace_manager?.disconnectObject?.(state);
  getDisplay()?.disconnectObject?.(state);
  getMonitorManager()?.disconnectObject?.(state);
  global.stage?.disconnectObject?.(state);
  state.cursorTracker?.disconnect(state);
  state.win?.disconnectObject(state);
  if (state.resizeSourceId) {
    GLib.source_remove(state.resizeSourceId);
  }
  if (state.indicatorSourceId) {
    GLib.source_remove(state.indicatorSourceId);
  }
  if (state.superWatchSourceId) {
    GLib.source_remove(state.superWatchSourceId);
  }
  state.indicator?.destroy();
  resetState(state);
}

// Queue helpers

function getPointerPoint() {
  const { x, y } = getPointerData();
  return { x, y };
}

function getPointDelta(fromPoint, toPoint) {
  return {
    x: toPoint.x - fromPoint.x,
    y: toPoint.y - fromPoint.y,
  };
}

function queueResizeRect(state, rect, point, mode) {
  state.pendingResize = {
    rect: cloneRect(rect),
    point: point ? { x: point.x, y: point.y } : null,
    mode,
  };
  if (state.resizeSourceId) {
    return;
  }
  state.resizeSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    state.resizeSourceId = 0;
    const pendingResize = state.pendingResize;
    state.pendingResize = null;
    if (!state.active || !state.win || !pendingResize?.rect) {
      return GLib.SOURCE_REMOVE;
    }
    state.lastResizeRect = cloneRect(pendingResize.rect);
    applyResizeRect(state.win, pendingResize.rect);
    syncCurrentRect(state, pendingResize.rect);
    queueIndicatorSync(state, pendingResize.rect);

    if (pendingResize.mode === "keyboard") {
      reanchorMouseResize(state, pendingResize.rect, getPointerPoint());
    }

    return GLib.SOURCE_REMOVE;
  });
}

function queueIndicatorSync(state, rect) {
  state.pendingRect = cloneRect(rect);
  if (state.indicatorSourceId) {
    return;
  }
  state.indicatorSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    state.indicatorSourceId = 0;
    if (!state.active || !state.pendingRect) {
      return GLib.SOURCE_REMOVE;
    }
    const rect = cloneRect(state.win?.get_frame_rect?.()) ?? state.pendingRect;
    state.pendingRect = null;
    updateResizeIndicator(state, rect);
    return GLib.SOURCE_REMOVE;
  });
}

function syncCurrentRect(state, rect) {
  state.currentRect = cloneRect(rect);
}

function reanchorMouseResize(state, rect, point) {
  state.startRect = cloneRect(rect);
  state.startPoint = { x: point.x, y: point.y };
}

function getResizeAnchorRect(state) {
  return cloneRect(state.pendingResize?.rect) ?? cloneRect(state.currentRect);
}

function hasLockedEdges(edges) {
  return Boolean(edges?.left || edges?.right || edges?.top || edges?.bottom);
}

function flipLockedEdges(state) {
  if (!hasLockedEdges(state.edges)) {
    return false;
  }

  state.edges = {
    left: Boolean(state.edges.right),
    right: Boolean(state.edges.left),
    top: Boolean(state.edges.bottom),
    bottom: Boolean(state.edges.top),
  };

  reanchorMouseResize(state, getResizeAnchorRect(state), getPointerPoint());
  return true;
}

function handleShiftPress(state) {
  if (state.shiftPressed) {
    return false;
  }
  state.shiftPressed = true;
  return flipLockedEdges(state);
}

function syncShiftKeyState(state) {
  if (hasShiftKeyPressed()) {
    return handleShiftPress(state);
  }
  state.shiftPressed = false;
  return false;
}

function enforceLastRequestedAnchors(state, actualRect) {
  const requestedRect = state.lastResizeRect;
  if (!actualRect || !requestedRect || !state.edges) {
    return actualRect;
  }

  let x = actualRect.x;
  let y = actualRect.y;
  if (state.edges.right) {
    x = requestedRect.x;
  } else if (state.edges.left) {
    x = requestedRect.x + requestedRect.width - actualRect.width;
  }
  if (state.edges.bottom) {
    y = requestedRect.y;
  } else if (state.edges.top) {
    y = requestedRect.y + requestedRect.height - actualRect.height;
  }

  if (x === actualRect.x && y === actualRect.y) {
    return actualRect;
  }

  const anchoredRect = {
    x,
    y,
    width: actualRect.width,
    height: actualRect.height,
  };
  applyResizeRect(state.win, anchoredRect);
  return anchoredRect;
}

// Window helpers

function cloneRect(rect) {
  if (!rect) {
    return null;
  }
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function getWindowMinSize(win) {
  let minWidth = MIN_RESIZE_SIZE;
  let minHeight = MIN_RESIZE_SIZE;
  if (win && typeof win.get_min_size === "function") {
    const [width, height] = win.get_min_size();
    minWidth = Math.max(MIN_RESIZE_SIZE, width);
    minHeight = Math.max(MIN_RESIZE_SIZE, height);
    return { width: minWidth, height: minHeight };
  }
  if (win && typeof win.get_size_hints === "function") {
    const hints = win.get_size_hints();
    if (hints) {
      minWidth = Math.max(MIN_RESIZE_SIZE, hints.min_width ?? minWidth);
      minHeight = Math.max(MIN_RESIZE_SIZE, hints.min_height ?? minHeight);
    }
  }
  return { width: minWidth, height: minHeight };
}

function ensureLockedEdges(state, point, rect) {
  const delta = getPointDelta(state.startPoint, point);
  return lockEdges(state, delta, state.startPoint, rect);
}

function ensureLockedEdgesForDelta(state, delta, point, rect) {
  return lockEdges(state, delta, point, rect);
}

function lockEdges(state, delta, point, rect) {
  if (!state.edges) {
    state.edges = { left: false, right: false, top: false, bottom: false };
  }
  const dx = delta.x;
  const dy = delta.y;
  if (!state.edges.left && !state.edges.right && dx !== 0) {
    const leftEdge = rect.x;
    const rightEdge = rect.x + rect.width;
    const distLeft = Math.abs(point.x - leftEdge);
    const distRight = Math.abs(point.x - rightEdge);
    const nearestIsRight = distRight < distLeft;
    if (dx < 0) {
      state.edges.right = nearestIsRight;
      state.edges.left = !nearestIsRight;
    } else if (dx > 0) {
      state.edges.left = distLeft < distRight;
      state.edges.right = !state.edges.left;
    }
  }
  if (!state.edges.top && !state.edges.bottom && dy !== 0) {
    const topEdge = rect.y;
    const bottomEdge = rect.y + rect.height;
    const distTop = Math.abs(point.y - topEdge);
    const distBottom = Math.abs(point.y - bottomEdge);
    const nearestIsBottom = distBottom < distTop;
    if (dy < 0) {
      state.edges.bottom = nearestIsBottom;
      state.edges.top = !nearestIsBottom;
    } else if (dy > 0) {
      state.edges.top = distTop < distBottom;
      state.edges.bottom = !state.edges.top;
    }
  }
  return (
    state.edges.left ||
    state.edges.right ||
    state.edges.top ||
    state.edges.bottom
  );
}

function computeResizeRect(rect, edges, startPoint, pointer, minSize) {
  if (!edges || (!edges.left && !edges.right && !edges.top && !edges.bottom)) {
    return null;
  }
  return computeResizeRectFromDelta(
    rect,
    edges,
    getPointDelta(startPoint, pointer),
    minSize,
  );
}

function computeResizeRectFromDelta(rect, edges, delta, minSize) {
  if (!edges || (!edges.left && !edges.right && !edges.top && !edges.bottom)) {
    return null;
  }
  const dx = delta.x;
  const dy = delta.y;
  const minWidth = minSize?.width ?? MIN_RESIZE_SIZE;
  const minHeight = minSize?.height ?? MIN_RESIZE_SIZE;

  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;

  if (edges.left) {
    left = Math.min(rect.x + dx, right - minWidth);
  } else if (edges.right) {
    right = Math.max(rect.x + rect.width + dx, left + minWidth);
  }

  if (edges.top) {
    top = Math.min(rect.y + dy, bottom - minHeight);
  } else if (edges.bottom) {
    bottom = Math.max(rect.y + rect.height + dy, top + minHeight);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function applyResizeRect(win, rect) {
  if (!rect) {
    return null;
  }
  const { x, y, width, height } = rect;
  win.move_resize_frame(true, x, y, width, height);
  return rect;
}

function getResizeStepDelta(symbol) {
  switch (symbol) {
    case Clutter.KEY_Left:
    case Clutter.KEY_KP_Left:
      return { x: -KEYBOARD_RESIZE_STEP, y: 0 };
    case Clutter.KEY_Right:
    case Clutter.KEY_KP_Right:
      return { x: KEYBOARD_RESIZE_STEP, y: 0 };
    case Clutter.KEY_Up:
    case Clutter.KEY_KP_Up:
      return { x: 0, y: -KEYBOARD_RESIZE_STEP };
    case Clutter.KEY_Down:
    case Clutter.KEY_KP_Down:
      return { x: 0, y: KEYBOARD_RESIZE_STEP };
    default:
      return null;
  }
}

function isShiftKeySymbol(symbol) {
  return symbol === Clutter.KEY_Shift_L || symbol === Clutter.KEY_Shift_R;
}

function handleResizeKeyPress(state, symbol) {
  if (isShiftKeySymbol(symbol)) {
    handleShiftPress(state);
    return Clutter.EVENT_STOP;
  }

  const delta = getResizeStepDelta(symbol);
  if (!delta) {
    return Clutter.EVENT_PROPAGATE;
  }

  const point = getPointerPoint();
  ensureLockedEdgesForDelta(state, delta, point, state.currentRect);
  const targetRect = computeResizeRectFromDelta(
    state.currentRect,
    state.edges,
    delta,
    state.minSize,
  );
  if (targetRect) {
    queueResizeRect(state, targetRect, point, "keyboard");
  }
  return Clutter.EVENT_STOP;
}

function handleResizeKeyRelease(state, event, exitResize) {
  if (!hasSuperKeyPressed()) {
    exitResize(`event ${event.type()}`);
    return Clutter.EVENT_STOP;
  }

  const keySymbol = event.get_key_symbol?.();
  if (isShiftKeySymbol(keySymbol)) {
    state.shiftPressed = false;
    return Clutter.EVENT_STOP;
  }

  if (
    keySymbol === Clutter.KEY_Left ||
    keySymbol === Clutter.KEY_KP_Left ||
    keySymbol === Clutter.KEY_Right ||
    keySymbol === Clutter.KEY_KP_Right ||
    keySymbol === Clutter.KEY_Up ||
    keySymbol === Clutter.KEY_KP_Up ||
    keySymbol === Clutter.KEY_Down ||
    keySymbol === Clutter.KEY_KP_Down ||
    keySymbol === Clutter.KEY_Escape
  ) {
    return Clutter.EVENT_STOP;
  }

  return Clutter.EVENT_PROPAGATE;
}

function beginModalGrab(state, exitResize) {
  if (state.modalGrab) {
    return true;
  }

  const actor = new St.Widget({
    reactive: true,
    can_focus: true,
    opacity: 0,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });

  actor.connectObject(
    "key-press-event",
    (_actor, event) => {
      const keySymbol = event.get_key_symbol?.();
      if (keySymbol === Clutter.KEY_Escape) {
        exitResize("escape");
        return Clutter.EVENT_STOP;
      }
      return handleResizeKeyPress(state, keySymbol);
    },
    state,
  );
  actor.connectObject(
    "key-release-event",
    (_actor, event) => handleResizeKeyRelease(state, event, exitResize),
    state,
  );

  Main.uiGroup.add_child(actor);
  state.modalActor = actor;
  state.modalGrab = Main.pushModal(actor);
  if (!state.modalGrab) {
    releaseModalGrab(state);
    return false;
  }
  return true;
}

function releaseModalGrab(state) {
  if (state.modalGrab) {
    Main.popModal(state.modalGrab);
    state.modalGrab = null;
  }
  state.modalActor?.disconnectObject?.(state);
  state.modalActor?.destroy();
  state.modalActor = null;
}

function suppressSuperArrowBindings(state, logger) {
  state.suppressedBindings ??= new Map();
  if (state.suppressedBindings.size > 0) {
    return;
  }

  const { settings, keyNamesBySchema } = getConflictKeybindingIndex();
  for (const conflictSettings of settings) {
    const schema = conflictSettings.schema_id;
    const keys = keyNamesBySchema.get(schema) ?? [];
    for (const key of keys) {
      const bindings = conflictSettings.get_strv(key);
      if (!Array.isArray(bindings) || bindings.length === 0) {
        continue;
      }

      const filtered = bindings.filter((binding) =>
        !isSuperArrowBinding(binding)
      );
      if (filtered.length === bindings.length) {
        continue;
      }

      rememberSuppressedBinding(state, schema, key, bindings);
      conflictSettings.set_strv(key, filtered);
      logger.verboseLog(
        `win_mouseresize: suppressed ${schema}::${key} (${
          bindings.join(", ")
        })`,
      );
    }
  }
}

function restoreSuppressedBindings(state) {
  const { settingsBySchema } = getConflictKeybindingIndex();
  for (const [schema, keys] of state.suppressedBindings ?? []) {
    const settings = settingsBySchema.get(schema);
    if (!settings) {
      continue;
    }
    for (const [key, bindings] of keys) {
      settings.set_strv(key, bindings);
    }
  }
  state.suppressedBindings?.clear();
}

function rememberSuppressedBinding(state, schema, key, bindings) {
  if (!state.suppressedBindings.has(schema)) {
    state.suppressedBindings.set(schema, new Map());
  }
  const schemaBindings = state.suppressedBindings.get(schema);
  if (!schemaBindings.has(key)) {
    schemaBindings.set(key, bindings);
  }
}

function isSuperArrowBinding(binding) {
  if (typeof binding !== "string") {
    return false;
  }
  if (!binding.includes("<Super>")) {
    return false;
  }

  return /(?:^|>)(Left|Right|Up|Down|KP_Left|KP_Right|KP_Up|KP_Down)$/.test(
    binding,
  );
}

// Indicator helpers

function ensureResizeIndicator(state) {
  if (state.indicator) {
    return;
  }
  const borderColor = state.indicatorColors?.borderColor ??
    DEFAULT_INDICATOR_BORDER_COLOR;
  const backgroundColor = state.indicatorColors?.backgroundColor ??
    DEFAULT_INDICATOR_BACKGROUND_COLOR;
  const borderSize = getIndicatorBorderSize(state);
  const indicator = new St.Widget({
    reactive: false,
    style: `background-color: ${backgroundColor};` +
      `border: ${borderSize}px solid ${borderColor};` +
      "border-radius: 5px;",
  });
  indicator.hide();
  Main.uiGroup.add_child(indicator);
  state.indicator = indicator;
}

function updateResizeIndicator(state, rect) {
  ensureResizeIndicator(state);
  const indicator = state.indicator;
  const borderSize = getIndicatorBorderSize(state);
  const width = rect.width + borderSize * 2;
  const height = rect.height + borderSize * 2;
  const x = rect.x - borderSize;
  const y = rect.y - borderSize;
  indicator.set_position(x, y);
  indicator.set_size(width, height);
  indicator.show();
}

// State helpers

function createState() {
  let state = STATE_MAP.get(STATE_KEYS.WIN_MOUSE_RESIZE);
  if (state?.active) {
    end(state);
  }
  state = _newState();
  STATE_MAP.set(STATE_KEYS.WIN_MOUSE_RESIZE, state);
  return state;
}

function _newState() {
  return {
    active: false,
    cursorTracker: null,
    modalActor: null,
    modalGrab: null,
    suppressedBindings: new Map(),
    win: null,
    winId: null,
    indicator: null,
    indicatorColors: null,
    indicatorBorderSize: DEFAULT_INDICATOR_BORDER,
    edges: null,
    startRect: null,
    startPoint: null,
    currentRect: null,
    minSize: null,
    pendingResize: null,
    pendingRect: null,
    lastResizeRect: null,
    resizeSourceId: 0,
    indicatorSourceId: 0,
    superWatchSourceId: 0,
  };
}

function resetState(state) {
  Object.assign(state, _newState());
}

function getConflictKeybindingIndex() {
  let index = STATE_MAP.get(STATE_KEYS.WIN_MOUSE_RESIZE_CONFLICT_INDEX);
  if (!index) {
    index = createConflictKeybindingIndex();
    STATE_MAP.set(STATE_KEYS.WIN_MOUSE_RESIZE_CONFLICT_INDEX, index);
  }
  return index;
}

function normalizeIndicatorColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return isSafeIndicatorColor(trimmed) ? trimmed : fallback;
}

function isSafeIndicatorColor(value) {
  if (!value || /[;{}]/.test(value)) {
    return false;
  }
  return /^(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([\d\s.,%+-]+\)|[a-zA-Z][a-zA-Z0-9-]*)$/
    .test(
      value,
    );
}

function normalizeIndicatorBorderSize(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_INDICATOR_BORDER;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : DEFAULT_INDICATOR_BORDER;
}

function getIndicatorBorderSize(state) {
  return normalizeIndicatorBorderSize(state?.indicatorBorderSize);
}

function resolveIndicatorConfig(config) {
  const values = config?.winMouseResize ?? {};
  return {
    colors: {
      borderColor: normalizeIndicatorColor(
        values.borderColor,
        DEFAULT_INDICATOR_BORDER_COLOR,
      ),
      backgroundColor: normalizeIndicatorColor(
        values.backgroundColor,
        DEFAULT_INDICATOR_BACKGROUND_COLOR,
      ),
    },
    borderSize: normalizeIndicatorBorderSize(values.borderSize),
  };
}

// Signal helpers

function connectExitSignals(state, exitResize) {
  state.win.connectObject(
    "unmanaged",
    () => exitResize("window unmanaged"),
    state,
  );
  connectObjectIfSignal(
    global.stage,
    "captured-event",
    (_actor, event) => {
      const type = event.type();
      if (type === Clutter.EventType.KEY_STATE && syncShiftKeyState(state)) {
        return Clutter.EVENT_STOP;
      }
      if (
        type === Clutter.EventType.KEY_RELEASE ||
        type === Clutter.EventType.KEY_STATE
      ) {
        if (!hasSuperKeyPressed()) {
          exitResize(`event ${type}`);
        }
      }
      return Clutter.EVENT_PROPAGATE;
    },
    state,
  );

  connectObjectIfSignal(
    global.workspace_manager,
    "active-workspace-changed",
    () => exitResize("workspace changed"),
    state,
  );

  const monitorManager = getMonitorManager();
  connectObjectIfSignal(
    monitorManager,
    "monitors-changed",
    () => exitResize("monitors changed"),
    state,
  );

  connectOverviewSignals(state, () => exitResize("overview"));
  connectLayoutStateSignals(state, () => exitResize("layout state"));
  connectDisplaySignals(
    state,
    () => exitResize("display event"),
    () => {
      const focused = getFocusedWindow();
      if (!focused || focused.get_id() !== state.winId) {
        exitResize("focus changed");
      }
    },
  );

  state.superWatchSourceId = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT_IDLE,
    120,
    () => {
      if (!state.active) {
        state.superWatchSourceId = 0;
        return GLib.SOURCE_REMOVE;
      }
      if (!hasSuperKeyPressed()) {
        state.superWatchSourceId = 0;
        exitResize("super released");
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    },
  );
}

function hasSuperKeyPressed() {
  const SUPER_KEY_MASK = Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.META_MASK |
    Clutter.ModifierType.MOD4_MASK;
  const { modifiers } = getPointerData();
  return (modifiers & SUPER_KEY_MASK) !== 0;
}

function hasShiftKeyPressed() {
  const { modifiers } = getPointerData();
  return (modifiers & Clutter.ModifierType.SHIFT_MASK) !== 0;
}

function connectOverviewSignals(state, onEvent) {
  const overview = Main.overview;
  if (!overview) {
    return;
  }
  const signalNames = [
    "showing",
    "shown",
    "hiding",
    "hidden",
    "notify::visible",
  ];
  for (const name of signalNames) {
    connectObjectIfSignal(overview, name, onEvent, state);
  }
}

function connectLayoutStateSignals(state, onEvent) {
  const layoutManager = Main.layoutManager;
  if (!layoutManager) {
    return;
  }
  const targets = [
    layoutManager.overviewGroup,
    layoutManager._overviewGroup,
    layoutManager.panelBox,
    layoutManager._panelBox,
  ].filter(Boolean);
  const signalNames = ["notify::visible", "show", "hide"];
  for (const target of targets) {
    for (const name of signalNames) {
      connectObjectIfSignal(
        target,
        name,
        () => {
          onEvent();
        },
        state,
      );
    }
  }
}

function connectDisplaySignals(
  state,
  onEvent,
  onFocusChange,
) {
  const display = getDisplay();
  if (!display) {
    return;
  }
  const signalNames = [
    "window-created",
    "window-removed",
    "window-closed",
    "window-demands-attention",
    "window-marked-urgent",
    "restacked",
    "workareas-changed",
    "grab-op-begin",
    "grab-op-end",
  ];
  for (const name of signalNames) {
    connectObjectIfSignal(display, name, onEvent, state);
  }
  if (!connectObjectIfSignal(display, "focus-window", onFocusChange, state)) {
    connectObjectIfSignal(
      display,
      "notify::focus-window",
      onFocusChange,
      state,
    );
  }
}
