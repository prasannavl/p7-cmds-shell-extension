// config.js

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import { COMMANDS } from "./cmds.js";
import {
  ACTION_MODE_NAMES,
  KEYBINDING_FLAG_NAMES,
  parseWinOptsizeConfig,
} from "./common.js";

const KEYBINDING_KEYS = COMMANDS.map((command) => command.id);
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
    const winOptsize = parseWinOptsizeConfig(
      this._settings.get_string("win-optsize-config"),
    );
    const winMouseResize = {
      borderColor: this._settings.get_string("win-mouseresize-border-color"),
      backgroundColor: this._settings.get_string(
        "win-mouseresize-background-color",
      ),
      borderSize: this._settings.get_int("win-mouseresize-border-size"),
    };

    this.config = {
      keybindings,
      keybindingFlags,
      actionMode,
      winOptsize,
      winMouseResize,
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

    if (changed && !this._arraysEqual(bindings, cleaned)) {
      this._settings.set_strv(key, cleaned);
      this._logger.verboseLog(`Sanitized invalid keybindings for ${key}`);
    }

    return cleaned;
  }

  _arraysEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  _ensureDefaultsSaved() {
    const keys = [
      ...KEYBINDING_KEYS,
      "keybinding-flags",
      "keybinding-actionmode",
      "win-optsize-config",
      "win-mouseresize-border-color",
      "win-mouseresize-background-color",
      "win-mouseresize-border-size",
    ];
    let saved = false;
    for (const key of keys) {
      saved = this._ensureDefaultSaved(key) || saved;
    }
    if (saved) {
      this._logger.verboseLog("Default configuration values saved to dconf");
    }
  }

  _ensureDefaultSaved(key) {
    const userValue = this._settings.get_user_value(key);
    if (userValue) {
      return false;
    }
    const defaultValue = this._settings.get_default_value(key);
    if (defaultValue) {
      this._settings.set_value(key, defaultValue);
      return true;
    }
    return false;
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
