import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import {
  CONFIG_REVISION,
  ConfigManager,
  DEFAULT_WIN_OPTSIZE_CONFIG,
} from "../common/config.js";
import { normalizeAcceleratorKey } from "../ext/compat.js";
import { assertEquals } from "./testlib.js";

if (!Gio.Settings.prototype.connectObject) {
  const ownedConnections = new WeakMap();
  Gio.Settings.prototype.connectObject = function (...args) {
    const owner = args.pop();
    const connections = ownedConnections.get(this) ?? new Map();
    const ids = connections.get(owner) ?? [];
    for (let index = 0; index < args.length; index += 2) {
      ids.push(this.connect(args[index], args[index + 1]));
    }
    connections.set(owner, ids);
    ownedConnections.set(this, connections);
  };
  Gio.Settings.prototype.disconnectObject = function (owner) {
    const connections = ownedConnections.get(this);
    for (const id of connections?.get(owner) ?? []) this.disconnect(id);
    connections?.delete(owner);
  };
}

const settings = new Gio.Settings({
  schema_id: "org.gnome.shell.extensions.p7-cmds",
});
const runtime = {
  keybindingFlags: Meta.KeyBindingFlags,
  actionModes: Shell.ActionMode,
  normalizeAcceleratorKey,
};
let passed = 0;

function resetSettings() {
  for (const key of settings.settings_schema.list_keys()) settings.reset(key);
}

function loggerFixture() {
  return {
    messages: [],
    errors: [],
    log(message) {
      this.messages.push(message);
    },
    verboseLog(message) {
      this.messages.push(message);
    },
    error(...args) {
      this.errors.push(args);
    },
  };
}

function withManager(callback, logger = loggerFixture()) {
  const manager = new ConfigManager(settings, logger, runtime);
  try {
    callback(manager, logger);
  } finally {
    manager.destroy();
  }
}

function test(name, callback) {
  resetSettings();
  try {
    callback();
    passed += 1;
    print(`ok - ${name}`);
  } finally {
    resetSettings();
  }
}

test("first load persists the current config revision and schema defaults", () => {
  withManager((manager) => {
    assertEquals(settings.get_int("config-version"), CONFIG_REVISION);
    assertEquals(
      settings.get_user_value("config-version")?.get_int32(),
      CONFIG_REVISION,
    );
    assertEquals(settings.get_user_value("cmd-win-optsize") !== null, true);
    assertEquals(manager.getConfig().winOptsize, DEFAULT_WIN_OPTSIZE_CONFIG);
  });
});

test("old revisions reset managed optsize JSON before loading", () => {
  settings.set_string("win-optsize-config", '{"scales":[[0.2,0.2]]}');
  settings.set_int("config-version", CONFIG_REVISION - 1);
  withManager((manager, logger) => {
    assertEquals(manager.getConfig().winOptsize, DEFAULT_WIN_OPTSIZE_CONFIG);
    assertEquals(
      logger.messages.includes(
        `Reset win-optsize-config for config revision ${CONFIG_REVISION}`,
      ),
      true,
    );
  });
});

test("future revisions are not downgraded or reset", () => {
  settings.set_int("config-version", CONFIG_REVISION + 7);
  settings.set_string("win-optsize-config", '{"scales":[[0.4,0.5]]}');
  withManager((manager) => {
    assertEquals(settings.get_int("config-version"), CONFIG_REVISION + 7);
    assertEquals(manager.getConfig().winOptsize.scales, [[0.4, 0.5]]);
  });
});

test("invalid optsize JSON falls back without replacing the user value", () => {
  settings.set_int("config-version", CONFIG_REVISION);
  settings.set_string("win-optsize-config", '{"scales":"wide"}');
  withManager((manager, logger) => {
    assertEquals(manager.getConfig().winOptsize, DEFAULT_WIN_OPTSIZE_CONFIG);
    assertEquals(
      settings.get_string("win-optsize-config"),
      '{"scales":"wide"}',
    );
    assertEquals(
      logger.messages.some((message) =>
        message.startsWith("Invalid win-optsize-config")
      ),
      true,
    );
  });
});

test("keybindings are safely sanitized and persisted", () => {
  settings.set_strv("cmd-win-optsize", [
    " <Super>x ",
    "<Super>x",
    "<broken",
    "<Bogus>x",
    "<Super>DefinitelyNotAKey",
    "<Mod1>F12",
    "<Super>y",
  ]);
  withManager((manager) => {
    assertEquals(manager.getConfig().keybindings["cmd-win-optsize"], [
      "<Super>x",
      "<Mod1>F12",
      "<Super>y",
    ]);
    assertEquals(settings.get_strv("cmd-win-optsize"), [
      "<Super>x",
      "<Mod1>F12",
      "<Super>y",
    ]);
  });
});

test("named and numeric enum settings map to runtime values", () => {
  settings.set_string("keybinding-flags", "NONE");
  settings.set_string("keybinding-actionmode", "7");
  withManager((manager) => {
    assertEquals(
      manager.getConfig().keybindingFlags,
      Meta.KeyBindingFlags.NONE,
    );
    assertEquals(manager.getConfig().actionMode, 7);
  });
});

test("unknown enum settings use safe runtime defaults", () => {
  settings.set_string("keybinding-flags", "FUTURE");
  settings.set_string("keybinding-actionmode", "FUTURE");
  withManager((manager) => {
    assertEquals(
      manager.getConfig().keybindingFlags,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
    );
    assertEquals(manager.getConfig().actionMode, Shell.ActionMode.NORMAL);
  });
});

test("settings changes reload the whole config and notify listeners", () => {
  withManager((manager) => {
    const changes = [];
    manager.addConfigChangeListener((change) => changes.push(change));
    settings.set_int("win-mouseresize-border-size", 8);
    assertEquals(manager.getConfig().winMouseResize.borderSize, 8);
    assertEquals(changes, ["settings-changed"]);
  });
});

test("one failing listener does not prevent later listeners", () => {
  withManager((manager, logger) => {
    const changes = [];
    manager.addConfigChangeListener(() => {
      throw new Error("broken listener");
    });
    manager.addConfigChangeListener((change) => changes.push(change));
    settings.set_boolean("override-conflicting-bindings", true);
    assertEquals(changes, ["settings-changed"]);
    assertEquals(logger.errors.length, 1);
  });
});

test("destroy disconnects settings and clears listeners", () => {
  const manager = new ConfigManager(settings, loggerFixture(), runtime);
  const changes = [];
  manager.addConfigChangeListener((change) => changes.push(change));
  manager.destroy();
  settings.set_boolean("override-conflicting-bindings", true);
  assertEquals(changes, []);
});

print(`${passed} GSettings tests passed`);
