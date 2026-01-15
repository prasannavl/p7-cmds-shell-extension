// cmds/win_mouseresize.js

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  connectObjectIfSignal,
  getCursorPositionSignalName,
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
const INDICATOR_BORDER = 3;

export function win_mouseresize(_config, logger) {
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

  connectObjectIfSignal(
    state.win,
    "unmanaged",
    () => exitResize("window unmanaged"),
    state,
  );
  const handleWindowRectChange = () => {
    if (!state.active || !state.win) {
      return;
    }
    const rect = state.win.get_frame_rect?.();
    if (rect) {
      queueIndicatorSync(state, rect);
    }
  };
  connectObjectIfSignal(
    state.win,
    "size-changed",
    handleWindowRectChange,
    state,
  );
  connectObjectIfSignal(
    state.win,
    "position-changed",
    handleWindowRectChange,
    state,
  );

  const tracker = getCursorTracker();
  if (!tracker) {
    logger.verboseLog("win_mouseresize: no cursor tracker");
    end(state);
    return;
  }
  state.tracker = tracker;
  const signalName = getCursorPositionSignalName(tracker);
  if (!signalName) {
    logger.verboseLog("win_mouseresize: no cursor position signal");
    end(state);
    return;
  }
  if (typeof tracker.track_position === "function") {
    tracker.track_position();
    state.trackedPosition = true;
  }
  connectObjectIfSignal(tracker, signalName, handlePointerMove, state);

  const handleGlobalEvent = (_actor, event) => {
    if (!state.active) {
      return Clutter.EVENT_PROPAGATE;
    }
    const type = event.type();
    if (
      type === Clutter.EventType.MOTION ||
      type === Clutter.EventType.BUTTON_RELEASE ||
      type === Clutter.EventType.KEY_RELEASE ||
      type === Clutter.EventType.TOUCHPAD_HOLD
    ) {
      return Clutter.EVENT_PROPAGATE;
    }
    exitResize(`event ${type} (${getEventTypeName(type)})`);
    return Clutter.EVENT_PROPAGATE;
  };

  connectObjectIfSignal(
    global.stage,
    "captured-event",
    handleGlobalEvent,
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
  if (state.tracker) {
    state.tracker.disconnectObject(state);
  }
  if (
    state.trackedPosition &&
    typeof state.tracker?.untrack_position === "function"
  ) {
    state.tracker.untrack_position();
  }
  if (state.win) {
    state.win.disconnectObject(state);
  }
  if (state.resizeSourceId) {
    GLib.source_remove(state.resizeSourceId);
  }
  if (state.indicatorSourceId) {
    GLib.source_remove(state.indicatorSourceId);
  }
  if (state.indicator) {
    state.indicator.destroy();
  }
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
  const indicator = new St.Widget({
    reactive: false,
    style: "background-color: rgba(255, 255, 255, 0.1);" +
      `border: ${INDICATOR_BORDER}px solid rgba(255, 255, 255, 0.8);` +
      "border-radius: 5px;",
  });
  indicator.hide();
  Main.uiGroup.add_child(indicator);
  state.indicator = indicator;
}

function updateResizeIndicator(state, rect) {
  ensureResizeIndicator(state);
  const indicator = state.indicator;
  indicator.set_position(rect.x - INDICATOR_BORDER, rect.y - INDICATOR_BORDER);
  indicator.set_size(
    rect.width + INDICATOR_BORDER * 2,
    rect.height + INDICATOR_BORDER * 2,
  );
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
    tracker: null,
    win: null,
    winId: null,
    indicator: null,
    edges: null,
    startRect: null,
    startPoint: null,
    minSize: null,
    trackedPosition: false,
    pendingPoint: null,
    pendingRect: null,
    resizeSourceId: 0,
    indicatorSourceId: 0,
  };
}

function resetState(state) {
  Object.assign(state, _newState());
}

// Signal helpers

function getEventTypeName(type) {
  for (const [name, value] of Object.entries(Clutter.EventType)) {
    if (value === type) {
      return name;
    }
  }
  return `UNKNOWN_${type}`;
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
        (actor) => {
          if (name === "notify::visible" && !actor?.visible) {
            return;
          }
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
