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

const MIN_RESIZE_SIZE = 10;
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

  state.active = true;
  state.win = win;
  state.winId = win.get_id();
  const indicatorConfig = resolveIndicatorConfig(config);
  state.indicatorColors = indicatorConfig.colors;
  state.indicatorBorderSize = indicatorConfig.borderSize;
  state.edges = null;
  state.startRect = win.get_frame_rect();
  state.minSize = getWindowMinSize(win);
  {
    const { x, y } = getPointerData();
    state.startPoint = { x, y };
  }

  const exitResize = (reason) => {
    if (!state.active) {
      return;
    }
    end();
    logger.verboseLog(`win_mouseresize: exit resize mode (${reason})`);
  };

  const handlePointerMove = () => {
    const { x, y } = getPointerData();
    const point = { x, y };

    if (!ensureLockedEdges(state, point, state.startRect)) {
      return true;
    }

    queueResize(state, point, logger);
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
      queueIndicatorSync(state, rect);
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
  if (state.eventFilterId) {
    Clutter.Event.remove_filter(state.eventFilterId);
  }
  state.indicator?.destroy();
  resetState(state);
}

// Queue helpers

function queueResize(state, point, logger) {
  state.pendingPoint = point;
  if (state.resizeSourceId) {
    return;
  }
  state.resizeSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    state.resizeSourceId = 0;
    if (!state.active || !state.win || !state.pendingPoint) {
      return GLib.SOURCE_REMOVE;
    }
    const point = state.pendingPoint;
    state.pendingPoint = null;
    const targetRect = computeResizeRect(
      state.startRect,
      state.edges,
      state.startPoint,
      point,
      state.minSize,
    );
    if (targetRect) {
      applyResizeRect(state.win, targetRect, state.edges, logger);
    }
    return GLib.SOURCE_REMOVE;
  });
}

function queueIndicatorSync(state, rect) {
  // If we already have an indicator sync in queue
  // we swap out the state, so reuse the existing
  // sync, but make it use the latest data instead
  // of having to reschedule a new sync and cancel
  // the old one.
  state.pendingRect = rect;
  if (state.indicatorSourceId) {
    return;
  }
  state.indicatorSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    state.indicatorSourceId = 0;
    if (!state.active || !state.pendingRect) {
      return GLib.SOURCE_REMOVE;
    }
    const rect = state.pendingRect;
    state.pendingRect = null;
    updateResizeIndicator(state, rect);
    return GLib.SOURCE_REMOVE;
  });
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
  if (!state.edges) {
    state.edges = { left: false, right: false, top: false, bottom: false };
  }
  const dx = point.x - state.startPoint.x;
  const dy = point.y - state.startPoint.y;
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
  const dx = pointer.x - startPoint.x;
  const dy = pointer.y - startPoint.y;
  const minWidth = minSize?.width ?? MIN_RESIZE_SIZE;
  const minHeight = minSize?.height ?? MIN_RESIZE_SIZE;

  let x = rect.x;
  let y = rect.y;
  let width = rect.width;
  let height = rect.height;

  if (edges.left) {
    x = rect.x + dx;
    width = rect.width - dx;
  } else if (edges.right) {
    width = rect.width + dx;
  }

  if (edges.top) {
    y = rect.y + dy;
    height = rect.height - dy;
  } else if (edges.bottom) {
    height = rect.height + dy;
  }

  if (width < minWidth) {
    width = minWidth;
    if (edges.left) {
      x = rect.x + rect.width - width;
    }
  }

  if (height < minHeight) {
    height = minHeight;
    if (edges.top) {
      y = rect.y + rect.height - height;
    }
  }

  return { x, y, width, height };
}

function applyResizeRect(win, rect, edges, logger) {
  if (!rect) {
    logger.verboseLog("win_mouseresize: no edges enabled");
    return null;
  }
  const { x, y, width, height } = rect;
  logger.verboseLog(
    `win_mouseresize: ${edges.left ? "left" : edges.right ? "right" : "-"},${
      edges.top ? "top" : edges.bottom ? "bottom" : "-"
    } -> ${width}x${height} @ ${x},${y}`,
  );
  win.move_resize_frame(true, x, y, width, height);
  return rect;
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
    win: null,
    winId: null,
    indicator: null,
    indicatorColors: null,
    indicatorBorderSize: DEFAULT_INDICATOR_BORDER,
    edges: null,
    startRect: null,
    startPoint: null,
    minSize: null,
    pendingPoint: null,
    pendingRect: null,
    resizeSourceId: 0,
    indicatorSourceId: 0,
    eventFilterId: 0,
  };
}

function resetState(state) {
  Object.assign(state, _newState());
}

function normalizeIndicatorColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
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

    state.eventFilterId = Clutter.Event.add_filter(
    global.stage,
    (event) => {
      if (!state.active) {
        return Clutter.EVENT_PROPAGATE;
      }
      const type = event.type();
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
}

function hasSuperKeyPressed() {
  const SUPER_KEY_MASK = Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.META_MASK |
    Clutter.ModifierType.MOD4_MASK;
  const { modifiers } = getPointerData();
  return (modifiers & SUPER_KEY_MASK) !== 0;
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

function connectDisplaySignals(state, onEvent, onFocusChange) {
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
