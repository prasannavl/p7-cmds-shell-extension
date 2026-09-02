import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { CONFIG_REVISION } from "../common/config.js";
import { KeybindingManager } from "../ext/keybindingmanager.js";
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
const wmSettings = new Gio.Settings({
  schema_id: "org.gnome.desktop.wm.keybindings",
});
const accelerator = "<Super><Shift>F12";
const logger = { log() {}, verboseLog() {}, error() {} };
let passed = 0;

function resetSettings() {
  for (const key of settings.settings_schema.list_keys()) settings.reset(key);
  wmSettings.reset("close");
  Main.wm.reset();
}

function commands(handler = () => {}) {
  return [{ id: "cmd-win-optsize", handler }];
}

function prepareBinding() {
  settings.set_int("config-version", CONFIG_REVISION);
  settings.set_strv("cmd-win-optsize", [accelerator]);
  settings.set_strv("cmd-win-mouseresize", []);
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

test("non-conflicting commands are registered and removed", () => {
  prepareBinding();
  let receivedConfig = null;
  const manager = new KeybindingManager(
    settings,
    logger,
    commands((config) => {
      receivedConfig = config;
    }),
  );
  manager.enable();
  assertEquals(Main.wm.added.length, 1);
  assertEquals(Main.wm.added[0][0], "cmd-win-optsize");
  Main.wm.added[0][4]();
  assertEquals(receivedConfig.keybindings["cmd-win-optsize"], [accelerator]);
  manager.disable();
  assertEquals(Main.wm.removed, [["cmd-win-optsize"]]);
});

test("conflicts skip a command when overrides are disabled", () => {
  prepareBinding();
  wmSettings.set_strv("close", [accelerator]);
  const manager = new KeybindingManager(settings, logger, commands());
  manager.enable();
  assertEquals(Main.wm.added, []);
  assertEquals(wmSettings.get_strv("close"), [accelerator]);
  manager.disable();
});

test("overridden conflicts are restored on disable", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator]);
  const manager = new KeybindingManager(settings, logger, commands());
  manager.enable();
  assertEquals(Main.wm.added.length, 1);
  assertEquals(wmSettings.get_strv("close"), []);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [accelerator]);
});

test("overrides preserve unrelated bindings while active", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", ["<Alt>F4", accelerator, "<Super>F10"]);
  const manager = new KeybindingManager(settings, logger, commands());
  manager.enable();
  assertEquals(wmSettings.get_strv("close"), ["<Alt>F4", "<Super>F10"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [
    "<Alt>F4",
    accelerator,
    "<Super>F10",
  ]);
});

test("conflicts are matched across equivalent modifier orderings", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", ["<Shift><Super>F12", "<Alt>F4"]);
  const manager = new KeybindingManager(settings, logger, commands());
  manager.enable();
  assertEquals(wmSettings.get_strv("close"), ["<Alt>F4"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [
    "<Shift><Super>F12",
    "<Alt>F4",
  ]);
});

test("restoration does not duplicate an equivalent concurrent binding", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", ["<Shift><Super>F12", "<Alt>F4"]);
  const messages = [];
  const recordingLogger = {
    log() {},
    verboseLog(message) {
      messages.push(message);
    },
    error() {},
  };
  const manager = new KeybindingManager(settings, recordingLogger, commands());
  manager.enable();
  wmSettings.set_strv("close", ["<SUPER><SHIFT>F12", "<Super>F10"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [
    "<SUPER><SHIFT>F12",
    "<Super>F10",
  ]);
  assertEquals(
    messages.some((message) => message.startsWith("Restored keybind")),
    false,
  );
});

test("restoration merges changes made while an override is active", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator, "<Alt>F4"]);
  const manager = new KeybindingManager(settings, logger, commands());
  manager.enable();
  wmSettings.set_strv("close", ["<Super>F10"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [accelerator, "<Super>F10"]);
});

test("reloads preserve concurrent system binding changes", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator, "<Alt>F4"]);
  const manager = new KeybindingManager(settings, logger, commands());
  manager.enable();
  wmSettings.set_strv("close", ["<Super>F10"]);
  settings.set_int("win-mouseresize-border-size", 8);
  assertEquals(wmSettings.get_strv("close"), ["<Super>F10"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [accelerator, "<Super>F10"]);
});

test("failed registrations immediately restore suppressed conflicts", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator, "<Alt>F4"]);
  Main.wm.addResult = 0;
  const errors = [];
  const errorLogger = {
    log() {},
    verboseLog() {},
    error(message) {
      errors.push(message);
    },
  };
  const manager = new KeybindingManager(settings, errorLogger, commands());
  manager.enable();
  assertEquals(wmSettings.get_strv("close"), [accelerator, "<Alt>F4"]);
  assertEquals(errors, ["Failed to bind keybind cmd-win-optsize"]);
  manager.disable();
});

test("registration exceptions immediately restore suppressed conflicts", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator, "<Alt>F4"]);
  Main.wm.addError = new Error("registration failed");
  const errors = [];
  const errorLogger = {
    log() {},
    verboseLog() {},
    error(...args) {
      errors.push(args);
    },
  };
  const manager = new KeybindingManager(settings, errorLogger, commands());
  manager.enable();
  assertEquals(wmSettings.get_strv("close"), [accelerator, "<Alt>F4"]);
  assertEquals(errors.length, 1);
  manager.disable();
});

test("registration is atomic across commands and one override lease", () => {
  prepareBinding();
  const secondAccelerator = "<Super>F11";
  settings.set_strv("cmd-win-mouseresize", [secondAccelerator]);
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator, secondAccelerator, "<Alt>F4"]);
  Main.wm.addResults.push(1, 0);
  const errors = [];
  const errorLogger = {
    log() {},
    verboseLog() {},
    error(message) {
      errors.push(message);
    },
  };
  const manager = new KeybindingManager(settings, errorLogger, [
    { id: "cmd-win-optsize", handler() {} },
    { id: "cmd-win-mouseresize", handler() {} },
  ]);
  manager.enable();
  assertEquals(Main.wm.added.length, 2);
  assertEquals(Main.wm.removed, [["cmd-win-optsize"]]);
  assertEquals(wmSettings.get_strv("close"), [
    accelerator,
    secondAccelerator,
    "<Alt>F4",
  ]);
  assertEquals(errors, ["Failed to bind keybind cmd-win-mouseresize"]);
  manager.disable();
  assertEquals(Main.wm.removed, [["cmd-win-optsize"]]);
});

test("settings changes reload bindings with current config", () => {
  prepareBinding();
  const manager = new KeybindingManager(settings, logger, commands());
  manager.enable();
  settings.set_strv("cmd-win-optsize", ["<Super>F11"]);
  assertEquals(Main.wm.added.length, 2);
  assertEquals(Main.wm.removed, [["cmd-win-optsize"]]);
  manager.disable();
});

print(`${passed} keybinding manager tests passed`);
