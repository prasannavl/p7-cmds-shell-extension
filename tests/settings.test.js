import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import {
  CONFIG_REVISION,
  ConfigManager,
  DEFAULT_WIN_OPTSIZE_CONFIG,
} from "../common/config.js";
import { normalizeAcceleratorKey } from "../shell/compat.js";
import { Logger } from "../shell/logger.js";
import { readFullConfig, replaceFullConfig } from "../prefs/config.js";
import { createTestSuite, installConnectObject } from "./gjstestlib.js";
import { assertEquals } from "./testlib.js";

installConnectObject(Gio.Settings.prototype);

const settings = new Gio.Settings({
  schema_id: "org.gnome.shell.extensions.p7-cmds",
});
const runtime = {
  keybindingFlags: Meta.KeyBindingFlags,
  actionModes: Shell.ActionMode,
  normalizeAcceleratorKey,
};
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

const { test, done } = createTestSuite(resetSettings);

test("first load persists the current config revision and schema defaults", () => {
  withManager((manager) => {
    assertEquals(settings.get_int("config-version"), CONFIG_REVISION);
    assertEquals(
      settings.get_user_value("config-version")?.get_int32(),
      CONFIG_REVISION,
    );
    assertEquals(manager.config.configVersion, CONFIG_REVISION);
    assertEquals(settings.get_user_value("cmd-win-optsize") !== null, true);
    assertEquals(manager.config.winOptsize, DEFAULT_WIN_OPTSIZE_CONFIG);
  });
});

test("old revisions reset managed optsize JSON before loading", () => {
  settings.set_string("win-optsize-config", '{"scales":[[0.2,0.2]]}');
  settings.set_int("config-version", CONFIG_REVISION - 1);
  withManager((manager, logger) => {
    assertEquals(manager.config.winOptsize, DEFAULT_WIN_OPTSIZE_CONFIG);
    assertEquals(
      logger.messages.includes(
        `Reset win-optsize-config for config revision ${CONFIG_REVISION}`,
      ),
      true,
    );
  });
});

test("downgrading the revision while enabled reapplies migration", () => {
  withManager((manager) => {
    settings.set_string("win-optsize-config", '{"scales":[[0.2,0.2]]}');
    settings.set_int("config-version", CONFIG_REVISION - 1);

    assertEquals(settings.get_int("config-version"), CONFIG_REVISION);
    assertEquals(manager.config.winOptsize, DEFAULT_WIN_OPTSIZE_CONFIG);
  });
});

test("future revisions are not downgraded or reset", () => {
  settings.set_int("config-version", CONFIG_REVISION + 7);
  settings.set_string("win-optsize-config", '{"scales":[[0.4,0.5]]}');
  withManager((manager) => {
    assertEquals(settings.get_int("config-version"), CONFIG_REVISION + 7);
    assertEquals(manager.config.winOptsize.scales, [[0.4, 0.5]]);
  });
});

test("invalid optsize JSON falls back without replacing the user value", () => {
  settings.set_int("config-version", CONFIG_REVISION);
  settings.set_string("win-optsize-config", '{"scales":"wide"}');
  withManager((manager, logger) => {
    assertEquals(manager.config.winOptsize, DEFAULT_WIN_OPTSIZE_CONFIG);
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
    "<Mod1>f12",
    "<Alt>F12",
    "<Release>F11",
    "<Super>y",
  ]);
  withManager((manager) => {
    assertEquals(manager.config.keybindings["cmd-win-optsize"], [
      "<Super>x",
      "<Mod1>f12",
      "<Super>y",
    ]);
    assertEquals(settings.get_strv("cmd-win-optsize"), [
      "<Super>x",
      "<Mod1>f12",
      "<Super>y",
    ]);
  });
});

test("named and numeric enum settings map to runtime values", () => {
  settings.set_string("keybinding-flags", "NONE");
  settings.set_string("keybinding-actionmode", "7");
  settings.set_boolean("override-conflicting-bindings", true);
  settings.set_boolean("verbose-logging", true);
  withManager((manager) => {
    assertEquals(manager.config.keybindingFlags, Meta.KeyBindingFlags.NONE);
    assertEquals(manager.config.actionMode, 7);
    assertEquals(manager.config.overrideConflictingBindings, true);
    assertEquals(Object.hasOwn(manager.config, "verboseLogging"), false);
  });
});

test("unknown enum settings use safe runtime defaults", () => {
  settings.set_string("keybinding-flags", "FUTURE");
  settings.set_string("keybinding-actionmode", "FUTURE");
  withManager((manager) => {
    assertEquals(
      manager.config.keybindingFlags,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
    );
    assertEquals(manager.config.actionMode, Shell.ActionMode.NORMAL);
  });
});

test("logger owns the verbose setting lifecycle", () => {
  settings.set_boolean("verbose-logging", true);
  const messages = [];
  const logger = new Logger(
    settings,
    {
      log: (message) => messages.push(message),
      error() {},
    },
  );
  logger.verboseLog("visible");
  settings.set_boolean("verbose-logging", false);
  logger.verboseLog("hidden");
  logger.destroy();
  settings.set_boolean("verbose-logging", true);
  logger.verboseLog("after destroy");
  assertEquals(messages, ["visible"]);
});

test("settings changes reload the whole config and notify listeners", () => {
  withManager((manager) => {
    const changes = [];
    manager.subscribe((change) => changes.push(change));
    settings.set_int("win-mouseresize-border-size", 8);
    assertEquals(manager.config.winMouseResize.borderSize, 8);
    assertEquals(changes, ["win-mouseresize-border-size"]);
  });
});

test("optsize scale changes take effect in the live config snapshot", () => {
  withManager((manager) => {
    settings.set_string(
      "win-optsize-config",
      '{"scales":[[0.7,0.6]],"breakpoints":[],"aspectBasedInversion":false}',
    );
    assertEquals(manager.config.winOptsize.scales, [[0.7, 0.6]]);
    assertEquals(manager.config.winOptsize.breakpoints, []);
  });
});

test("configuration preserves resize indicator values", () => {
  settings.set_string("win-mouseresize-border-color", "custom-border");
  settings.set_string("win-mouseresize-background-color", "custom-fill");
  settings.set_int("win-mouseresize-border-size", 8);
  withManager((manager) => {
    assertEquals(manager.config.winMouseResize, {
      borderColor: "custom-border",
      backgroundColor: "custom-fill",
      borderSize: 8,
    });
  });
});

test("configuration contains malformed indicator CSS values", () => {
  settings.set_string(
    "win-mouseresize-border-color",
    "red; border-width: 100px",
  );
  settings.set_string("win-mouseresize-background-color", "red\ncolor: blue");
  withManager((manager) => {
    assertEquals(
      manager.config.winMouseResize.borderColor,
      "rgba(225, 133, 133, 0.8)",
    );
    assertEquals(
      manager.config.winMouseResize.backgroundColor,
      "rgba(70,70,70,0.2)",
    );
  });
});

test("full config export and import round-trip every user setting", () => {
  settings.set_strv("cmd-win-optsize", ["<Alt>F12"]);
  settings.set_strv("cmd-win-mouseresize", []);
  settings.set_string("keybinding-flags", "NONE");
  settings.set_string("keybinding-actionmode", "7");
  settings.set_boolean("override-conflicting-bindings", true);
  settings.set_boolean("verbose-logging", true);
  settings.set_string(
    "win-optsize-config",
    '{"scales":[[0.7,null]],"breakpoints":[],"aspectBasedInversion":true}',
  );
  settings.set_string("win-mouseresize-border-color", "red");
  settings.set_string("win-mouseresize-background-color", "transparent");
  settings.set_int("win-mouseresize-border-size", 9);
  const exported = readFullConfig(settings, normalizeAcceleratorKey);

  resetSettings();
  const imported = replaceFullConfig(
    settings,
    exported,
    normalizeAcceleratorKey,
  );

  assertEquals(imported, exported);
  assertEquals(
    readFullConfig(settings, normalizeAcceleratorKey),
    exported,
  );
  assertEquals(settings.get_int("config-version"), CONFIG_REVISION);
});

test("invalid full config cannot partially change settings", () => {
  const original = readFullConfig(settings, normalizeAcceleratorKey);
  const invalid = JSON.parse(JSON.stringify(original));
  invalid.winMouseResize.borderSize = 0;
  let error = null;
  try {
    replaceFullConfig(settings, invalid, normalizeAcceleratorKey);
  } catch (caught) {
    error = caught;
  }
  assertEquals(error instanceof Error, true);
  assertEquals(
    readFullConfig(settings, normalizeAcceleratorKey),
    original,
  );
});

test("sanitizing a settings change emits one configuration reload", () => {
  withManager((manager) => {
    const changes = [];
    manager.subscribe((change) => changes.push(change));
    settings.set_strv("cmd-win-optsize", ["<Super>x", "<broken"]);
    assertEquals(settings.get_strv("cmd-win-optsize"), ["<Super>x"]);
    assertEquals(changes, ["cmd-win-optsize"]);
  });
});

test("one failing listener does not prevent later listeners", () => {
  withManager((manager, logger) => {
    const changes = [];
    manager.subscribe(() => {
      throw new Error("broken listener");
    });
    manager.subscribe((change) => changes.push(change));
    settings.set_boolean("override-conflicting-bindings", true);
    assertEquals(changes, ["override-conflicting-bindings"]);
    assertEquals(logger.errors.length, 1);
  });
});

test("destroy disconnects settings and clears listeners", () => {
  const manager = new ConfigManager(settings, loggerFixture(), runtime);
  const changes = [];
  manager.subscribe((change) => changes.push(change));
  manager.destroy();
  settings.set_boolean("override-conflicting-bindings", true);
  assertEquals(changes, []);
});

done("GSettings tests");
