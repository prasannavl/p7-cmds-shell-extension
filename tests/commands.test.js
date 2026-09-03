import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  win_mouseresize,
  win_mouseresize_destroy,
} from "../cmds/win_mouseresize.js";
import { win_optsize, win_optsize_destroy } from "../cmds/win_optsize.js";
import { assertEquals } from "./testlib.js";

const logger = { log() {}, verboseLog() {}, error() {} };
const state = new Map();
const config = {
  winOptsize: {
    aspectBasedInversion: false,
    scales: [[0.5, 0.5]],
    breakpoints: [],
  },
};
let passed = 0;

function createWindow({ id = 7, maximized = false, monitor = 0 } = {}) {
  let frameRect = maximized
    ? { x: 0, y: 0, width: 1000, height: 800 }
    : { x: 100, y: 100, width: 400, height: 300 };
  let maximizeFlags = maximized ? 3 : 0;
  const handlers = new Map();
  const moves = [];
  let unmaximizeCalls = 0;

  return {
    moves,
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
      moves.push({ x, y, width, height });
    },
    get_compositor_private: () => null,
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
      for (const { callback } of [...handlers.get(signal) ?? []]) callback();
    },
    restore(rect = { x: 120, y: 90, width: 420, height: 320 }) {
      maximizeFlags = 0;
      frameRect = rect;
      this.emit("size-changed");
    },
  };
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
    stage: { disconnectObject() {} },
    workspace_manager: { disconnectObject() {} },
  };
}

function cleanup() {
  win_mouseresize_destroy(state);
  win_optsize_destroy(state);
  state.clear();
  Main.setLayoutManager(null);
}

function test(name, callback) {
  cleanup();
  try {
    callback();
    passed += 1;
    print(`ok - ${name}`);
  } finally {
    cleanup();
  }
}

test("optsize applies centered geometry from the current work area", () => {
  const win = createWindow();
  setGlobal(win);
  Main.setLayoutManager({
    getWorkAreaForMonitor: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  });
  win_optsize(state, config, logger);
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
    win_optsize(state, config, logger);
    assertEquals(win.moves, []);
    cleanup();
  }
});

test("optsize waits for restored geometry before resizing", () => {
  const win = createWindow({ maximized: true });
  setGlobal(win);
  Main.setLayoutManager({
    getWorkAreaForMonitor: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  });
  win_optsize(state, config, logger);
  assertEquals(win.moves, []);
  win.restore();
  assertEquals(win.moves[0], { x: 250, y: 200, width: 500, height: 400 });
});

test("optsize cancels a pending restore when focus moves to another window", () => {
  const first = createWindow({ id: 1, maximized: true });
  const second = createWindow({ id: 2 });
  Main.setLayoutManager({
    getWorkAreaForMonitor: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  });

  setGlobal(first);
  win_optsize(state, config, logger);
  setGlobal(second);
  win_optsize(state, config, logger);
  first.restore();

  assertEquals(first.moves, []);
  assertEquals(second.moves[0], {
    x: 250,
    y: 200,
    width: 500,
    height: 400,
  });
  assertEquals(state.get("cmd-win-optsize").winId, 2);
});

test("mouse resize waits for restored geometry before entering resize mode", () => {
  const win = createWindow({ maximized: true });
  setGlobal(win);
  win_mouseresize(state, {}, logger);
  assertEquals(win.unmaximizeCalls, 1);
  assertEquals(state.get("cmd-win-mouseresize").active, false);
});

print(`${passed} command lifecycle tests passed`);
