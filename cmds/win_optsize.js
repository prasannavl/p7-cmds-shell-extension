import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { cloneRect, getNextOptsize, rectEquals } from "../common/window.js";
import {
  connectWhenWindowRestored,
  getFocusedWindow,
  getWindowMonitor,
  normalizeWindow,
  resolveTopLevelWindow,
} from "../shell/compat.js";

const SETTLE_DELAY_MS = 100;
const SETTLE_TIMEOUT_MS = 1000;

export function createWinOptsizeCommand() {
  return new WinOptsizeCommand();
}

class WinOptsizeCommand {
  run(config, logger) {
    const focused = getFocusedWindow();
    const win = resolveTopLevelWindow(focused);
    if (!win) return;
    if (focused !== win) {
      logger.verboseLog(
        "win_optsize: resolved focused transient window to top-level parent",
      );
    }

    const state = this._stateFor(win);
    const { aspectBasedInversion, scales, breakpoints } = config.winOptsize;
    const configKey = JSON.stringify([
      aspectBasedInversion,
      scales,
      breakpoints.map(({ maxWidth, maxHeight, scales }) => [
        maxWidth,
        maxHeight,
        scales?.length ? scales : null,
      ]),
    ]);
    const configChanged = state.configKey !== configKey;
    const wasSyncing = Boolean(state.sync);
    this._cancelPending(state);
    this._finishSync(state, false);
    if (configChanged) {
      state.configKey = configKey;
      this._resetCycle(state);
    } else if (!wasSyncing) {
      this._resetMovedCycle(state, logger);
    }

    if (!normalizeWindow(win)) {
      this._apply(config, state);
      return;
    }
    this._resetCycle(state);
    logger.verboseLog(
      "win_optsize: waiting for restored window before applying optsize",
    );
    const pending = {};
    state.pending = pending;
    connectWhenWindowRestored(
      win,
      pending,
      () => {
        if (state.pending !== pending || this._state !== state) return;
        state.pending = null;
        logger.verboseLog("win_optsize: applying optsize after restore");
        this._apply(config, state);
      },
      () => {
        if (state.pending === pending) state.pending = null;
      },
    );
  }

  destroy() {
    if (!this._state) return;
    this._cancelPending(this._state);
    this._finishSync(this._state, false);
    this._state = null;
  }

  _stateFor(win) {
    if (this._state?.win === win) return this._state;
    this.destroy();
    this._state = { win, index: -1 };
    return this._state;
  }

  _cancelPending(state) {
    if (!state.pending) return;
    state.win.disconnectObject?.(state.pending);
    state.pending = null;
  }

  _resetMovedCycle(state, logger) {
    const current = cloneRect(state.win.get_frame_rect());
    if (rectEquals(current, state.lastAppliedRect)) return;
    if (state.index !== -1 || state.originalRect || state.lastAppliedRect) {
      logger.verboseLog(
        "win_optsize: detected external geometry change, resetting cycle",
      );
    }
    this._resetCycle(state);
  }

  _resetCycle(state) {
    Object.assign(state, {
      index: -1,
      originalRect: null,
      lastAppliedRect: null,
    });
  }

  _apply(config, state) {
    const monitor = getWindowMonitor(state.win);
    if (monitor === null) return;
    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
    state.originalRect ??= cloneRect(state.win.get_frame_rect());

    const next = getNextOptsize(
      config.winOptsize,
      workArea,
      state.originalRect,
      state.index,
    );
    state.index = next.index;
    state.lastAppliedRect = next.rect;
    this._queueSync(state, next.rect);
  }

  _queueSync(state, target) {
    const sync = { retrySourceId: 0, settleSourceId: 0 };
    state.sync = sync;
    const current = state.win.get_frame_rect();
    const sizeChanges = current.width !== target.width ||
      current.height !== target.height;
    const settle = (delay = SETTLE_DELAY_MS) => {
      if (state.sync !== sync) return;
      if (sync.settleSourceId) GLib.source_remove(sync.settleSourceId);
      sync.settleSourceId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        delay,
        () => {
          sync.settleSourceId = 0;
          this._finishSync(state, true, sync);
          return GLib.SOURCE_REMOVE;
        },
      );
    };
    state.win.connectObject?.(
      "size-changed",
      settle,
      "position-changed",
      () => !sizeChanges && settle(),
      "unmanaged",
      () => this._finishSync(state, false, sync),
      sync,
    );

    // Mutter can leave a fully offscreen actor stale until a later frame sync.
    sync.retrySourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      sync.retrySourceId = 0;
      if (state.sync !== sync) return GLib.SOURCE_REMOVE;
      this._move(state.win, target);
      if (state.sync !== sync) return GLib.SOURCE_REMOVE;
      const actor = state.win.get_compositor_private?.();
      actor?.show?.();
      actor?.queue_relayout?.();
      actor?.queue_redraw?.();
      if (rectEquals(state.win.get_frame_rect(), target)) settle();
      return GLib.SOURCE_REMOVE;
    });

    // A client may clamp the requested size without emitting size-changed.
    settle(SETTLE_TIMEOUT_MS);
    // Own teardown before moving: Mutter may emit unmanaged synchronously.
    this._move(state.win, target);
  }

  _finishSync(state, recordGeometry, sync = state?.sync) {
    if (!sync || state.sync !== sync) return;
    for (const id of [sync.retrySourceId, sync.settleSourceId]) {
      if (id) GLib.source_remove(id);
    }
    state.win.disconnectObject?.(sync);
    state.sync = null;
    if (recordGeometry) {
      state.lastAppliedRect = cloneRect(state.win.get_frame_rect());
    }
  }

  _move(win, { x, y, width, height }) {
    win.move_resize_frame(true, x, y, width, height);
  }
}
