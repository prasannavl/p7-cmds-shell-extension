// keybindmanager.js

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { COMMANDS } from "./cmds.js";
import { ConfigManager } from "./config.js";

const COMMON_KEYBINDING_SCHEMAS = [
	"org.gnome.desktop.wm.keybindings",
	"org.gnome.shell.keybindings",
	"org.gnome.mutter.keybindings",
	"org.gnome.mutter.wayland.keybindings",
	"org.gnome.settings-daemon.plugins.media-keys",
];

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
		this._enabled = false;
	}

	enable() {
		if (this._enabled) {
			return;
		}
		this._enabled = true;
		this._configManager.addConfigChangeListener(this._configChangeCallback);
		this._applyBindings();
	}

	disable() {
		if (!this._enabled) {
			return;
		}
		this._removeKeybindings();
		this._restoreConflicts();
		this._configManager.removeConfigChangeListener(this._configChangeCallback);
		this._configManager.destroy();
		this._enabled = false;
	}

	reload() {
		if (!this._enabled) {
			return;
		}
		this._removeKeybindings();
		this._restoreConflicts();
		this._applyBindings();
	}

	_onConfigChanged(changeType) {
		this._logger.log(`Config changed: ${changeType}`);
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
			const accelerators = keybindings[command.key] ?? [];
			if (!Array.isArray(accelerators) || accelerators.length === 0) {
				continue;
			}

			for (const accel of accelerators) {
				this._removeConflictingBindings(accel);
			}

			const handler = (...args) => {
				this._logger.log(`Called keybind ${command.key}`);
				const currentConfig = this._configManager.getConfig();
				return command.handler(currentConfig, this._logger, ...args);
			};

			Main.wm.addKeybinding(
				command.key,
				this._settings,
				keybindingFlags,
				actionMode,
				handler,
			);
			this._logger.log(
				`Bound keybind ${command.key} to ${accelerators.join(", ")}`,
			);
		}
	}

	_removeKeybindings() {
		for (const command of COMMANDS) {
			Main.wm.removeKeybinding(command.key);
		}
	}

	_removeConflictingBindings(accel) {
		for (const settings of this._conflictSettings) {
			const schemaId = settings.schema_id;
			for (const key of settings.settings_schema.list_keys()) {
				const keyInfo = settings.settings_schema.get_key(key);
				const valueType = keyInfo?.get_value_type?.();
				if (!valueType || !valueType.equal(new GLib.VariantType("as"))) {
					continue;
				}
				const current = settings.get_strv(key);
				if (!current) {
					continue;
				}
				if (!current.includes(accel)) {
					continue;
				}

				this._rememberReplaced(schemaId, key, current);
				settings.set_strv(key, []);
				this._logger.log(
					`Removed conflicting keybind ${schemaId}::${key} (${accel})`,
				);
			}
		}
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
				this._logger.log(`Restored keybind ${schemaId}::${key}`);
			}
		}
		this._replacedBindings.clear();
	}
}
