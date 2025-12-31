// config.js

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import { COMMANDS } from "./cmds.js";
import {
	ACTION_MODE_NAMES,
	KEYBINDING_FLAG_NAMES,
	DEFAULT_WIN_OPTSIZE_CONFIG,
} from "./common.js";

const KEYBINDING_KEYS = COMMANDS.map((command) => command.key);
const ACCELERATOR_PATTERN = /^(?:<[^>]+>)*[^<>]+$/;

const META_KEYBINDING_FLAGS = Object.fromEntries(
	KEYBINDING_FLAG_NAMES.map((name) => [name, Meta.KeyBindingFlags[name]]),
);
const SHELL_ACTION_MODES = Object.fromEntries(
	ACTION_MODE_NAMES.map((name) => [name, Shell.ActionMode[name]]),
);

export class ConfigManager {
	constructor(settings, logger) {
		// Use the settings object provided by Extension.getSettings()
		this._settings = settings;
		this._logger = logger;

		// Callbacks for config changes
		this._configChangeCallbacks = new Set();

		// Connect to settings changes
		this._settings.connectObject(
			"changed",
			(_settings, key) => {
				this._onSettingChanged(key);
			},
			this,
		);

		// Initialize config from gsettings or set defaults
		this.appConfigFallback = {};
		this._init();
		// Check for first run and save defaults if needed (after defaults are loaded)
		this._ensureDefaultsSaved();
	}

	_init() {
		const keybindings = {};
		for (const key of KEYBINDING_KEYS) {
			const rawBindings = this._settings.get_strv(key);
			keybindings[key] = this._sanitizeKeybindings(key, rawBindings);
		}

		const keybindingFlags = this._parseEnumValue(
			this._settings.get_string("keybinding-flags"),
			META_KEYBINDING_FLAGS,
			Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
		);
		const actionMode = this._parseEnumValue(
			this._settings.get_string("keybinding-actionmode"),
			SHELL_ACTION_MODES,
			Shell.ActionMode.NORMAL,
		);
		const winOptsize = this._parseWinOptsizeConfig(
			this._settings.get_string("win-optsize-config"),
		);

		this.config = {
			keybindings,
			keybindingFlags,
			actionMode,
			winOptsize,
		};
	}

	_sanitizeKeybindings(key, bindings) {
		if (!Array.isArray(bindings)) {
			return [];
		}

		let changed = false;
		const cleaned = [];
		for (const accel of bindings) {
			if (typeof accel !== "string") {
				changed = true;
				continue;
			}
			const trimmed = accel.trim();
			if (!trimmed || !ACCELERATOR_PATTERN.test(trimmed)) {
				changed = true;
				continue;
			}
			cleaned.push(trimmed);
		}

		if (changed) {
			this._settings.set_strv(key, cleaned);
			this._logger.log(`Sanitized invalid keybindings for ${key}`);
		}

		return cleaned;
	}

	_ensureDefaultsSaved() {
		for (const key of KEYBINDING_KEYS) {
			const userValue = this._settings.get_user_value(key);
			if (!userValue) {
				const defaultValue = this._settings.get_default_value(key);
				if (defaultValue) {
					this._settings.set_value(key, defaultValue);
				}
			}
		}
		this._ensureDefaultSaved("keybinding-flags");
		this._ensureDefaultSaved("keybinding-actionmode");
		this._ensureDefaultSaved("win-optsize-config");
		this._logger.log("Default configuration values saved to dconf");
	}

	_ensureDefaultSaved(key) {
		const userValue = this._settings.get_user_value(key);
		if (userValue) {
			return;
		}
		const defaultValue = this._settings.get_default_value(key);
		if (defaultValue) {
			this._settings.set_value(key, defaultValue);
		}
	}

	_parseEnumValue(value, map, fallback) {
		if (typeof value !== "string") {
			return fallback;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			return fallback;
		}
		if (/^\d+$/.test(trimmed)) {
			return Number.parseInt(trimmed, 10);
		}
		const normalized = trimmed.toUpperCase();
		return map[normalized] ?? fallback;
	}

	_parseWinOptsizeConfig(rawValue) {
		if (typeof rawValue !== "string") {
			return DEFAULT_WIN_OPTSIZE_CONFIG;
		}
		const trimmed = rawValue.trim();
		if (!trimmed) {
			return DEFAULT_WIN_OPTSIZE_CONFIG;
		}
		try {
			const parsed = JSON.parse(trimmed);
			if (!parsed || typeof parsed !== "object") {
				return DEFAULT_WIN_OPTSIZE_CONFIG;
			}
			return parsed;
		} catch (_error) {
			return DEFAULT_WIN_OPTSIZE_CONFIG;
		}
	}

	// --- GSettings change handling -----------------------------------------

	_onSettingChanged(_key) {
		this._init();
		this._notifyConfigChange("settings-changed");
	}

	_notifyConfigChange(changeType) {
		for (const callback of this._configChangeCallbacks) {
			try {
				callback(changeType);
			} catch (error) {
				this._logger.error("Error in config change callback:", error);
			}
		}
	}

	// --- Public API for dynamic updates ------------------------------------
	addConfigChangeListener(callback) {
		this._configChangeCallbacks.add(callback);
	}

	removeConfigChangeListener(callback) {
		this._configChangeCallbacks.delete(callback);
	}

	getConfig() {
		return this.config;
	}

	destroy() {
		this._settings.disconnectObject(this);
		this._configChangeCallbacks.clear();
	}
}
