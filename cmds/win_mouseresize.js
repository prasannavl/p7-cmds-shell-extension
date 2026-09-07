import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { isModifiedArrowBinding } from "../common/config.js";
import {
  cloneRect,
  computeResizeRect,
  flipLockedEdges,
  getPointDelta,
  hasLockedEdges,
  lockResizeEdges,
  MIN_RESIZE_SIZE,
  preserveResizeAnchors,
} from "../common/window.js";
import {
  connectObjectIfSignal,
  connectWhenWindowRestored,
  getCursorTracker,
  getDisplay,
  getFocusedWindow,
  getMonitorManager,
  getPointerData,
  normalizeWindow,
  setResizeCursor,
} from "../shell/compat.js";

const RESIZE_STEP = 100;
const RESIZE_DELTAS = new Map([
  [Clutter.KEY_Left, { x: -RESIZE_STEP, y: 0 }],
  [Clutter.KEY_KP_Left, { x: -RESIZE_STEP, y: 0 }],
  [Clutter.KEY_Right, { x: RESIZE_STEP, y: 0 }],
  [Clutter.KEY_KP_Right, { x: RESIZE_STEP, y: 0 }],
  [Clutter.KEY_Up, { x: 0, y: -RESIZE_STEP }],
  [Clutter.KEY_KP_Up, { x: 0, y: -RESIZE_STEP }],
  [Clutter.KEY_Down, { x: 0, y: RESIZE_STEP }],
  [Clutter.KEY_KP_Down, { x: 0, y: RESIZE_STEP }],
]);
export function createWinMouseResizeCommand(
  createWidget = (properties) => new St.Widget(properties),
) {
  let session = null;
  return {
    run(config, logger, runtime, ...args) {
      if (session) {
        session.exit("keybinding");
        return;
      }
      const win = getFocusedWindow();
      if (!win) {
        logger.verboseLog("win_mouseresize: no focused window");
        return;
      }
      session = new MouseResizeSession(
        win,
        config,
        logger,
        runtime,
        getModifierMask(args.at(-1)),
        createWidget,
        () => {
          session = null;
        },
      );
      session.start();
    },
    destroy() {
      session?.end();
    },
  };
}

class MouseResizeSession {
  constructor(win, config, logger, runtime, modifierMask, createWidget, onEnd) {
    Object.assign(this, {
      win,
      logger,
      runtime,
      modifierMask,
      createWidget,
      onEnd,
    });
    this.connectedObjects = new Set([win]);
    this.indicatorConfig = config.winMouseResize;
  }

  start() {
    this.logger.verboseLog("win_mouseresize: enter resize mode");
    if (!normalizeWindow(this.win)) {
      this._begin();
      return;
    }
    this.logger.verboseLog(
      "win_mouseresize: waiting for restored window before resizing",
    );
    connectWhenWindowRestored(
      this.win,
      this,
      () => this._begin(),
      () => this.end(),
    );
  }

  _begin() {
    this.cursorTracker = getCursorTracker();
    if (!this.cursorTracker) {
      this.logger.verboseLog("win_mouseresize: no cursor tracker");
      this.end();
      return;
    }
    if (!this._grabModal()) {
      this.logger.verboseLog("win_mouseresize: failed to grab modal input");
      this.end();
      return;
    }

    this.bindingOverride = this.runtime.suppressKeybindings(
      isModifiedArrowBinding,
    );
    if (!this.bindingOverride) {
      this.end();
      return;
    }

    this.edges = null;
    this.startRect = cloneRect(this.win.get_frame_rect());
    this.minSize = this._getMinSize();
    this.startPoint = this._point();
    // Shift is edge-triggered, not a held mode. Seed its state so the activation
    // key and continued hold are ignored; only a later press flips locked edges.
    this.shiftPressed = this._modifierPressed(Clutter.ModifierType.SHIFT_MASK);

    this._updateIndicator(this.startRect);
    setResizeCursor(true);
    this.cursorSet = true;
    this._connect(
      this.win,
      "size-changed",
      () => this._queueWindowSync(),
      "position-changed",
      () => this._queueWindowSync(),
    );
    this.cursorTracker.connect(() => this._onPointerMove(), this);
    this._connectExitSignals();
  }

  exit(reason) {
    if (this.ended) return;
    this.end();
    this.logger.verboseLog(`win_mouseresize: exit resize mode (${reason})`);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.bindingOverride?.restore();
    this._releaseModal();
    if (this.cursorSet) setResizeCursor(false);
    for (const object of this.connectedObjects) object.disconnectObject?.(this);
    this.connectedObjects.clear();
    this.cursorTracker?.disconnect(this);
    for (
      const id of [
        this.resizeSourceId,
        this.windowSyncSourceId,
        this.modifierWatchSourceId,
      ]
    ) if (id) GLib.source_remove(id);
    this.indicator?.destroy();
    this.win = null;
    this.onEnd();
  }

  _point() {
    const { x, y } = getPointerData();
    return { x, y };
  }

  _modifierPressed(mask) {
    return (getPointerData().modifiers & mask) !== 0;
  }

  _activationModifierPressed() {
    return !this.modifierMask ||
      (getPointerData().modifiers & this.modifierMask) === this.modifierMask;
  }

  _onPointerMove() {
    const point = this._point();
    const delta = getPointDelta(this.startPoint, point);
    if (!this._lockEdges(delta, this.startPoint, this.startRect)) return true;
    this._queueResize(
      computeResizeRect(this.startRect, this.edges, delta, this.minSize),
      false,
    );
    return true;
  }

  _lockEdges(delta, point, rect) {
    this.edges = lockResizeEdges(this.edges, delta, point, rect);
    return hasLockedEdges(this.edges);
  }

  _queueResize(rect, reanchor) {
    this.pendingResize = { rect, reanchor };
    this._idle("resizeSourceId", () => {
      const pending = this.pendingResize;
      this.pendingResize = null;
      if (!this.win) return;

      this.anchorRequest = pending.rect;
      this.lastCorrection = null;
      if (!this._applyRect(pending.rect)) return;
      // Mutter owns the final geometry; render feedback from its actual frame.
      this._queueWindowSync();
      if (pending.reanchor) this._reanchor(this._anchorRect(), this._point());
    });
  }

  _queueWindowSync() {
    // Shell objects stay on the main thread; defer and coalesce their updates.
    this._idle("windowSyncSourceId", () => this._syncWindowRect());
  }

  _idle(property, callback) {
    if (this[property]) return;
    this[property] = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this[property] = 0;
      callback();
      return GLib.SOURCE_REMOVE;
    });
  }

  _anchorRect() {
    return this.pendingResize?.rect ?? this.anchorRequest ??
      cloneRect(this.win.get_frame_rect());
  }

  _reanchor(rect, point) {
    this.startRect = rect;
    this.startPoint = point;
  }

  _pressShift() {
    if (this.shiftPressed) return false;
    // Consume the press even without edges; holding must not affect later locks.
    this.shiftPressed = true;
    const edges = flipLockedEdges(this.edges);
    if (!edges) return false;
    this.edges = edges;
    this._reanchor(this._anchorRect(), this._point());
    return true;
  }

  _syncShift() {
    const pressed = this._modifierPressed(Clutter.ModifierType.SHIFT_MASK);
    if (!pressed) this.shiftPressed = false;
    return pressed && this._pressShift();
  }

  _syncWindowRect() {
    if (!this.win) return;
    const actual = this.win.get_frame_rect();
    const corrected = preserveResizeAnchors(
      actual,
      this.anchorRequest,
      this.edges,
    );
    const correction = `${actual.x},${actual.y}:${corrected.x},${corrected.y}`;
    if (
      (corrected.x !== actual.x || corrected.y !== actual.y) &&
      correction !== this.lastCorrection
    ) {
      // A Wayland resize is only a request until the client acknowledges it.
      // Move just the frame to preserve locked edges without replacing that
      // pending size request with Mutter's still-old accepted size.
      this.lastCorrection = correction;
      if (!this._moveFrame(corrected)) return;
    }
    this._updateIndicator(this.win.get_frame_rect());
  }

  _getMinSize() {
    const [width, height] = this.win.get_min_size?.() ?? [];
    const hints = width === undefined ? this.win.get_size_hints?.() : null;
    return {
      width: Math.max(MIN_RESIZE_SIZE, width ?? hints?.min_width ?? 0),
      height: Math.max(MIN_RESIZE_SIZE, height ?? hints?.min_height ?? 0),
    };
  }

  _applyRect({ x, y, width, height }) {
    const win = this.win;
    win.move_resize_frame(true, x, y, width, height);
    return this.win === win;
  }

  _moveFrame({ x, y }) {
    const win = this.win;
    win.move_frame(true, x, y);
    return this.win === win;
  }

  _onKeyPress(symbol) {
    if (isShift(symbol)) {
      this._pressShift();
      return Clutter.EVENT_STOP;
    }
    const delta = RESIZE_DELTAS.get(symbol);
    if (!delta) return Clutter.EVENT_PROPAGATE;

    const point = this._point();
    const rect = this._anchorRect();
    this._lockEdges(delta, point, rect);
    this._queueResize(
      computeResizeRect(rect, this.edges, delta, this.minSize),
      true,
    );
    return Clutter.EVENT_STOP;
  }

  _onKeyRelease(event) {
    if (!this._activationModifierPressed()) {
      this.exit(`event ${event.type()}`);
      return Clutter.EVENT_STOP;
    }
    const symbol = event.get_key_symbol?.();
    if (isShift(symbol)) {
      this.shiftPressed = false;
      return Clutter.EVENT_STOP;
    }
    return RESIZE_DELTAS.has(symbol) || symbol === Clutter.KEY_Escape
      ? Clutter.EVENT_STOP
      : Clutter.EVENT_PROPAGATE;
  }

  _grabModal() {
    const actor = this.createWidget({
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
        const symbol = event.get_key_symbol?.();
        if (symbol !== Clutter.KEY_Escape) return this._onKeyPress(symbol);
        this.exit("escape");
        return Clutter.EVENT_STOP;
      },
      "key-release-event",
      (_actor, event) => this._onKeyRelease(event),
      this,
    );
    Main.uiGroup.add_child(actor);
    this.modalActor = actor;
    this.modalGrab = Main.pushModal(actor);
    if (this.modalGrab) return true;
    this._releaseModal();
    return false;
  }

  _releaseModal() {
    if (this.modalGrab) Main.popModal(this.modalGrab);
    this.modalGrab = null;
    this.modalActor?.disconnectObject?.(this);
    this.modalActor?.destroy();
    this.modalActor = null;
  }

  _updateIndicator(rect) {
    const {
      backgroundColor,
      borderColor,
      borderSize: border,
    } = this.indicatorConfig;
    if (!this.indicator) {
      this.indicator = this.createWidget({
        reactive: false,
        style:
          `background-color: ${backgroundColor};border: ${border}px solid ${borderColor};border-radius: 5px;`,
      });
      this.indicator.hide();
      Main.uiGroup.add_child(this.indicator);
    }
    this.indicator.set_position(rect.x - border, rect.y - border);
    this.indicator.set_size(rect.width + border * 2, rect.height + border * 2);
    this.indicator.show();
  }

  _connectExitSignals() {
    this._connect(
      this.win,
      "unmanaged",
      () => this.exit("window unmanaged"),
    );
    this._connectIf(
      global.stage,
      "captured-event",
      (_actor, event) => {
        const type = event.type();
        if (type === Clutter.EventType.KEY_STATE && this._syncShift()) {
          return Clutter.EVENT_STOP;
        }
        if (
          (type === Clutter.EventType.KEY_RELEASE ||
            type === Clutter.EventType.KEY_STATE) &&
          !this._activationModifierPressed()
        ) {
          this.exit(`event ${type}`);
        }
        return Clutter.EVENT_PROPAGATE;
      },
    );
    this._connectExit(global.workspace_manager, "workspace changed", [
      "active-workspace-changed",
    ]);
    this._connectExit(getMonitorManager(), "monitors changed", [
      "monitors-changed",
    ]);
    this._connectExit(
      getDisplay(),
      "focus changed",
      ["focus-window", "notify::focus-window"],
      () => getFocusedWindow() !== this.win,
    );

    this.modifierWatchSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      120,
      () => {
        if (this._activationModifierPressed()) {
          return GLib.SOURCE_CONTINUE;
        }
        this.modifierWatchSourceId = 0;
        this.exit("modifier released");
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _connectExit(object, reason, signals, shouldExit = () => true) {
    for (const signal of signals) {
      if (
        this._connectIf(
          object,
          signal,
          () => shouldExit() && this.exit(reason),
        )
      ) return;
    }
  }

  _connect(object, ...signals) {
    object.connectObject(...signals, this);
    this.connectedObjects.add(object);
  }

  _connectIf(object, signal, handler) {
    if (!connectObjectIfSignal(object, signal, handler, this)) return false;
    this.connectedObjects.add(object);
    return true;
  }
}

function isShift(symbol) {
  return symbol === Clutter.KEY_Shift_L || symbol === Clutter.KEY_Shift_R;
}

function getModifierMask(binding) {
  return binding.get_mask() & ~Clutter.ModifierType.SHIFT_MASK;
}
