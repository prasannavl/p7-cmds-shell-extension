import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { ConfigManager } from "../common/config.js";
import {
  createConflictKeybindingIndex,
  findConflictingKeybindings,
  KeybindingOverrideLease,
} from "../common/keybindings.js";
import { acceleratorsEqual, normalizeAcceleratorKey } from "./compat.js";

export class KeybindingManager {
  constructor(settings, logger, commands) {
    this._settings = settings;
    this._logger = logger;
    this._commands = commands;
    this._configManager = new ConfigManager(settings, logger, {
      keybindingFlags: Meta.KeyBindingFlags,
      actionModes: Shell.ActionMode,
      normalizeAcceleratorKey,
    });
    this._configChangeCallback = (change) => this._onConfigChanged(change);
    this._conflictIndex = createConflictKeybindingIndex();
    this._overrideLease = null;
    this._boundCommandIds = [];
  }

  enable() {
    this._configManager.addConfigChangeListener(this._configChangeCallback);
    this._applyBindings();
  }

  disable() {
    this._removeKeybindings();
    this._restoreConflicts();
    this._configManager.removeConfigChangeListener(this._configChangeCallback);
    this._configManager.destroy();
  }

  reload() {
    this._removeKeybindings();
    this._restoreConflicts();
    this._applyBindings();
  }

  _onConfigChanged(changeType) {
    this._logger.verboseLog(`Config changed: ${changeType}`);
    if (changeType === "settings-changed") this.reload();
  }

  _applyBindings() {
    const config = this._configManager.getConfig();
    const keybindings = config?.keybindings ?? {};
    const keybindingFlags = Number.isInteger(config?.keybindingFlags)
      ? config.keybindingFlags
      : Meta.KeyBindingFlags.NONE;
    const actionMode = Number.isInteger(config?.actionMode)
      ? config.actionMode
      : Shell.ActionMode.ALL;
    const shouldOverride = this._settings.get_boolean(
      "override-conflicting-bindings",
    );
    const commandsToBind = [];

    for (const command of this._commands) {
      const accelerators = keybindings[command.id] ?? [];
      if (!Array.isArray(accelerators) || accelerators.length === 0) continue;

      const conflicts = accelerators.flatMap((accel) =>
        findConflictingKeybindings(
          this._conflictIndex,
          accel,
          acceleratorsEqual,
        ).map((match) => ({ accel, ...match }))
      );
      if (conflicts.length > 0 && !shouldOverride) {
        this._logger.verboseLog(
          `Skipped binding ${command.id} - conflicts with existing bindings`,
        );
        continue;
      }
      commandsToBind.push({ command, accelerators, conflicts });
    }

    const conflictingAccelerators = commandsToBind.flatMap(({ conflicts }) =>
      conflicts.map(({ accel }) => accel)
    );
    if (shouldOverride && conflictingAccelerators.length > 0) {
      this._overrideLease = new KeybindingOverrideLease(
        this._conflictIndex,
        acceleratorsEqual,
      );
      const changes = this._overrideLease.suppressMatching((binding) =>
        conflictingAccelerators.some((accelerator) =>
          acceleratorsEqual(binding, accelerator)
        )
      );
      for (const { schemaId, key, bindings } of changes) {
        this._logger.verboseLog(
          `Removed conflicting keybinds ${schemaId}::${key} (${
            bindings.join(", ")
          })`,
        );
      }
    }

    for (const { command, accelerators } of commandsToBind) {
      const handler = (...args) => {
        this._logger.log(`Called keybind ${command.id}`);
        return command.handler(
          this._configManager.getConfig(),
          this._logger,
          ...args,
        );
      };

      let action;
      try {
        action = Main.wm.addKeybinding(
          command.id,
          this._settings,
          keybindingFlags,
          actionMode,
          handler,
        );
      } catch (error) {
        this._logger.error(`Failed to bind keybind ${command.id}`, error);
        this._rollbackBindings();
        return;
      }
      if (action === Meta.KeyBindingAction.NONE) {
        this._logger.error(`Failed to bind keybind ${command.id}`);
        this._rollbackBindings();
        return;
      }
      this._boundCommandIds.push(command.id);
      this._logger.verboseLog(
        `Bound keybind ${command.id} to ${accelerators.join(", ")}`,
      );
    }
  }

  _removeKeybindings() {
    for (const commandId of this._boundCommandIds) {
      Main.wm.removeKeybinding(commandId);
    }
    this._boundCommandIds = [];
  }

  _restoreConflicts() {
    for (const { schemaId, key } of this._overrideLease?.restore() ?? []) {
      this._logger.verboseLog(`Restored keybind ${schemaId}::${key}`);
    }
    this._overrideLease = null;
  }

  _rollbackBindings() {
    this._removeKeybindings();
    this._restoreConflicts();
  }
}
