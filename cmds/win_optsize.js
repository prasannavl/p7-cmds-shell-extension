// cmds/win_optsize.js

import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { DEFAULT_WIN_OPTSIZE_CONFIG } from "../common.js";
import { normalizeWinOptsizeConfig } from "../utils.js";
import {
  connectObjectIfSignal,
  getFocusedWindow,
  getMaximizeState,
  isWindowFullscreen,
  normalizeWindow,
  resolveTopLevelWindow,
} from "../compat.js";
import { STATE_KEYS, STATE_MAP } from "../cmds.js";

const OVERSIZED_EXACT_SCALE_FALLBACK = 0.95;

export function win_optsize(config, logger) {
  const focusedWindow = getFocusedWindow?.() ?? global.display.focus_window;
  const win = resolveTopLevelWindow(focusedWindow);
  if (!win) {
    return;
  }

  if (focusedWindow && focusedWindow !== win) {
    logger?.verboseLog?.(
      "win_optsize: resolved focused transient window to top-level parent",
    );
  }

  const cycleState = getWinOptsizeState(win);
  cancelPendingWinOptsize(win, cycleState);
  cancelPendingWinOptsizeSync(cycleState);

  maybeResetWinOptsizeCycle(win, cycleState, logger);

  if (normalizeWindow(win)) {
    cycleState.index = -1;
    cycleState.originalRect = null;
    cycleState.lastAppliedRect = null;
    logger?.verboseLog?.(
      "win_optsize: waiting for restored window before applying optsize",
    );
    queuePendingWinOptsize(win, config, logger, cycleState);
    return;
  }

  applyWinOptsize(win, config, cycleState);
}

function getWinOptsizeState(win) {
  const winId = win.get_id();
  let cycleState = STATE_MAP.get(STATE_KEYS.WIN_OPTSIZE);
  if (!cycleState || cycleState.winId !== winId) {
    cycleState = {
      win,
      winId,
      index: -1,
      originalRect: null,
      lastAppliedRect: null,
      pending: null,
      syncSourceId: 0,
    };
    STATE_MAP.set(STATE_KEYS.WIN_OPTSIZE, cycleState);
  }
  return cycleState;
}

export function win_optsize_destroy() {
  const cycleState = STATE_MAP.get(STATE_KEYS.WIN_OPTSIZE);
  if (!cycleState?.win) {
    return;
  }
  cancelPendingWinOptsize(cycleState.win, cycleState);
  cancelPendingWinOptsizeSync(cycleState);
}

function queuePendingWinOptsize(win, config, logger, cycleState) {
  const pending = {};
  const applyIfReady = () => {
    if (cycleState.pending !== pending || !isRestoredWindow(win)) {
      return;
    }
    cancelPendingWinOptsize(win, cycleState, pending);
    logger?.verboseLog?.("win_optsize: applying optsize after restore");
    applyWinOptsize(win, config, cycleState);
  };

  cycleState.pending = pending;
  win.connectObject("size-changed", applyIfReady, pending);
  win.connectObject("position-changed", applyIfReady, pending);
  connectObjectIfSignal(
    win,
    "notify::fullscreen",
    applyIfReady,
    pending,
  );
  connectObjectIfSignal(
    win,
    "notify::maximized-horizontally",
    applyIfReady,
    pending,
  );
  connectObjectIfSignal(
    win,
    "notify::maximized-vertically",
    applyIfReady,
    pending,
  );
  win.connectObject(
    "unmanaged",
    () => cancelPendingWinOptsize(win, cycleState, pending),
    pending,
  );
  applyIfReady();
}

function cancelPendingWinOptsize(
  win,
  cycleState,
  pending = cycleState.pending,
) {
  if (!pending) {
    return;
  }
  if (cycleState.pending === pending) {
    cycleState.pending = null;
  }
  win.disconnectObject?.(pending);
}

function cancelPendingWinOptsizeSync(cycleState) {
  if (!cycleState?.syncSourceId) {
    return;
  }
  GLib.source_remove(cycleState.syncSourceId);
  cycleState.syncSourceId = 0;
}

function isRestoredWindow(win) {
  return !isWindowFullscreen(win) && !getMaximizeState(win).any;
}

function maybeResetWinOptsizeCycle(win, cycleState, logger) {
  const currentRect = cloneRect(win.get_frame_rect());
  if (!rectEquals(currentRect, cycleState.lastAppliedRect)) {
    if (
      cycleState.index !== -1 || cycleState.originalRect ||
      cycleState.lastAppliedRect
    ) {
      logger?.verboseLog?.(
        "win_optsize: detected external geometry change, resetting cycle",
      );
    }
    cycleState.index = -1;
    cycleState.originalRect = null;
    cycleState.lastAppliedRect = null;
  }
}

function applyWinOptsize(win, config, cycleState) {
  const monitor = win.get_monitor();
  const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
  const normalizedWinConfig = normalizeWinOptsizeConfig(config?.winOptsize);
  const winConfig = normalizedWinConfig.value ?? DEFAULT_WIN_OPTSIZE_CONFIG;
  const scales = resolveWinOptsizeScales(winConfig, workArea);

  if (!cycleState.originalRect) {
    cycleState.originalRect = cloneRect(win.get_frame_rect());
  }

  const cycleLength = scales.length + 1;
  const nextIndex = (cycleState.index + 1) % cycleLength;
  cycleState.index = nextIndex;
  STATE_MAP.set(STATE_KEYS.WIN_OPTSIZE, cycleState);

  let targetWidth;
  let targetHeight;
  let targetX;
  let targetY;
  if (nextIndex === scales.length) {
    const original = cycleState.originalRect;
    targetWidth = Math.round(original.width);
    targetHeight = Math.round(original.height);
    targetX = Math.round(original.x);
    targetY = Math.round(original.y);
  } else {
    let [widthScale, heightScale] = scales[nextIndex];
    const w = workArea.width;
    const h = workArea.height;
    // Aspect-based inversion logic
    if (winConfig.aspectBasedInversion && h > w) {
      // Invert width/height for portrait screens
      [widthScale, heightScale] = [heightScale, widthScale];
    }

    const aspect = w / h;
    targetWidth = resolveScaleSize(widthScale, w);
    targetHeight = resolveScaleSize(heightScale, h, targetWidth, aspect);
    targetX = Math.round(workArea.x + (workArea.width - targetWidth) / 2);
    targetY = Math.round(workArea.y + (workArea.height - targetHeight) / 2);
  }

  const targetRect = clampRectToWorkArea(
    { x: targetX, y: targetY, width: targetWidth, height: targetHeight },
    workArea,
  );

  cycleState.lastAppliedRect = cloneRect(targetRect);

  win.move_resize_frame(
    true,
    targetRect.x,
    targetRect.y,
    targetRect.width,
    targetRect.height,
  );
  queueWinOptsizeSync(win, targetRect, cycleState);
}

function cloneRect(rect) {
  if (!rect) {
    return null;
  }
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function rectEquals(left, right) {
  if (!left || !right) {
    return left === right;
  }
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
}

function clampRectToWorkArea(rect, workArea) {
  const width = Math.max(1, Math.min(Math.round(rect.width), workArea.width));
  const height = Math.max(
    1,
    Math.min(Math.round(rect.height), workArea.height),
  );
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: clamp(Math.round(rect.x), minX, maxX),
    y: clamp(Math.round(rect.y), minY, maxY),
    width,
    height,
  };
}

function clamp(value, min, max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function queueWinOptsizeSync(win, rect, cycleState) {
  const targetRect = cloneRect(rect);

  // Mutter can leave a fully offscreen window actor stale until a later shell
  // transition, such as overview or Alt-Tab, causes another frame sync.
  cycleState.syncSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    cycleState.syncSourceId = 0;
    win.move_resize_frame(
      true,
      targetRect.x,
      targetRect.y,
      targetRect.width,
      targetRect.height,
    );

    const actor = win.get_compositor_private?.();
    actor?.show?.();
    actor?.queue_relayout?.();
    actor?.queue_redraw?.();

    return GLib.SOURCE_REMOVE;
  });
}

function resolveWinOptsizeScales(winConfig, workArea) {
  let scales = winConfig.scales ?? DEFAULT_WIN_OPTSIZE_CONFIG.scales;
  if (Array.isArray(winConfig.breakpoints)) {
    for (const breakpoint of winConfig.breakpoints) {
      if (!breakpoint || typeof breakpoint.maxWidth !== "number") {
        continue;
      }
      if (
        workArea.width <= breakpoint.maxWidth &&
        (typeof breakpoint.maxHeight !== "number" ||
          workArea.height <= breakpoint.maxHeight)
      ) {
        if (Array.isArray(breakpoint.scales) && breakpoint.scales.length > 0) {
          scales = breakpoint.scales;
        }
        break;
      }
    }
  }
  if (!Array.isArray(scales) || scales.length === 0) {
    scales = DEFAULT_WIN_OPTSIZE_CONFIG.scales;
  }

  return scales;
}

function resolveScaleSize(scale, axisSize, targetWidth, aspect) {
  if (scale === null && targetWidth != null) {
    return Math.round(targetWidth / aspect);
  }
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    return Math.round(axisSize * OVERSIZED_EXACT_SCALE_FALLBACK);
  }
  if (scale <= 1) {
    return Math.round(axisSize * scale);
  }
  if (scale > axisSize) {
    return Math.round(axisSize * OVERSIZED_EXACT_SCALE_FALLBACK);
  }
  return Math.round(scale);
}
