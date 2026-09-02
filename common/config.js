export const KEYBINDING_FLAG_NAMES = [
  "IGNORE_AUTOREPEAT",
  "NONE",
  "PER_WINDOW",
  "BUILTIN",
  "IS_REVERSED",
  "NON_MASKABLE",
];

export const ACTION_MODE_NAMES = [
  "NORMAL",
  "ALL",
  "NONE",
  "OVERVIEW",
  "LOCK_SCREEN",
  "UNLOCK_SCREEN",
  "LOGIN_SCREEN",
  "SYSTEM_MODAL",
  "LOOKING_GLASS",
  "POPUP",
  "PANEL",
];

export const COMMON_KEYBINDING_SCHEMAS = [
  "org.gnome.desktop.wm.keybindings",
  "org.gnome.shell.keybindings",
  "org.gnome.mutter.keybindings",
  "org.gnome.mutter.wayland.keybindings",
  "org.gnome.settings-daemon.plugins.media-keys",
];

export const DEFAULT_WIN_OPTSIZE_CONFIG = {
  aspectBasedInversion: false,
  scales: [[0.95, 0.9]],
  breakpoints: [
    { maxWidth: 1920, scales: [[0.95, 0.9]] },
    { maxWidth: 2560, scales: [[0.95, 0.9]] },
    { maxWidth: 3840, scales: [[0.55, 0.9]] },
  ],
};

export const DEFAULT_INDICATOR_BORDER = 3;
export const DEFAULT_INDICATOR_BORDER_COLOR = "rgba(230, 105, 105, 0.8)";
export const DEFAULT_INDICATOR_BACKGROUND_COLOR = "rgba(70, 70, 70, 0.2)";

export const COMMAND_DEFINITIONS = [
  {
    id: "cmd-win-optsize",
    title: "cmd:win-optsize",
    icon: "window-maximize-symbolic",
    description:
      "Resize the focused window to a size based on the monitor work area and center it.",
  },
  {
    id: "cmd-win-mouseresize",
    title: "cmd:win-mouseresize",
    icon: "transform-move-symbolic",
    description:
      "Resize the focused window by moving the mouse beyond the window edges; press Esc or the keybinding again to stop.",
  },
];

export const CONFIG_REVISION = 2;

const KEYBINDING_KEYS = COMMAND_DEFINITIONS.map((command) => command.id);

const ACCELERATOR_PATTERN = /^((?:<[^<>]+>)*)((?:[^<>])+)$/;
const ACCELERATOR_MODIFIERS = new Map([
  ["shift", "Shift"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["primary", "Control"],
  ["alt", "Alt"],
  ["super", "Super"],
  ["hyper", "Hyper"],
  ["meta", "Meta"],
  ["mod1", "Mod1"],
  ["mod2", "Mod2"],
  ["mod3", "Mod3"],
  ["mod4", "Mod4"],
  ["mod5", "Mod5"],
  ["release", "Release"],
]);
const ACCELERATOR_MODIFIER_ORDER = [
  "Shift",
  "Control",
  "Alt",
  "Super",
  "Hyper",
  "Meta",
  "Mod1",
  "Mod2",
  "Mod3",
  "Mod4",
  "Mod5",
  "Release",
];

export function cloneWinOptsizeConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_WIN_OPTSIZE_CONFIG));
}

export function normalizeWinOptsizeConfig(rawConfig) {
  const defaults = cloneWinOptsizeConfig();
  const done = (value) => ({ ok: true, value, error: null });
  const fail = (error) => ({ ok: false, value: null, error });

  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return fail("Config must be an object.");
  }

  const scaleError = getScalesError(rawConfig.scales, "Scales");
  if ("scales" in rawConfig && scaleError) {
    return fail(scaleError);
  }
  const scales = "scales" in rawConfig ? rawConfig.scales : defaults.scales;

  if ("breakpoints" in rawConfig && !Array.isArray(rawConfig.breakpoints)) {
    return fail("Breakpoints must be an array.");
  }
  const breakpoints = "breakpoints" in rawConfig
    ? rawConfig.breakpoints
    : defaults.breakpoints;
  for (let index = 0; index < breakpoints.length; index += 1) {
    const breakpoint = breakpoints[index];
    if (
      !breakpoint || typeof breakpoint !== "object" || Array.isArray(breakpoint)
    ) {
      return fail(`Invalid breakpoint at index ${index}.`);
    }
    if (!isPositiveNumber(breakpoint.maxWidth)) {
      return fail(`Breakpoint ${index} must define a positive maxWidth.`);
    }
    if (
      "maxHeight" in breakpoint && breakpoint.maxHeight !== null &&
      !isPositiveNumber(breakpoint.maxHeight)
    ) {
      return fail(`Breakpoint ${index} has invalid maxHeight.`);
    }
    if ("scales" in breakpoint) {
      const error = getScalesError(
        breakpoint.scales,
        `Breakpoint ${index} scales`,
      );
      if (error) return fail(error);
    }
  }

  const aspectBasedInversion = "aspectBasedInversion" in rawConfig
    ? rawConfig.aspectBasedInversion
    : defaults.aspectBasedInversion;
  if (typeof aspectBasedInversion !== "boolean") {
    return fail("aspectBasedInversion must be boolean.");
  }

  return done({ scales, breakpoints, aspectBasedInversion });
}

export function parseWinOptsizeConfig(rawValue) {
  if (typeof rawValue !== "string") {
    return { ok: false, value: null, error: "Expected a JSON string." };
  }
  if (!rawValue.trim()) {
    return { ok: false, value: null, error: "JSON is empty." };
  }
  try {
    return normalizeWinOptsizeConfig(JSON.parse(rawValue));
  } catch (error) {
    return { ok: false, value: null, error: error.message };
  }
}

export function sanitizeKeybindings(bindings, normalizeKey = (key) => key) {
  if (!Array.isArray(bindings)) return [];

  const seen = new Set();
  const cleaned = [];
  for (const binding of bindings) {
    if (typeof binding !== "string") continue;
    const value = binding.trim();
    const canonical = normalizeAccelerator(value, normalizeKey);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    cleaned.push(value);
  }
  return cleaned;
}

export function isValidAccelerator(value, normalizeKey = (key) => key) {
  return normalizeAccelerator(value, normalizeKey) !== null;
}

export function acceleratorsEqual(
  left,
  right,
  normalizeKey = (key) => key,
) {
  const normalizedLeft = normalizeAccelerator(left, normalizeKey);
  return normalizedLeft !== null &&
    normalizedLeft === normalizeAccelerator(right, normalizeKey);
}

export function normalizeAccelerator(value, normalizeKey = (key) => key) {
  if (typeof value !== "string" || !value) return null;
  const match = ACCELERATOR_PATTERN.exec(value);
  if (!match) return null;

  const modifiers = new Set();
  for (const modifier of match[1].matchAll(/<([^<>]+)>/g)) {
    const canonical = ACCELERATOR_MODIFIERS.get(modifier[1].toLowerCase());
    if (!canonical) return null;
    modifiers.add(canonical);
  }
  const key = normalizeKey(match[2]);
  if (!key) return null;
  return ACCELERATOR_MODIFIER_ORDER
    .filter((modifier) => modifiers.has(modifier))
    .map((modifier) => `<${modifier}>`)
    .join("") + key;
}

export function isSuperArrowBinding(binding) {
  const normalized = normalizeAccelerator(binding);
  return Boolean(
    normalized?.includes("<Super>") &&
      /(?:^|>)(Left|Right|Up|Down|KP_Left|KP_Right|KP_Up|KP_Down)$/.test(
        normalized,
      ),
  );
}

export function resolveIndicatorConfig(config) {
  const values = config?.winMouseResize ?? {};
  return {
    colors: {
      borderColor: normalizeIndicatorColor(
        values.borderColor,
        DEFAULT_INDICATOR_BORDER_COLOR,
      ),
      backgroundColor: normalizeIndicatorColor(
        values.backgroundColor,
        DEFAULT_INDICATOR_BACKGROUND_COLOR,
      ),
    },
    borderSize: normalizeIndicatorBorderSize(values.borderSize),
  };
}

export function normalizeIndicatorBorderSize(value) {
  if (!Number.isFinite(value)) return DEFAULT_INDICATOR_BORDER;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : DEFAULT_INDICATOR_BORDER;
}

function normalizeIndicatorColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized || /[;{}\r\n]/.test(normalized)) return fallback;
  return /^(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([\d\s.,%+-]+\)|[a-zA-Z][a-zA-Z0-9-]*)$/
      .test(normalized)
    ? normalized
    : fallback;
}

export function parseEnumValue(value, values, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  return values[normalized.toUpperCase()] ?? fallback;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value) {
  return isNumber(value) && value > 0;
}

function getScalesError(scales, label) {
  if (scales === undefined) return null;
  if (!Array.isArray(scales)) return `${label} must be an array.`;
  for (let index = 0; index < scales.length; index += 1) {
    const scale = scales[index];
    if (!Array.isArray(scale) || scale.length === 0 || scale.length > 2) {
      return `${label} has invalid scale at index ${index}.`;
    }
    if (!isPositiveNumber(scale[0])) {
      return `${label} has invalid scale at index ${index}.`;
    }
    if (
      scale.length === 2 && scale[1] !== null &&
      !isPositiveNumber(scale[1])
    ) {
      return `${label} has invalid scale at index ${index}.`;
    }
  }
  return null;
}

export class ConfigManager {
  constructor(settings, logger, runtime) {
    this._settings = settings;
    this._logger = logger;
    this._normalizeAcceleratorKey = runtime.normalizeAcceleratorKey;
    this._keybindingFlags = enumValues(
      KEYBINDING_FLAG_NAMES,
      runtime.keybindingFlags,
    );
    this._actionModes = enumValues(ACTION_MODE_NAMES, runtime.actionModes);
    this._defaultKeybindingFlags = runtime.keybindingFlags.IGNORE_AUTOREPEAT;
    this._defaultActionMode = runtime.actionModes.NORMAL;
    this._configChangeCallbacks = new Set();

    this._ensureConfigRevision();
    this._settings.connectObject(
      "changed",
      (_settings, key) => this._onSettingChanged(key),
      this,
    );
    this._init();
    this._ensureDefaultsSaved();
  }

  _init() {
    const keybindings = {};
    for (const key of KEYBINDING_KEYS) {
      const rawBindings = this._settings.get_strv(key);
      keybindings[key] = this._sanitizeKeybindings(key, rawBindings);
    }

    const keybindingFlags = parseEnumValue(
      this._settings.get_string("keybinding-flags"),
      this._keybindingFlags,
      this._defaultKeybindingFlags,
    );
    const actionMode = parseEnumValue(
      this._settings.get_string("keybinding-actionmode"),
      this._actionModes,
      this._defaultActionMode,
    );
    const parsedWinOptsize = parseWinOptsizeConfig(
      this._settings.get_string("win-optsize-config"),
    );
    const winOptsize = parsedWinOptsize.value ?? cloneWinOptsizeConfig();
    const winMouseResize = {
      borderColor: this._settings.get_string("win-mouseresize-border-color"),
      backgroundColor: this._settings.get_string(
        "win-mouseresize-background-color",
      ),
      borderSize: this._settings.get_int("win-mouseresize-border-size"),
    };

    if (!parsedWinOptsize.ok) {
      this._logger.verboseLog(
        `Invalid win-optsize-config, using defaults: ${parsedWinOptsize.error}`,
      );
    }

    this.config = {
      keybindings,
      keybindingFlags,
      actionMode,
      winOptsize,
      winMouseResize,
    };
  }

  _sanitizeKeybindings(key, bindings) {
    const cleaned = sanitizeKeybindings(
      bindings,
      this._normalizeAcceleratorKey,
    );
    if (JSON.stringify(cleaned) !== JSON.stringify(bindings)) {
      this._settings.set_strv(key, cleaned);
      this._logger.verboseLog(`Sanitized invalid keybindings for ${key}`);
    }
    return cleaned;
  }

  _ensureDefaultsSaved() {
    const keys = [
      "config-version",
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
    if (this._settings.get_user_value(key)) return false;
    const defaultValue = this._settings.get_default_value(key);
    if (!defaultValue) return false;
    this._settings.set_value(key, defaultValue);
    return true;
  }

  _ensureConfigRevision() {
    const configVersion = this._settings.get_int("config-version");
    if (configVersion >= CONFIG_REVISION) return;
    this._settings.reset("win-optsize-config");
    this._logger.log(
      `Reset win-optsize-config for config revision ${CONFIG_REVISION}`,
    );
    this._settings.set_int("config-version", CONFIG_REVISION);
  }

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

function enumValues(names, values) {
  return Object.fromEntries(names.map((name) => [name, values[name]]));
}
