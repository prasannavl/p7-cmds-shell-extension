import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { CONFIG_REVISION } from "../common/config.js";
import {
  createConflictKeybindingIndex,
  KeybindingOverrides,
} from "../common/keybindings.js";
import { KeybindingManager } from "../shell/keybindingmanager.js";
import {
  createTestSuite,
  installConnectObject,
  noopLogger,
} from "./gjstestlib.js";
import { assertEquals } from "./testlib.js";

const settings = new Gio.Settings({
  schema_id: "org.gnome.shell.extensions.p7-cmds",
});
const wmSettings = new Gio.Settings({
  schema_id: "org.gnome.desktop.wm.keybindings",
});
const mediaSettings = new Gio.Settings({
  schema_id: "org.gnome.settings-daemon.plugins.media-keys",
});
const customPaths = [
  "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/",
  "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/",
];
const customSettings = customPaths.map(
  (path) =>
    new Gio.Settings({
      schema_id:
        "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding",
      path,
    }),
);
const accelerator = "<Super><Shift>F12";
const logger = noopLogger;

function resetSettings() {
  for (const key of settings.settings_schema.list_keys()) settings.reset(key);
  wmSettings.reset("close");
  mediaSettings.reset("custom-keybindings");
  for (const custom of customSettings) custom.reset("binding");
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

function enableManager(
  commandList = commands(),
  managerLogger = logger,
  conflictIndex,
) {
  const manager = new KeybindingManager(
    settings,
    managerLogger,
    commandList,
    conflictIndex,
  );
  manager.enable();
  return manager;
}

function enableTemporaryOverride(matches, managerLogger = logger, index) {
  let override;
  const manager = enableManager(
    commands((_config, _logger, runtime) => {
      override = runtime.suppressKeybindings(matches);
    }),
    managerLogger,
    index,
  );
  return {
    manager,
    get override() {
      return override;
    },
  };
}

function createLockedConflictIndex(binding) {
  const settings = {
    schema_id: "org.example.locked",
    get_value: () => ({ get_type_string: () => "as" }),
    get_strv: () => [binding],
    set_strv: () => false,
  };
  return { settings, index: [{ settings, keys: ["binding"] }] };
}

function createLockableConflictIndex(binding) {
  let bindings = [binding];
  let writeAttempts = 0;
  let writesRemaining = Infinity;
  const settings = {
    schema_id: "org.example.lockable",
    get_value: () => ({ get_type_string: () => "as" }),
    get_strv: () => [...bindings],
    set_strv(_key, next) {
      writeAttempts += 1;
      if (writesRemaining === 0) return false;
      writesRemaining -= 1;
      bindings = [...next];
      return true;
    },
  };
  return {
    settings,
    index: [{ settings, keys: ["binding"] }],
    get writeAttempts() {
      return writeAttempts;
    },
    setWritable(value) {
      writesRemaining = value ? Infinity : 0;
    },
    setWriteLimit(limit) {
      writesRemaining = limit;
    },
  };
}

const { test, done } = createTestSuite(resetSettings);

test("conflict subscriptions use standalone GObject signals", () => {
  const unsubscribe = createConflictKeybindingIndex().subscribe(() => {});
  unsubscribe();
});

installConnectObject(Gio.Settings.prototype);

test("non-conflicting commands are registered and removed", () => {
  prepareBinding();
  let receivedConfig = null;
  const manager = enableManager(
    commands((config) => {
      receivedConfig = config;
    }),
  );
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
  const manager = enableManager();
  assertEquals(Main.wm.added, []);
  assertEquals(wmSettings.get_strv("close"), [accelerator]);
  manager.disable();
});

test("overridden conflicts are restored on disable", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator]);
  const manager = enableManager();
  assertEquals(Main.wm.added.length, 1);
  assertEquals(wmSettings.get_strv("close"), []);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [accelerator]);
});

test("locked conflicts abort registration without claiming suppression", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  const locked = createLockedConflictIndex(accelerator);
  wmSettings.set_strv("close", [accelerator]);
  const errors = [];
  const manager = enableManager(
    commands(),
    { ...logger, error: (message) => errors.push(message) },
    [{ settings: wmSettings, keys: ["close"] }, ...locked.index],
  );

  assertEquals(Main.wm.added, []);
  assertEquals(wmSettings.get_strv("close"), [accelerator]);
  assertEquals(locked.settings.get_strv("binding"), [accelerator]);
  assertEquals(errors, [
    "Failed to suppress keybind org.example.locked::binding",
  ]);
  manager.disable();
});

test("failed restoration retains ownership and succeeds when retried", () => {
  const conflict = createLockableConflictIndex(accelerator);
  const overrides = new KeybindingOverrides(conflict.index);
  const override = overrides.suppress((binding) => binding === accelerator);
  assertEquals(conflict.settings.get_strv("binding"), []);

  conflict.setWritable(false);
  assertEquals(
    override.restore(),
    {
      changes: [],
      failures: [{
        schemaId: "org.example.lockable",
        key: "binding",
        bindings: [accelerator],
      }],
    },
  );

  conflict.setWritable(true);
  assertEquals(overrides.clear(), {
    changes: [{
      schemaId: "org.example.lockable",
      key: "binding",
      bindings: [accelerator],
    }],
    failures: [],
  });
  assertEquals(conflict.settings.get_strv("binding"), [accelerator]);
});

test("overlap restoration reports failed re-suppression", () => {
  const conflict = createLockableConflictIndex(accelerator);
  const overrides = new KeybindingOverrides(conflict.index);
  const matches = (binding) => binding === accelerator;
  const first = overrides.suppress(matches);
  const second = overrides.suppress(matches);
  conflict.setWriteLimit(1);

  assertEquals(first.restore(), {
    changes: [],
    failures: [{
      schemaId: "org.example.lockable",
      key: "binding",
      bindings: [accelerator],
    }],
  });
  assertEquals(conflict.settings.get_strv("binding"), [accelerator]);

  conflict.setWritable(true);
  second.restore();
});

test("manager reports rejected conflict restoration", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  const conflict = createLockableConflictIndex(accelerator);
  const errors = [];
  const manager = enableManager(
    commands(),
    { ...logger, error: (message) => errors.push(message) },
    conflict.index,
  );
  conflict.setWritable(false);

  manager.disable();

  assertEquals(errors, [
    "Failed to restore keybind org.example.lockable::binding",
  ]);
});

test("dynamic custom shortcuts participate in conflict detection", () => {
  prepareBinding();
  mediaSettings.set_strv("custom-keybindings", [customPaths[0]]);
  customSettings[0].set_string("binding", accelerator);
  const manager = enableManager();

  assertEquals(Main.wm.added, []);
  assertEquals(customSettings[0].get_string("binding"), accelerator);
  manager.disable();
});

test("conflict subscriptions follow system and dynamic custom shortcuts", () => {
  const index = createConflictKeybindingIndex();
  let changes = 0;
  const unsubscribe = index.subscribe(() => {
    changes += 1;
  });

  wmSettings.set_strv("close", [accelerator]);
  assertEquals(changes, 1);

  mediaSettings.set_strv("custom-keybindings", [customPaths[0]]);
  customSettings[0].set_string("binding", accelerator);
  assertEquals(changes, 3);

  mediaSettings.set_strv("custom-keybindings", []);
  customSettings[0].set_string("binding", "<Super>F10");
  assertEquals(changes, 4);

  unsubscribe();
  wmSettings.set_strv("close", []);
  assertEquals(changes, 4);
});

test("overridden custom shortcuts are restored on disable", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  mediaSettings.set_strv("custom-keybindings", [customPaths[1]]);
  customSettings[1].set_string("binding", accelerator);
  const manager = enableManager();

  assertEquals(Main.wm.added.length, 1);
  assertEquals(customSettings[1].get_string("binding"), "");
  manager.disable();
  assertEquals(customSettings[1].get_string("binding"), accelerator);
});

test("restoration preserves concurrent custom shortcut edits", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  mediaSettings.set_strv("custom-keybindings", [customPaths[0]]);
  customSettings[0].set_string("binding", accelerator);
  const manager = enableManager();

  customSettings[0].set_string("binding", "<Super>F10");
  manager.disable();

  assertEquals(customSettings[0].get_string("binding"), "<Super>F10");
});

test("commands receive manager-owned temporary keybinding overrides", () => {
  prepareBinding();
  const temporaryAccelerator = "<Super>Left";
  wmSettings.set_strv("close", [temporaryAccelerator, "<Alt>F4"]);
  const session = enableTemporaryOverride(
    (binding) => binding === temporaryAccelerator,
  );
  Main.wm.added[0][4]();
  assertEquals(Boolean(session.override), true);
  assertEquals(wmSettings.get_strv("close"), ["<Alt>F4"]);
  session.override.restore();
  assertEquals(wmSettings.get_strv("close"), [temporaryAccelerator, "<Alt>F4"]);
  session.manager.disable();
});

test("temporary overrides report locked conflicts without binding churn", () => {
  prepareBinding();
  const temporaryAccelerator = "<Super>Left";
  const locked = createLockedConflictIndex(temporaryAccelerator);
  wmSettings.set_strv("close", [temporaryAccelerator]);
  const errors = [];
  const session = enableTemporaryOverride(
    (binding) => binding === temporaryAccelerator,
    { ...logger, error: (message) => errors.push(message) },
    [{ settings: wmSettings, keys: ["close"] }, ...locked.index],
  );

  Main.wm.added[0][4]();

  assertEquals(session.override, null);
  assertEquals(errors, [
    "Failed to suppress keybind org.example.locked::binding",
  ]);
  assertEquals(locked.settings.get_strv("binding"), [temporaryAccelerator]);
  assertEquals(wmSettings.get_strv("close"), [temporaryAccelerator]);
  assertEquals(Main.wm.removed, []);
  session.manager.disable();
});

test("temporary overrides suspend matching extension commands", () => {
  prepareBinding();
  const session = enableTemporaryOverride((binding) => binding === accelerator);

  Main.wm.added[0][4]();

  assertEquals(Main.wm.removed, [["cmd-win-optsize"]]);
  assertEquals(Main.wm.added.length, 1);
  session.override.restore();
  assertEquals(Main.wm.added.length, 2);
  session.manager.disable();
});

test("disable restores outstanding command keybinding overrides", () => {
  prepareBinding();
  const temporaryAccelerator = "<Super>Left";
  wmSettings.set_strv("close", [temporaryAccelerator]);
  const session = enableTemporaryOverride(
    (binding) => binding === temporaryAccelerator,
  );
  Main.wm.added[0][4]();
  assertEquals(wmSettings.get_strv("close"), []);
  session.manager.disable();
  assertEquals(wmSettings.get_strv("close"), [temporaryAccelerator]);
});

test("temporary overrides survive keybinding reloads", () => {
  prepareBinding();
  const temporaryAccelerator = "<Super>Left";
  wmSettings.set_strv("close", [temporaryAccelerator]);
  const session = enableTemporaryOverride(
    (binding) => binding === temporaryAccelerator,
  );
  Main.wm.added[0][4]();
  settings.set_strv("cmd-win-optsize", ["<Super>F11"]);
  assertEquals(wmSettings.get_strv("close"), []);
  session.override.restore();
  assertEquals(wmSettings.get_strv("close"), [temporaryAccelerator]);
  session.manager.disable();
});

test("temporary overrides cannot hide conflicts during reload", () => {
  prepareBinding();
  const temporaryAccelerator = "<Super>Left";
  wmSettings.set_strv("close", [temporaryAccelerator]);
  const session = enableTemporaryOverride(
    (binding) => binding === temporaryAccelerator,
  );
  Main.wm.added[0][4]();

  settings.set_strv("cmd-win-optsize", [temporaryAccelerator]);

  assertEquals(Main.wm.added.length, 1);
  assertEquals(wmSettings.get_strv("close"), []);
  session.override.restore();
  assertEquals(wmSettings.get_strv("close"), [temporaryAccelerator]);
  session.manager.disable();
});

test("reload finds hidden conflicts without touching their settings", () => {
  prepareBinding();
  const temporaryAccelerator = "<Super>Left";
  const conflict = createLockableConflictIndex(temporaryAccelerator);
  const errors = [];
  const session = enableTemporaryOverride(
    (binding) => binding === temporaryAccelerator,
    { ...logger, error: (message) => errors.push(message) },
    conflict.index,
  );
  Main.wm.added[0][4]();
  const writesBeforeReload = conflict.writeAttempts;

  conflict.setWritable(false);
  settings.set_strv("cmd-win-optsize", [temporaryAccelerator]);

  assertEquals(conflict.writeAttempts, writesBeforeReload);
  assertEquals(Main.wm.added.length, 1);
  assertEquals(errors, []);

  conflict.setWritable(true);
  session.override.restore();
  session.manager.disable();
});

test("restoring one temporary override preserves the others", () => {
  prepareBinding();
  const temporaryAccelerator = "<Super>Left";
  wmSettings.set_strv("close", [temporaryAccelerator]);
  let first;
  let second;
  const matches = (binding) => binding === temporaryAccelerator;
  const manager = new KeybindingManager(
    settings,
    logger,
    commands((_config, _logger, runtime) => {
      first = runtime.suppressKeybindings(matches);
      second = runtime.suppressKeybindings(matches);
    }),
  );
  manager.enable();
  Main.wm.added[0][4]();
  first.restore();
  assertEquals(wmSettings.get_strv("close"), []);
  second.restore();
  assertEquals(wmSettings.get_strv("close"), [temporaryAccelerator]);
  manager.disable();
});

test("overrides preserve unrelated bindings while active", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", ["<Alt>F4", accelerator, "<Super>F10"]);
  const manager = enableManager();
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
  const manager = enableManager();
  assertEquals(wmSettings.get_strv("close"), ["<Alt>F4"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), ["<Shift><Super>F12", "<Alt>F4"]);
});

test("Mutter's Alt and Mod1 aliases share conflict ownership", () => {
  prepareBinding();
  settings.set_strv("cmd-win-optsize", ["<Alt>F12"]);
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", ["<Mod1>f12", "<Alt>F4"]);
  const manager = enableManager();
  assertEquals(wmSettings.get_strv("close"), ["<Alt>F4"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), ["<Mod1>f12", "<Alt>F4"]);
});

test("Super does not assume that the active keymap maps it to Mod4", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", ["<Mod4><Shift>F12", "<Alt>F4"]);
  const manager = enableManager();
  assertEquals(wmSettings.get_strv("close"), [
    "<Mod4><Shift>F12",
    "<Alt>F4",
  ]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [
    "<Mod4><Shift>F12",
    "<Alt>F4",
  ]);
});

test("ignored external modifiers cannot bypass conflict ownership", () => {
  prepareBinding();
  settings.set_strv("cmd-win-optsize", ["F12"]);
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", ["<Release>F12"]);
  const manager = enableManager();
  assertEquals(wmSettings.get_strv("close"), []);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), ["<Release>F12"]);
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
  const manager = enableManager(commands(), recordingLogger);
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
  const manager = enableManager();
  wmSettings.set_strv("close", ["<Super>F10"]);
  manager.disable();
  assertEquals(wmSettings.get_strv("close"), [accelerator, "<Super>F10"]);
});

test("reloads preserve concurrent system binding changes", () => {
  prepareBinding();
  settings.set_boolean("override-conflicting-bindings", true);
  wmSettings.set_strv("close", [accelerator, "<Alt>F4"]);
  const manager = enableManager();
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
  const manager = enableManager(commands(), errorLogger);
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
  const manager = enableManager(commands(), errorLogger);
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
  const manager = enableManager(
    [
      { id: "cmd-win-optsize", handler() {} },
      { id: "cmd-win-mouseresize", handler() {} },
    ],
    errorLogger,
  );
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

test("canonical duplicate accelerators are not registered across commands", () => {
  prepareBinding();
  settings.set_strv("cmd-win-mouseresize", ["<Shft><Super>f12"]);
  const errors = [];
  const errorLogger = {
    log() {},
    verboseLog() {},
    error(message) {
      errors.push(message);
    },
  };
  const manager = enableManager(
    [
      { id: "cmd-win-optsize", handler() {} },
      { id: "cmd-win-mouseresize", handler() {} },
    ],
    errorLogger,
  );

  assertEquals(
    Main.wm.added.map(([id]) => id),
    ["cmd-win-optsize"],
  );
  assertEquals(errors, [
    "Skipped binding cmd-win-mouseresize - <Shft><Super>f12 is already used by another command",
  ]);
  manager.disable();
});

test("settings changes reload bindings with current config", () => {
  prepareBinding();
  const manager = enableManager();
  settings.set_strv("cmd-win-optsize", ["<Super>F11"]);
  assertEquals(Main.wm.added.length, 2);
  assertEquals(Main.wm.removed, [["cmd-win-optsize"]]);
  manager.disable();
});

test("non-binding settings do not churn registered shortcuts", () => {
  prepareBinding();
  const manager = enableManager();

  settings.set_int("win-mouseresize-border-size", 8);

  assertEquals(Main.wm.added.length, 1);
  assertEquals(Main.wm.removed, []);
  manager.disable();
});

done("keybinding manager tests");
