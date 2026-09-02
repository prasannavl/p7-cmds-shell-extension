// cmds/win_mouseresize.js

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  DEFAULT_INDICATOR_BACKGROUND_COLOR,
  DEFAULT_INDICATOR_BORDER_COLOR,
  isSuperArrowBinding,
  normalizeIndicatorBorderSize,
  resolveIndicatorConfig,
} from "../common/config.js";
import {
  acceleratorsEqual,
  connectObjectIfSignal,
  connectWhenWindowRestored,
  getCursorTracker,
  getDisplay,
  getFocusedWindow,
  getMonitorManager,
  getPointerData,
  normalizeWindow,
  setResizeCursor,
} from "../ext/compat.js";
import {
  cloneRect,
  computeResizeRect as computeResizeRectFromDelta,
  flipLockedEdges,
  getPointDelta,
  hasLockedEdges,
  lockResizeEdges,
  MIN_RESIZE_SIZE,
  preserveResizeAnchors,
  rectEquals,
} from "../common/window.js";
import {
  createConflictKeybindingIndex,
  KeybindingOverrideLease,
} from "../common/keybindings.js";

const KEYBOARD_RESIZE_STEP = 100;
const STATE_KEY = "cmd-win-mouseresize";
const CONFLICT_INDEX_KEY = "cmd-win-mouseresize-conflict-index";

export function win_mouseresize(stateMap, config, logger) {
  const state = createState(stateMap);
  const win = getFocusedWindow();
  if (!win) {
    logger.verboseLog("win_mouseresize: no focused window");
    return;
  }
  logger.verboseLog("win_mouseresize: enter resize mode");

  state.win = win;
  state.winId = win.get_id();
  if (normalizeWindow(win)) {
    logger.verboseLog(
      "win_mouseresize: waiting for restored window before resizing",
    );
    connectWhenWindowRestored(
      win,
      state,
      () => {
        if (stateMap.get(STATE_KEY) === state) {
          beginMouseResize(state, config, logger);
        }
      },
      () => end(state),
    );
    return;
  }

  beginMouseResize(state, config, logger);
}

function beginMouseResize(state, config, logger) {
  const win = state.win;

  const exitResize = (reason) => {
    if (!state.active) {
      return;
    }
    end(state);
    logger.verboseLog(`win_mouseresize: exit resize mode (${reason})`);
  };

  if (!beginModalGrab(state, exitResize)) {
    logger.verboseLog("win_mouseresize: failed to grab modal input");
    end(state);
    return;
  }
  suppressSuperArrowBindings(state, logger);

  state.active = true;
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

export function win_mouseresize_destroy(stateMap) {
  end(stateMap.get(STATE_KEY));
}

function end(state) {
  if (!state) {
    return;
  }
  restoreSuppressedBindings(state);
  releaseModalGrab(state);
  if (state.active) setResizeCursor(false);
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

function flipAndReanchor(state) {
  const flipped = flipLockedEdges(state.edges);
  if (!flipped) return false;

  state.edges = flipped;
  reanchorMouseResize(state, getResizeAnchorRect(state), getPointerPoint());
  return true;
}

function handleShiftPress(state) {
  if (state.shiftPressed) {
    return false;
  }
  state.shiftPressed = true;
  return flipAndReanchor(state);
}

function syncShiftKeyState(state) {
  if (hasShiftKeyPressed()) {
    return handleShiftPress(state);
  }
  state.shiftPressed = false;
  return false;
}

function enforceLastRequestedAnchors(state, actualRect) {
  const anchored = preserveResizeAnchors(
    actualRect,
    state.lastResizeRect,
    state.edges,
  );
  if (!rectEquals(anchored, actualRect)) applyResizeRect(state.win, anchored);
  return anchored;
}

// Window helpers

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
  state.edges = lockResizeEdges(state.edges, delta, point, rect);
  return hasLockedEdges(state.edges);
}

function computeResizeRect(rect, edges, startPoint, pointer, minSize) {
  return computeResizeRectFromDelta(
    rect,
    edges,
    getPointDelta(startPoint, pointer),
    minSize,
  );
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
  if (state.bindingOverrides) {
    return;
  }

  state.bindingOverrides = new KeybindingOverrideLease(
    getConflictKeybindingIndex(state.stateMap),
    acceleratorsEqual,
  );
  const changes = state.bindingOverrides.suppressMatching(isSuperArrowBinding);
  for (const { schemaId, key, bindings } of changes) {
    logger.verboseLog(
      `win_mouseresize: suppressed ${schemaId}::${key} (${
        bindings.join(", ")
      })`,
    );
  }
}

function restoreSuppressedBindings(state) {
  state.bindingOverrides?.restore();
  state.bindingOverrides = null;
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

function createState(stateMap) {
  let state = stateMap.get(STATE_KEY);
  if (state) {
    end(state);
  }
  state = _newState(stateMap);
  stateMap.set(STATE_KEY, state);
  return state;
}

function _newState(stateMap) {
  return {
    stateMap,
    active: false,
    cursorTracker: null,
    modalActor: null,
    modalGrab: null,
    bindingOverrides: null,
    win: null,
    winId: null,
    indicator: null,
    indicatorColors: null,
    indicatorBorderSize: normalizeIndicatorBorderSize(),
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
  Object.assign(state, _newState(state.stateMap));
}

function getConflictKeybindingIndex(stateMap) {
  let index = stateMap.get(CONFLICT_INDEX_KEY);
  if (!index) {
    index = createConflictKeybindingIndex();
    stateMap.set(CONFLICT_INDEX_KEY, index);
  }
  return index;
}

function getIndicatorBorderSize(state) {
  return normalizeIndicatorBorderSize(state?.indicatorBorderSize);
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
