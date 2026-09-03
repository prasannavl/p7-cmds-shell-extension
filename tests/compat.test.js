import Clutter from "gi://Clutter";
import {
  acceleratorsEqual,
  connectWhenWindowRestored,
  getMaximizeState,
  getWindowMonitor,
  hasSignal,
  normalizeAcceleratorKey,
  normalizeWindow,
  resolveTopLevelWindow,
} from "../shell/compat.js";
import { assertEquals } from "./testlib.js";

let passed = 0;

function test(name, callback) {
  callback();
  passed += 1;
  print(`ok - ${name}`);
}

test("maximize flags expose partial and full states", () => {
  assertEquals(
    getMaximizeState({
      get_maximize_flags: () => 1,
    }),
    {
      any: true,
      full: false,
      horizontal: true,
      vertical: false,
    },
  );
  assertEquals(
    getMaximizeState({
      get_maximize_flags: () => 3,
    }),
    {
      any: true,
      full: true,
      horizontal: true,
      vertical: true,
    },
  );
});

test("maximize properties provide the legacy flags", () => {
  assertEquals(
    getMaximizeState({
      maximized_horizontally: false,
      maximized_vertically: true,
    }),
    {
      any: true,
      full: false,
      horizontal: false,
      vertical: true,
    },
  );
});

test("normalization leaves ordinary windows untouched", () => {
  const calls = [];
  const win = {
    is_fullscreen: () => false,
    maximized_horizontally: false,
    maximized_vertically: false,
    unmake_fullscreen: () => calls.push("fullscreen"),
    unmaximize: () => calls.push("maximize"),
  };
  assertEquals(normalizeWindow(win), false);
  assertEquals(calls, []);
});

test("normalization clears fullscreen and maximize together", () => {
  const calls = [];
  const win = {
    is_fullscreen: () => true,
    maximized_horizontally: true,
    maximized_vertically: true,
    unmake_fullscreen: () => calls.push("fullscreen"),
    unmaximize: () => calls.push("maximize"),
  };
  assertEquals(normalizeWindow(win), true);
  assertEquals(calls, ["fullscreen", "maximize"]);
});

test("transient chains resolve to their top-level window", () => {
  const root = { get_transient_for: () => null };
  const parent = { get_transient_for: () => root };
  const child = { get_transient_for: () => parent };
  assertEquals(resolveTopLevelWindow(child) === root, true);
  assertEquals(resolveTopLevelWindow(null), null);
});

test("transient cycles terminate without looping", () => {
  const first = {};
  const second = { get_transient_for: () => first };
  first.get_transient_for = () => second;
  assertEquals(resolveTopLevelWindow(first) === second, true);
});

test("work-area monitor lookup rejects missing and stale monitors", () => {
  globalThis.global = { display: { get_n_monitors: () => 2 } };
  assertEquals(getWindowMonitor({ get_monitor: () => -1 }), null);
  assertEquals(getWindowMonitor({ get_monitor: () => 2 }), null);
  assertEquals(getWindowMonitor({ get_monitor: () => 1 }), 1);
});

test("signal lookup handles missing and non-GObject values", () => {
  assertEquals(hasSignal(null, "unmanaged"), false);
  assertEquals(hasSignal({}, "unmanaged"), false);
  assertEquals(hasSignal({}, "notify::fullscreen"), false);
});

test("restored-window callbacks wait for geometry signals and disconnect", () => {
  let maximized = true;
  const handlers = new Map();
  const owner = {};
  const calls = [];
  const win = {
    is_fullscreen: () => false,
    get maximized_horizontally() {
      return maximized;
    },
    get maximized_vertically() {
      return maximized;
    },
    connectObject(...args) {
      const connectionOwner = args.pop();
      for (let index = 0; index < args.length; index += 2) {
        handlers.set(args[index], {
          callback: args[index + 1],
          connectionOwner,
        });
      }
    },
    disconnectObject(connectionOwner) {
      for (const [signal, handler] of handlers) {
        if (handler.connectionOwner === connectionOwner) {
          handlers.delete(signal);
        }
      }
    },
    find_property: () => null,
  };

  connectWhenWindowRestored(
    win,
    owner,
    () => calls.push("restored"),
    () => calls.push("unmanaged"),
  );
  assertEquals(calls, []);
  maximized = false;
  handlers.get("size-changed").callback();
  assertEquals(calls, ["restored"]);
  assertEquals(handlers.size, 0);
});

test("restored-window callbacks cancel when the window is unmanaged", () => {
  const handlers = new Map();
  const owner = {};
  const calls = [];
  const win = {
    is_fullscreen: () => true,
    maximized_horizontally: false,
    maximized_vertically: false,
    connectObject(...args) {
      args.pop();
      for (let index = 0; index < args.length; index += 2) {
        handlers.set(args[index], args[index + 1]);
      }
    },
    disconnectObject() {
      handlers.clear();
    },
    find_property: () => null,
  };
  connectWhenWindowRestored(
    win,
    owner,
    () => calls.push("restored"),
    () => calls.push("unmanaged"),
  );
  handlers.get("unmanaged")();
  assertEquals(calls, ["unmanaged"]);
  assertEquals(handlers.size, 0);
});

test("Clutter normalizes supported accelerator key names", () => {
  assertEquals(normalizeAcceleratorKey("x"), String(Clutter.KEY_x));
  assertEquals(normalizeAcceleratorKey("F12"), String(Clutter.KEY_F12));
  assertEquals(
    normalizeAcceleratorKey("XF86AudioRaiseVolume"),
    String(Clutter.KEY_AudioRaiseVolume),
  );
  assertEquals(normalizeAcceleratorKey("VoidSymbol"), null);
  assertEquals(normalizeAcceleratorKey("DefinitelyNotAKey"), null);
  assertEquals(
    acceleratorsEqual("<Super><Shift>x", "<Shift><Super>x"),
    true,
  );
});

print(`${passed} compatibility tests passed`);
