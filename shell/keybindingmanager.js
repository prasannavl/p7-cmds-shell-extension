import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { ConfigManager, KEYBINDING_SETTING_KEYS } from "../common/config.js";
import {
  createConflictKeybindingIndex,
  KeybindingOverrides,
} from "../common/keybindings.js";
import { acceleratorsEqual, normalizeAcceleratorKey } from "./compat.js";

export class KeybindingManager {
  constructor(
    settings,
    logger,
    commands,
    conflictIndex = createConflictKeybindingIndex(),
  ) {
    this._settings = settings;
    this._logger = logger;
    this._commands = commands;
    this._configManager = new ConfigManager(settings, logger, {
      keybindingFlags: Meta.KeyBindingFlags,
      actionModes: Shell.ActionMode,
      normalizeAcceleratorKey,
    });
    this._overrides = new KeybindingOverrides(
      conflictIndex,
      acceleratorsEqual,
    );
    this._bindingOverride = null;
    this._commandSuppressions = new Set();
    this._commandRuntime = Object.freeze({
      suppressKeybindings: (matches) => this._suppressKeybindings(matches),
    });
    this._boundCommandIds = [];
  }

  enable() {
    this._unsubscribe = this._configManager.subscribe((key) =>
      this._onConfigChanged(key)
    );
    this._applyBindings();
  }

  disable() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._removeKeybindings();
    this._bindingOverride = null;
    this._commandSuppressions.clear();
    this._logRestoration(this._overrides.clear());
    this._configManager.destroy();
  }

  get config() {
    return this._configManager.config;
  }

  reload() {
    this._clearBindings();
    this._applyBindings();
  }

  _onConfigChanged(key) {
    this._logger.verboseLog(`Config changed: ${key}`);
    if (KEYBINDING_SETTING_KEYS.includes(key)) this.reload();
  }

  _applyBindings() {
    const {
      keybindings,
      keybindingFlags,
      actionMode,
      overrideConflictingBindings,
    } = this.config;
    const commandsToBind = [];
    const claimedAccelerators = [];

    for (const command of this._commands) {
      const accelerators = keybindings[command.id];
      if (accelerators.length === 0) continue;

      if (this._isCommandSuppressed(accelerators)) {
        this._logger.verboseLog(`Temporarily suppressed keybind ${command.id}`);
        continue;
      }

      const duplicate = accelerators.find((accelerator) =>
        claimedAccelerators.some((claimed) =>
          acceleratorsEqual(accelerator, claimed)
        )
      );
      if (duplicate) {
        this._logger.error(
          `Skipped binding ${command.id} - ${duplicate} is already used by another command`,
        );
        continue;
      }

      const conflicts = accelerators.filter(
        (accelerator) => this._overrides.findConflicts(accelerator).length > 0,
      );
      if (conflicts.length > 0 && !overrideConflictingBindings) {
        this._logger.verboseLog(
          `Skipped binding ${command.id} - conflicts with existing bindings`,
        );
        continue;
      }
      commandsToBind.push({ command, accelerators, conflicts });
      claimedAccelerators.push(...accelerators);
    }

    const conflictingAccelerators = commandsToBind.flatMap(
      ({ conflicts }) => conflicts,
    );
    if (overrideConflictingBindings && conflictingAccelerators.length > 0) {
      this._bindingOverride = this._createOverride(
        (binding) =>
          conflictingAccelerators.some((accelerator) =>
            acceleratorsEqual(binding, accelerator)
          ),
        "Removed conflicting",
      );
      if (!this._bindingOverride) {
        this._clearBindings();
        return;
      }
    }

    for (const { command, accelerators } of commandsToBind) {
      let action;
      try {
        action = Main.wm.addKeybinding(
          command.id,
          this._settings,
          keybindingFlags,
          actionMode,
          (...args) => this._run(command, args),
        );
      } catch (error) {
        this._logger.error(`Failed to bind keybind ${command.id}`, error);
        this._clearBindings();
        return;
      }
      if (action === Meta.KeyBindingAction.NONE) {
        this._logger.error(`Failed to bind keybind ${command.id}`);
        this._clearBindings();
        return;
      }
      this._boundCommandIds.push(command.id);
      this._logger.verboseLog(
        `Bound keybind ${command.id} to ${accelerators.join(", ")}`,
      );
    }
  }

  _run(command, args) {
    this._logger.log(`Called keybind ${command.id}`);
    return command.handler(
      this.config,
      this._logger,
      this._commandRuntime,
      ...args,
    );
  }

  _removeKeybindings() {
    for (const commandId of this._boundCommandIds) {
      Main.wm.removeKeybinding(commandId);
    }
    this._boundCommandIds = [];
  }

  _logRestoration({ changes = [], failures = [] } = {}) {
    for (const { schemaId, key } of changes) {
      this._logger.verboseLog(`Restored keybind ${schemaId}::${key}`);
    }
    for (const { schemaId, key } of failures) {
      this._logger.error(`Failed to restore keybind ${schemaId}::${key}`);
    }
  }

  _clearBindings() {
    this._removeKeybindings();
    this._logRestoration(this._bindingOverride?.restore());
    this._bindingOverride = null;
  }

  _suppressKeybindings(matches) {
    const override = this._createOverride(matches, "Suppressed");
    if (!override) return null;
    this._commandSuppressions.add(override);
    if (this._unsubscribe && this._matchesCommandBindings(matches)) {
      this.reload();
    }

    return {
      restore: () => {
        if (!this._commandSuppressions.delete(override)) return [];
        const restored = override.restore();
        this._logRestoration(restored);
        if (this._unsubscribe && this._matchesCommandBindings(matches)) {
          this.reload();
        }
        return restored.changes;
      },
    };
  }

  _createOverride(matches, label) {
    const override = this._overrides.suppress(matches);
    for (const { schemaId, key, bindings } of override.changes) {
      this._logger.verboseLog(
        `${label} keybind ${schemaId}::${key} (${bindings.join(", ")})`,
      );
    }
    if (override.failures.length === 0) return override;
    for (const { schemaId, key } of override.failures) {
      this._logger.error(`Failed to suppress keybind ${schemaId}::${key}`);
    }
    this._logRestoration(override.restore());
    return null;
  }

  _isCommandSuppressed(accelerators) {
    return accelerators.some((accelerator) =>
      [...this._commandSuppressions].some(({ matches }) => matches(accelerator))
    );
  }

  _matchesCommandBindings(matches) {
    return this._commands.some(({ id }) =>
      this.config.keybindings[id].some(matches)
    );
  }
}
