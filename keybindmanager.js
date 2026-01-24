// keybindmanager.js

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { COMMON_KEYBINDING_SCHEMAS } from "./common.js";
import { COMMANDS } from "./cmds.js";
import { ConfigManager } from "./config.js";

export class KeyBindManager {
  constructor(settings, logger) {
    this._settings = settings;
    this._logger = logger;
    this._configManager = new ConfigManager(settings, logger);
    this._configChangeCallback = (x) => this._onConfigChanged(x);
    this._replacedBindings = new Map();
    this._conflictSettings = COMMON_KEYBINDING_SCHEMAS.map(
      (schema) => new Gio.Settings({ schema }),
    );
    this._conflictKeyNames = new Map(
      this._conflictSettings.map((settings) => {
        const keys = settings.settings_schema.list_keys().filter((key) => {
          const keyInfo = settings.settings_schema.get_key(key);
          const valueType = keyInfo?.get_value_type?.();
          return valueType?.equal(new GLib.VariantType("as"));
        });
        return [settings.schema_id, keys];
      }),
    );
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
    if (changeType === "settings-changed") {
      this.reload();
    }
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

    for (const command of COMMANDS) {
      const accelerators = keybindings[command.id] ?? [];
      if (!Array.isArray(accelerators) || accelerators.length === 0) {
        continue;
      }

      let hasConflict = false;
      for (const accel of accelerators) {
        const canBind = this._removeConflictingBindings(accel);
        if (!canBind) {
          hasConflict = true;
        }
      }

      if (hasConflict) {
        // We skip the command entirely if there's a conflict, since
        // we pass this._settings to addKeybinding, or we'll need an
        // mem overlay of that to pass only the non conflicts bindings.
        // We choose simplicity instead for now.
        this._logger.verboseLog(
          `Skipped binding ${command.id} - conflicts with existing bindings`,
        );
        continue;
      }

      const handler = (...args) => {
        this._logger.log(`Called keybind ${command.id}`);
        const currentConfig = this._configManager.getConfig();
        return command.handler(currentConfig, this._logger, ...args);
      };

      Main.wm.addKeybinding(
        command.id,
        this._settings,
        keybindingFlags,
        actionMode,
        handler,
      );
      this._logger.verboseLog(
        `Bound keybind ${command.id} to ${accelerators.join(", ")}`,
      );
    }
  }

  _removeKeybindings() {
    for (const command of COMMANDS) {
      Main.wm.removeKeybinding(command.id);
    }
  }

  _removeConflictingBindings(accel) {
    const shouldOverride = this._settings.get_boolean(
      "override-conflicting-bindings",
    );
    let hasConflict = false;

    for (const settings of this._conflictSettings) {
      const schemaId = settings.schema_id;
      const keys = this._conflictKeyNames.get(schemaId) ?? [];
      for (const key of keys) {
        const current = settings.get_strv(key);
        if (!current) {
          continue;
        }
        if (!current.includes(accel)) {
          continue;
        }

        hasConflict = true;

        if (shouldOverride) {
          this._rememberReplaced(schemaId, key, current);
          settings.set_strv(key, []);
          this._logger.verboseLog(
            `Removed conflicting keybind ${schemaId}::${key} (${accel})`,
          );
        } else {
          this._logger.verboseLog(
            `Skipping conflicting keybind ${schemaId}::${key} (${accel}) - override disabled`,
          );
        }
      }
    }

    return !hasConflict || shouldOverride;
  }

  _rememberReplaced(schemaId, key, value) {
    if (!this._replacedBindings.has(schemaId)) {
      this._replacedBindings.set(schemaId, new Map());
    }
    const schemaMap = this._replacedBindings.get(schemaId);
    if (!schemaMap.has(key)) {
      schemaMap.set(key, value);
    }
  }

  _restoreConflicts() {
    for (const [schemaId, keys] of this._replacedBindings) {
      const settings = this._conflictSettings.find(
        (item) => item.schema_id === schemaId,
      );
      if (!settings) {
        continue;
      }
      for (const [key, value] of keys) {
        settings.set_strv(key, value);
        this._logger.verboseLog(`Restored keybind ${schemaId}::${key}`);
      }
    }
    this._replacedBindings.clear();
  }
}
