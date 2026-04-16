// cmds/win_optsize.js

import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { DEFAULT_WIN_OPTSIZE_CONFIG } from "../common.js";
import {
  getFocusedWindow,
  normalizeWindow,
  resolveTopLevelWindow,
} from "../compat.js";
import { STATE_KEYS, STATE_MAP } from "../cmds.js";

const OVERSIZED_EXACT_SCALE_FALLBACK = 0.95;
const RESTORE_SETTLE_TIMEOUT_MS = 150;

export function win_optsize(config, logger) {
  const focusedWindow = getFocusedWindow?.() ?? global.display.focus_window;
  const win = resolveTopLevelWindow(focusedWindow);
  if (!win) {
    return;
  }

  if (focusedWindow && focusedWindow !== win) {
    logger?.verboseLog?.("win_optsize: resolved focused transient window to top-level parent");
  }

  const cycleState = getWinOptsizeState(win);
  cancelPendingWinOptsize(win, cycleState);

  if (normalizeWindow(win)) {
    logger?.verboseLog?.("win_optsize: waiting for restored window before applying optsize");
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
      winId,
      index: -1,
      originalRect: null,
      pending: null,
    };
    STATE_MAP.set(STATE_KEYS.WIN_OPTSIZE, cycleState);
  }
  return cycleState;
}

function queuePendingWinOptsize(win, config, logger, cycleState) {
  const pending = {
    sourceId: 0,
  };
  const apply = () => {
    if (cycleState.pending !== pending) {
      return;
    }
    cancelPendingWinOptsize(win, cycleState, pending);
    logger?.verboseLog?.("win_optsize: applying optsize after restore");
    applyWinOptsize(win, config, cycleState);
  };

  cycleState.pending = pending;
  win.connectObject("size-changed", apply, pending);
  win.connectObject("position-changed", apply, pending);
  win.connectObject(
    "unmanaged",
    () => cancelPendingWinOptsize(win, cycleState, pending),
    pending,
  );
  pending.sourceId = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    RESTORE_SETTLE_TIMEOUT_MS,
    () => {
      pending.sourceId = 0;
      apply();
      return GLib.SOURCE_REMOVE;
    },
  );
}

function cancelPendingWinOptsize(win, cycleState, pending = cycleState.pending) {
  if (!pending) {
    return;
  }
  if (cycleState.pending === pending) {
    cycleState.pending = null;
  }
  if (pending.sourceId) {
    GLib.source_remove(pending.sourceId);
    pending.sourceId = 0;
  }
  win.disconnectObject?.(pending);
}

function applyWinOptsize(win, config, cycleState) {
  const monitor = win.get_monitor();
  const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
  const winConfig = config?.winOptsize ?? DEFAULT_WIN_OPTSIZE_CONFIG;
  const scales = resolveWinOptsizeScales(winConfig, workArea);

  if (!cycleState.originalRect) {
    const frameRect = win.get_frame_rect();
    cycleState.originalRect = {
      x: frameRect.x,
      y: frameRect.y,
      width: frameRect.width,
      height: frameRect.height,
    };
  }

  const cycleLength = scales.length + 1;
  const nextIndex = (cycleState.index + 1) % cycleLength;
  cycleState.index = nextIndex;
  STATE_MAP.set(STATE_KEYS.WIN_OPTSIZE, cycleState);

  let targetWidth;
  let targetHeight;
  if (nextIndex === scales.length) {
    const original = cycleState.originalRect;
    targetWidth = Math.round(original.width);
    targetHeight = Math.round(original.height);
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
  }

  const targetX = Math.round(workArea.x + (workArea.width - targetWidth) / 2);
  const targetY = Math.round(workArea.y + (workArea.height - targetHeight) / 2);

  win.move_resize_frame(true, targetX, targetY, targetWidth, targetHeight);
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
  if (scale <= 1) {
    return Math.round(axisSize * scale);
  }
  if (scale > axisSize) {
    return Math.round(axisSize * OVERSIZED_EXACT_SCALE_FALLBACK);
  }
  return Math.round(scale);
}
