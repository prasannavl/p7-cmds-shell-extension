// cmds/win_optsize.js

import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  DEFAULT_WIN_OPTSIZE_CONFIG,
  normalizeWinOptsizeConfig,
} from "../common/config.js";
import { cloneRect, getNextOptsize, rectEquals } from "../common/window.js";
import {
  connectWhenWindowRestored,
  getFocusedWindow,
  getWindowMonitor,
  normalizeWindow,
  resolveTopLevelWindow,
} from "../ext/compat.js";

const STATE_KEY = "cmd-win-optsize";

export function win_optsize(stateMap, config, logger) {
  const focusedWindow = getFocusedWindow();
  const win = resolveTopLevelWindow(focusedWindow);
  if (!win) {
    return;
  }

  if (focusedWindow && focusedWindow !== win) {
    logger?.verboseLog?.(
      "win_optsize: resolved focused transient window to top-level parent",
    );
  }

  const cycleState = getWinOptsizeState(stateMap, win);
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
    queuePendingWinOptsize(stateMap, win, config, logger, cycleState);
    return;
  }

  applyWinOptsize(win, config, cycleState);
}

function getWinOptsizeState(stateMap, win) {
  const winId = win.get_id();
  let cycleState = stateMap.get(STATE_KEY);
  if (cycleState && cycleState.winId !== winId) {
    cancelPendingWinOptsize(cycleState.win, cycleState);
    cancelPendingWinOptsizeSync(cycleState);
  }
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
    stateMap.set(STATE_KEY, cycleState);
  }
  return cycleState;
}

export function win_optsize_destroy(stateMap) {
  const cycleState = stateMap.get(STATE_KEY);
  if (!cycleState?.win) {
    return;
  }
  cancelPendingWinOptsize(cycleState.win, cycleState);
  cancelPendingWinOptsizeSync(cycleState);
}

function queuePendingWinOptsize(
  stateMap,
  win,
  config,
  logger,
  cycleState,
) {
  const pending = {};
  cycleState.pending = pending;
  connectWhenWindowRestored(
    win,
    pending,
    () => {
      if (
        cycleState.pending !== pending ||
        stateMap.get(STATE_KEY) !== cycleState
      ) return;
      cycleState.pending = null;
      logger?.verboseLog?.("win_optsize: applying optsize after restore");
      applyWinOptsize(win, config, cycleState);
    },
    () => {
      if (cycleState.pending === pending) cycleState.pending = null;
    },
  );
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
  const monitor = getWindowMonitor(win);
  if (monitor === null) return;
  const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
  if (!workArea) return;
  const normalizedWinConfig = normalizeWinOptsizeConfig(config?.winOptsize);
  const winConfig = normalizedWinConfig.value ?? DEFAULT_WIN_OPTSIZE_CONFIG;

  if (!cycleState.originalRect) {
    cycleState.originalRect = cloneRect(win.get_frame_rect());
  }

  const next = getNextOptsize(
    winConfig,
    workArea,
    cycleState.originalRect,
    cycleState.index,
  );
  cycleState.index = next.index;
  cycleState.lastAppliedRect = cloneRect(next.rect);

  win.move_resize_frame(
    true,
    next.rect.x,
    next.rect.y,
    next.rect.width,
    next.rect.height,
  );
  queueWinOptsizeSync(win, next.rect, cycleState);
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
