import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { createWinMouseResizeCommand } from "../cmds/win_mouseresize.js";
import { createWinOptsizeCommand } from "../cmds/win_optsize.js";
import { createTestSuite, noopLogger } from "./gjstestlib.js";
import { assertEquals } from "./testlib.js";

const logger = noopLogger;
const actors = [];
const mouseResize = createWinMouseResizeCommand(() => {
  const handlers = new Map();
  const actor = {
    destroyed: false,
    position: null,
    size: null,
    sizeUpdates: 0,
    connectObject(...args) {
      args.pop();
      for (let index = 0; index < args.length; index += 2) {
        handlers.set(args[index], args[index + 1]);
      }
    },
    disconnectObject() {
      handlers.clear();
    },
    destroy() {
      this.destroyed = true;
    },
    emit(signal, event) {
      return handlers.get(signal)?.(this, event);
    },
    hide() {},
    set_position(x, y) {
      this.position = { x, y };
    },
    set_size(width, height) {
      this.size = { width, height };
      this.sizeUpdates += 1;
    },
    show() {},
  };
  actors.push(actor);
  return actor;
});
const optsize = createWinOptsizeCommand();
const config = {
  winMouseResize: {
    borderColor: "rgba(255, 255, 255, 0.8)",
    backgroundColor: "rgba(0, 120, 255, 0.18)",
    borderSize: 3,
  },
  winOptsize: {
    aspectBasedInversion: false,
    scales: [[0.5, 0.5]],
    breakpoints: [],
  },
};
function createWindow({
  id = 7,
  maximized = false,
  monitor = 0,
  maxWidth = Infinity,
  minWidth = 0,
  minHeight = 0,
  fixedPosition = false,
  signalRejectedPosition = false,
  deferResize = false,
  unmanageAtMove = 0,
} = {}) {
  let frameRect = maximized
    ? { x: 0, y: 0, width: 1000, height: 800 }
    : { x: 100, y: 100, width: 400, height: 300 };
  let maximizeFlags = maximized ? 3 : 0;
  const handlers = new Map();
  const moves = [];
  const frameMoves = [];
  let unmaximizeCalls = 0;
  let unmanaged = false;
  let pendingRect = null;
  let actionCount = 0;

  function moveWindow(win, nextRect, requestedX, requestedY) {
    const sizeChanged = nextRect.width !== frameRect.width ||
      nextRect.height !== frameRect.height;
    const positionChanged = nextRect.x !== frameRect.x ||
      nextRect.y !== frameRect.y;
    frameRect = nextRect;
    if (sizeChanged) win.emit("size-changed");
    if (positionChanged) win.emit("position-changed");
    else if (
      signalRejectedPosition &&
      (requestedX !== frameRect.x || requestedY !== frameRect.y)
    ) win.emit("position-changed");
  }

  function finishMove(win) {
    actionCount += 1;
    if (actionCount === unmanageAtMove) win.unmanage();
  }

  return {
    moves,
    frameMoves,
    get unmaximizeCalls() {
      return unmaximizeCalls;
    },
    get_id: () => id,
    get_transient_for: () => null,
    get_monitor: () => monitor,
    get_frame_rect: () => ({ ...frameRect }),
    get maximized_horizontally() {
      return maximizeFlags !== 0;
    },
    get maximized_vertically() {
      return maximizeFlags !== 0;
    },
    is_fullscreen: () => false,
    unmake_fullscreen() {},
    unmaximize() {
      unmaximizeCalls += 1;
    },
    move_resize_frame(_userOp, x, y, width, height) {
      if (unmanaged) throw new Error("move requested for unmanaged window");
      const nextRect = {
        x: fixedPosition ? frameRect.x : x,
        y: fixedPosition ? frameRect.y : y,
        width: Math.max(minWidth, Math.min(width, maxWidth)),
        height: Math.max(minHeight, height),
      };
      moves.push({ x, y, width, height });
      if (deferResize) {
        pendingRect = nextRect;
        moveWindow(this, { ...frameRect, x: nextRect.x, y: nextRect.y }, x, y);
      } else {
        moveWindow(this, nextRect, x, y);
      }
      finishMove(this);
    },
    move_frame(_userOp, x, y) {
      if (unmanaged) throw new Error("move requested for unmanaged window");
      frameMoves.push({ x, y });
      moveWindow(
        this,
        {
          ...frameRect,
          x: fixedPosition ? frameRect.x : x,
          y: fixedPosition ? frameRect.y : y,
        },
        x,
        y,
      );
      finishMove(this);
    },
    acceptMove() {
      if (!pendingRect) return;
      const accepted = pendingRect;
      pendingRect = null;
      moveWindow(this, accepted, accepted.x, accepted.y);
    },
    get_compositor_private() {
      if (unmanaged) throw new Error("actor requested for unmanaged window");
      return null;
    },
    connectObject(...args) {
      const owner = args.pop();
      for (let index = 0; index < args.length; index += 2) {
        const signal = args[index];
        const connections = handlers.get(signal) ?? [];
        connections.push({ callback: args[index + 1], owner });
        handlers.set(signal, connections);
      }
    },
    disconnectObject(owner) {
      for (const [signal, connections] of handlers) {
        const remaining = connections.filter((item) => item.owner !== owner);
        if (remaining.length > 0) handlers.set(signal, remaining);
        else handlers.delete(signal);
      }
    },
    find_property: () => null,
    emit(signal) {
      for (const { callback } of [...(handlers.get(signal) ?? [])]) callback();
    },
    restore(rect = { x: 120, y: 90, width: 420, height: 320 }) {
      maximizeFlags = 0;
      frameRect = rect;
      this.emit("size-changed");
    },
    unmanage() {
      unmanaged = true;
      this.emit("unmanaged");
    },
  };
}

function drainMainContext() {
  const context = GLib.MainContext.default();
  while (context.pending()) context.iteration(false);
}

function waitForMainContext(milliseconds) {
  const loop = new GLib.MainLoop(null, false);
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
  });
  loop.run();
}

function setGlobal(win, monitorCount = 1) {
  globalThis.global = {
    backend: {
      get_monitor_manager: () => null,
    },
    display: {
      get_focus_window: () => win,
      get_n_monitors: () => monitorCount,
      get_monitor_manager: () => null,
      disconnectObject() {},
    },
    stage: {
      disconnectObject() {},
      set_cursor_type() {},
    },
    workspace_manager: { disconnectObject() {} },
  };
}

function prepareOptsize(win) {
  setGlobal(win);
  Main.setLayoutManager({
    getWorkAreaForMonitor: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  });
}

function prepareMouseResize(win, initialPointer = [200, 200, 1 << 26]) {
  let pointer = initialPointer;
  let pointerChanged = null;
  setGlobal(win);
  global.backend.get_cursor_tracker = () => ({
    connectObject(_signal, handler) {
      pointerChanged = handler;
    },
    disconnectObject() {
      pointerChanged = null;
    },
  });
  global.get_pointer = () => pointer;
  global.display.set_cursor = () => {};
  Main.setModalEnvironment({ add_child() {} }, {});
  return (nextPointer, drain = true) => {
    pointer = nextPointer;
    pointerChanged();
    if (drain) drainMainContext();
  };
}

const emptyOverride = () => ({ restore() {} });

function bindingFor(mask = Clutter.ModifierType.SUPER_MASK) {
  return { get_mask: () => mask };
}

function startMouseResize(
  win,
  pointer,
  modifierMask = Clutter.ModifierType.SUPER_MASK,
) {
  const movePointer = prepareMouseResize(win, pointer);
  mouseResize.run(
    config,
    logger,
    { suppressKeybindings: emptyOverride },
    bindingFor(modifierMask),
  );
  return movePointer;
}

function emitShift(pressed) {
  actors[0].emit(pressed ? "key-press-event" : "key-release-event", {
    type: () =>
      pressed ? Clutter.EventType.KEY_PRESS : Clutter.EventType.KEY_RELEASE,
    get_key_symbol: () => Clutter.KEY_Shift_L,
  });
}

function cleanup() {
  mouseResize.destroy();
  optsize.destroy();
  Main.setLayoutManager(null);
  Main.setModalEnvironment(null, null);
  actors.length = 0;
}

const { test, done } = createTestSuite(cleanup);

test("optsize applies centered geometry from the current work area", () => {
  const win = createWindow();
  prepareOptsize(win);
  optsize.run(config, logger);
  assertEquals(win.moves[0], { x: 250, y: 200, width: 500, height: 400 });
});

test("optsize ignores detached and stale monitor indices", () => {
  for (const monitor of [-1, 1]) {
    const win = createWindow({ monitor });
    setGlobal(win, 1);
    Main.setLayoutManager({
      getWorkAreaForMonitor() {
        throw new Error("stale monitor reached the layout manager");
      },
    });
    optsize.run(config, logger);
    assertEquals(win.moves, []);
    cleanup();
  }
});

test("optsize waits for restored geometry before resizing", () => {
  const win = createWindow({ maximized: true });
  prepareOptsize(win);
  optsize.run(config, logger);
  assertEquals(win.moves, []);
  win.restore();
  assertEquals(win.moves[0], { x: 250, y: 200, width: 500, height: 400 });
});

test("optsize cancels a pending restore when focus moves to another window", () => {
  const first = createWindow({ id: 1, maximized: true });
  const second = createWindow({ id: 2 });
  prepareOptsize(first);
  optsize.run(config, logger);
  setGlobal(second);
  optsize.run(config, logger);
  first.restore();

  assertEquals(first.moves, []);
  assertEquals(second.moves[0], {
    x: 250,
    y: 200,
    width: 500,
    height: 400,
  });
});

test("optsize cycles from the geometry accepted by Mutter", () => {
  const win = createWindow({ maxWidth: 450 });
  prepareOptsize(win);
  const constrainedConfig = {
    winOptsize: {
      aspectBasedInversion: false,
      scales: [
        [0.5, 0.5],
        [0.6, 0.6],
      ],
      breakpoints: [],
    },
  };

  optsize.run(constrainedConfig, logger);
  waitForMainContext(150);
  optsize.run(constrainedConfig, logger);

  assertEquals(win.moves.at(-1), {
    x: 200,
    y: 160,
    width: 600,
    height: 480,
  });
});

test("optsize settles when Mutter clamps away the requested size change", () => {
  const win = createWindow({ maxWidth: 450 });
  prepareOptsize(win);
  const constrainedConfig = {
    winOptsize: {
      aspectBasedInversion: false,
      scales: [[0.5, 0.5], [0.6, 0.5]],
      breakpoints: [],
    },
  };

  optsize.run(constrainedConfig, logger);
  waitForMainContext(150);
  optsize.run(constrainedConfig, logger);
  waitForMainContext(1100);

  win.move_frame(true, 300, 200);
  optsize.run(constrainedConfig, logger);

  assertEquals(win.moves.at(-1), {
    x: 250,
    y: 200,
    width: 500,
    height: 400,
  });
});

test("optsize waits for a delayed Wayland size acknowledgement", () => {
  const win = createWindow({ deferResize: true });
  prepareOptsize(win);
  const cyclingConfig = {
    winOptsize: {
      aspectBasedInversion: false,
      scales: [[0.5, 0.5], [0.6, 0.6]],
      breakpoints: [],
    },
  };

  optsize.run(cyclingConfig, logger);
  waitForMainContext(150);
  win.acceptMove();
  waitForMainContext(150);
  optsize.run(cyclingConfig, logger);

  assertEquals(win.moves.at(-1), {
    x: 200,
    y: 160,
    width: 600,
    height: 480,
  });
});

test("optsize restarts its cycle when its configuration changes", () => {
  const win = createWindow();
  prepareOptsize(win);
  optsize.run(config, logger);
  waitForMainContext(150);

  optsize.run({
    winOptsize: {
      aspectBasedInversion: false,
      scales: [[0.7, 0.7]],
      breakpoints: [],
    },
  }, logger);

  assertEquals(win.moves.at(-1), {
    x: 150,
    y: 120,
    width: 700,
    height: 560,
  });
});

test("optsize preserves its cycle across reordered config keys", () => {
  const win = createWindow();
  prepareOptsize(win);
  const scales = [[0.5, 0.5], [0.7, 0.7]];

  optsize.run({
    winOptsize: {
      aspectBasedInversion: false,
      scales: [],
      breakpoints: [{ maxWidth: 1000, maxHeight: 800, scales }],
    },
  }, logger);
  waitForMainContext(150);
  optsize.run({
    winOptsize: {
      scales: [],
      breakpoints: [{ scales, maxHeight: 800, maxWidth: 1000 }],
      aspectBasedInversion: false,
    },
  }, logger);

  assertEquals(win.moves.at(-1), {
    x: 150,
    y: 120,
    width: 700,
    height: 560,
  });
});

test("optsize cancels deferred sync when the window is unmanaged", () => {
  const win = createWindow();
  prepareOptsize(win);

  optsize.run(config, logger);
  win.unmanage();
  drainMainContext();

  assertEquals(win.moves.length, 1);
});

test("optsize handles synchronous unmanage during either move", () => {
  for (const unmanageAtMove of [1, 2]) {
    const win = createWindow({ unmanageAtMove });
    prepareOptsize(win);

    optsize.run(config, logger);
    drainMainContext();

    assertEquals(win.moves.length, unmanageAtMove);
    cleanup();
  }
});

test("mouse resize waits for restored geometry before entering resize mode", () => {
  const win = createWindow({ maximized: true });
  setGlobal(win);
  mouseResize.run(config, logger, {}, bindingFor());
  assertEquals(win.unmaximizeCalls, 1);
});

test("mouse resize cleanly releases a session without a cursor tracker", () => {
  const messages = [];
  const recordingLogger = {
    ...logger,
    verboseLog(message) {
      messages.push(message);
    },
  };
  setGlobal(createWindow());
  global.backend.get_cursor_tracker = () => null;

  mouseResize.run(config, recordingLogger, {}, bindingFor());
  mouseResize.run(config, recordingLogger, {}, bindingFor());

  assertEquals(
    messages.filter((message) => message.endsWith("no cursor tracker")).length,
    2,
  );
});

test("mouse resize applies accepted geometry and toggles its session off", () => {
  const win = createWindow({ maxWidth: 430 });
  let restored = 0;
  const movePointer = prepareMouseResize(win);

  mouseResize.run(config, logger, {
    suppressKeybindings: () => ({
      changes: [],
      restore() {
        restored += 1;
      },
    }),
  }, bindingFor());
  assertEquals(restored, 0);

  movePointer([150, 200, 1 << 26]);

  assertEquals(win.get_frame_rect(), {
    x: 70,
    y: 100,
    width: 430,
    height: 300,
  });
  assertEquals(actors[1].position, { x: 67, y: 97 });
  assertEquals(actors[1].size, { width: 436, height: 306 });

  mouseResize.run(config, logger, {}, bindingFor());
  assertEquals(restored, 1);
  assertEquals(
    actors.map(({ destroyed }) => destroyed),
    [true, true],
  );
  assertEquals(Main.poppedModal !== null, true);
});

test("mouse resize indicator follows a window clamped at its minimum", () => {
  const win = createWindow({ minWidth: 300, minHeight: 200 });
  const movePointer = startMouseResize(win, [450, 350, 1 << 26]);

  movePointer([150, 150, 1 << 26]);
  movePointer([50, 50, 1 << 26]);

  assertEquals(win.get_frame_rect(), {
    x: 100,
    y: 100,
    width: 300,
    height: 200,
  });
  assertEquals(actors[1].size, { width: 306, height: 206 });
});

test("mouse resize indicator follows actual rejected anchor corrections", () => {
  const win = createWindow({
    minWidth: 300,
    fixedPosition: true,
    signalRejectedPosition: true,
  });
  const movePointer = startMouseResize(win, [150, 200, 1 << 26]);

  movePointer([450, 200, 1 << 26]);

  assertEquals(win.get_frame_rect(), {
    x: 100,
    y: 100,
    width: 300,
    height: 300,
  });
  assertEquals(actors[1].position, { x: 97, y: 97 });
  assertEquals(actors[1].size, { width: 306, height: 306 });
  assertEquals(win.moves.length, 1);
  assertEquals(win.frameMoves.length, 1);
});

test("mouse resize preserves a pending Wayland size request", () => {
  const win = createWindow({ deferResize: true, maxWidth: 430 });
  const movePointer = startMouseResize(win);

  movePointer([150, 200, 1 << 26]);
  assertEquals(win.moves.length, 1);
  assertEquals(win.frameMoves.length, 1);

  win.acceptMove();
  drainMainContext();

  assertEquals(win.moves.length, 1);
  assertEquals(win.get_frame_rect(), {
    x: 70,
    y: 100,
    width: 430,
    height: 300,
  });
});

test("mouse resize handles synchronous unmanage during its first move", () => {
  const win = createWindow({ unmanageAtMove: 1 });
  const movePointer = startMouseResize(win);

  movePointer([150, 200, 1 << 26]);

  assertEquals(win.moves.length, 1);
  assertEquals(actors.map(({ destroyed }) => destroyed), [true, true]);
});

test("mouse resize handles synchronous unmanage during anchor correction", () => {
  const win = createWindow({
    minWidth: 300,
    fixedPosition: true,
    signalRejectedPosition: true,
    unmanageAtMove: 2,
  });
  const movePointer = startMouseResize(win, [150, 200, 1 << 26]);

  movePointer([450, 200, 1 << 26]);

  assertEquals(win.moves.length, 1);
  assertEquals(win.frameMoves.length, 1);
  assertEquals(actors.map(({ destroyed }) => destroyed), [true, true]);
});

test("mouse resize defers and coalesces actual-frame indicator updates", () => {
  const win = createWindow();
  const movePointer = startMouseResize(win);

  movePointer([150, 200, 1 << 26], false);
  assertEquals(actors[1].sizeUpdates, 1);
  drainMainContext();

  assertEquals(win.moves.length, 1);
  assertEquals(actors[1].sizeUpdates, 2);
});

test("mouse resize locks its first edge from the starting pointer", () => {
  const win = createWindow();
  const movePointer = startMouseResize(win, [150, 200, 1 << 26]);

  movePointer([450, 200, 1 << 26]);

  assertEquals(win.get_frame_rect(), {
    x: 400,
    y: 100,
    width: 100,
    height: 300,
  });
});

test("mouse resize ignores Shift held by its activation binding", () => {
  const win = createWindow();
  const modifiers = Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.SHIFT_MASK;
  const movePointer = startMouseResize(win, [150, 200, modifiers], modifiers);

  movePointer([450, 200, modifiers]);

  assertEquals(win.get_frame_rect(), {
    x: 400,
    y: 100,
    width: 100,
    height: 300,
  });
});

test("mouse resize follows the modifier used by its shortcut", () => {
  const win = createWindow();
  const control = Clutter.ModifierType.CONTROL_MASK;
  const movePointer = startMouseResize(win, [150, 200, control], control);

  waitForMainContext(150);
  movePointer([450, 200, control]);

  assertEquals(win.get_frame_rect(), {
    x: 400,
    y: 100,
    width: 100,
    height: 300,
  });
});

test("mouse resize exits when any shortcut modifier is released", () => {
  const win = createWindow();
  const control = Clutter.ModifierType.CONTROL_MASK;
  const modifiers = control | Clutter.ModifierType.MOD1_MASK;
  const movePointer = startMouseResize(win, [150, 200, modifiers], modifiers);

  movePointer([150, 200, control]);
  waitForMainContext(150);

  assertEquals(actors.map(({ destroyed }) => destroyed), [true, true]);
});

test("mouse resize ignores a Shift press made before edges lock", () => {
  const win = createWindow();
  const superOnly = Clutter.ModifierType.SUPER_MASK;
  const withShift = superOnly | Clutter.ModifierType.SHIFT_MASK;
  const movePointer = startMouseResize(win, [150, 200, superOnly]);

  movePointer([150, 200, withShift]);
  emitShift(true);
  movePointer([450, 200, withShift]);

  assertEquals(win.get_frame_rect(), {
    x: 400,
    y: 100,
    width: 100,
    height: 300,
  });
});

test("held Shift does not flip an axis locked after its press", () => {
  const win = createWindow();
  const superOnly = Clutter.ModifierType.SUPER_MASK;
  const withShift = superOnly | Clutter.ModifierType.SHIFT_MASK;
  const movePointer = startMouseResize(win, [150, 200, superOnly]);

  movePointer([450, 200, superOnly]);
  movePointer([450, 200, withShift]);
  emitShift(true);
  movePointer([550, 50, withShift]);

  assertEquals(win.get_frame_rect(), {
    x: 400,
    y: -50,
    width: 200,
    height: 450,
  });
});

test("mouse resize exits when conflicting shortcuts cannot be suppressed", () => {
  const win = createWindow();
  prepareMouseResize(win);
  mouseResize.run(
    config,
    logger,
    { suppressKeybindings: () => null },
    bindingFor(),
  );

  assertEquals(actors.map(({ destroyed }) => destroyed), [true]);
});

done("command lifecycle tests");
