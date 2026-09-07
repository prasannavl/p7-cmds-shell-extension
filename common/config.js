export const KEYBINDING_FLAG_NAMES = Object.freeze([
  "IGNORE_AUTOREPEAT",
  "NONE",
  "PER_WINDOW",
  "BUILTIN",
  "IS_REVERSED",
  "NON_MASKABLE",
]);

export const ACTION_MODE_NAMES = Object.freeze([
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
]);

export const DEFAULT_WIN_OPTSIZE_CONFIG = {
  aspectBasedInversion: false,
  scales: [[0.95, 0.9]],
  breakpoints: [
    { maxWidth: 1920, scales: [[0.95, 0.9]] },
    { maxWidth: 2560, scales: [[0.95, 0.9]] },
    { maxWidth: 3840, scales: [[0.55, 0.9]] },
  ],
};

export const DEFAULT_KEYBINDING_FLAGS = "IGNORE_AUTOREPEAT";
export const DEFAULT_KEYBINDING_ACTION_MODE = "NORMAL";

export const COMMAND_DEFINITIONS = Object.freeze([
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
].map((definition) => Object.freeze(definition)));

export const CONFIG_REVISION = 2;
export const FULL_CONFIG_FORMAT_VERSION = 1;
export const MAX_FULL_CONFIG_FILE_SIZE = 256 * 1024;
export const MIN_MOUSE_RESIZE_BORDER_SIZE = 1;
export const MAX_MOUSE_RESIZE_BORDER_SIZE = 20;

export const SETTING_KEYS = Object.freeze({
  configVersion: "config-version",
  keybindingFlags: "keybinding-flags",
  keybindingActionMode: "keybinding-actionmode",
  overrideConflictingBindings: "override-conflicting-bindings",
  verboseLogging: "verbose-logging",
  winOptsizeConfig: "win-optsize-config",
  winMouseResizeBorderColor: "win-mouseresize-border-color",
  winMouseResizeBackgroundColor: "win-mouseresize-background-color",
  winMouseResizeBorderSize: "win-mouseresize-border-size",
});

export const COMMAND_SETTING_KEYS = Object.freeze(
  COMMAND_DEFINITIONS.map((command) => command.id),
);
export const ALL_SETTING_KEYS = Object.freeze([
  ...COMMAND_SETTING_KEYS,
  ...Object.values(SETTING_KEYS),
]);
export const USER_SETTING_KEYS = Object.freeze(
  ALL_SETTING_KEYS.filter((key) => key !== SETTING_KEYS.configVersion),
);

export const KEYBINDING_SETTING_KEYS = Object.freeze([
  ...COMMAND_SETTING_KEYS,
  SETTING_KEYS.keybindingFlags,
  SETTING_KEYS.keybindingActionMode,
  SETTING_KEYS.overrideConflictingBindings,
]);

const ACCELERATOR_PATTERN = /^((?:<[^<>]+>)*)((?:[^<>])+)$/;
const ACCELERATOR_MODIFIERS = new Map([
  ["shift", "Shift"],
  ["shft", "Shift"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["ctl", "Control"],
  ["primary", "Control"],
  ["alt", "Alt"],
  ["mod1", "Alt"],
  ["super", "Super"],
  ["hyper", "Hyper"],
  ["meta", "Meta"],
  ["mod2", "Mod2"],
  ["mod3", "Mod3"],
  ["mod4", "Mod4"],
  ["mod5", "Mod5"],
]);
const ACCELERATOR_MODIFIER_ORDER = [
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "Super",
  "Hyper",
  "Mod2",
  "Mod3",
  "Mod4",
  "Mod5",
];
// Mutter parses Alt as Mod1, but resolves Super/Meta/Hyper from the active
// keymap. Keep those virtual names distinct from every raw ModN name.
// Mutter removes Mod2 (normally Num Lock) from every input event.
const UNUSABLE_ACCELERATOR_MODIFIERS = new Set(["Mod2"]);

export function cloneWinOptsizeConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_WIN_OPTSIZE_CONFIG));
}

export function normalizeWinOptsizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return invalid("Config must be an object.");
  }
  const config = { ...cloneWinOptsizeConfig(), ...rawConfig };

  const scaleError = getScalesError(config.scales, "Scales");
  if (scaleError) return invalid(scaleError);

  if (!Array.isArray(config.breakpoints)) {
    return invalid("Breakpoints must be an array.");
  }
  for (let index = 0; index < config.breakpoints.length; index += 1) {
    const breakpoint = config.breakpoints[index];
    if (
      !breakpoint ||
      typeof breakpoint !== "object" ||
      Array.isArray(breakpoint)
    ) {
      return invalid(`Invalid breakpoint at index ${index}.`);
    }
    if (!isPositiveNumber(breakpoint.maxWidth)) {
      return invalid(`Breakpoint ${index} must define a positive maxWidth.`);
    }
    if (
      "maxHeight" in breakpoint &&
      breakpoint.maxHeight !== null &&
      !isPositiveNumber(breakpoint.maxHeight)
    ) {
      return invalid(`Breakpoint ${index} has invalid maxHeight.`);
    }
    if ("scales" in breakpoint) {
      const error = getScalesError(
        breakpoint.scales,
        `Breakpoint ${index} scales`,
      );
      if (error) return invalid(error);
    }
  }

  if (typeof config.aspectBasedInversion !== "boolean") {
    return invalid("aspectBasedInversion must be boolean.");
  }

  return valid({
    scales: config.scales,
    breakpoints: config.breakpoints,
    aspectBasedInversion: config.aspectBasedInversion,
  });
}

export function parseWinOptsizeConfig(rawValue) {
  if (!rawValue.trim()) {
    return invalid("JSON is empty.");
  }
  try {
    return normalizeWinOptsizeConfig(JSON.parse(rawValue));
  } catch (error) {
    return invalid(error.message);
  }
}

export function sanitizeCssColor(value, fallback) {
  const color = value.trim();
  // St validates color syntax; only prevent a value escaping its declaration.
  return color && !/[;{}\r\n]/.test(color) ? color : fallback;
}

export function normalizeFullConfig(rawConfig, normalizeKey = (key) => key) {
  const error = getObjectShapeError(rawConfig, [
    "formatVersion",
    "keybindings",
    "keybindingFlags",
    "keybindingActionMode",
    "overrideConflictingBindings",
    "verboseLogging",
    "winOptsize",
    "winMouseResize",
  ], "Full config");
  if (error) return invalid(error);
  if (rawConfig.formatVersion !== FULL_CONFIG_FORMAT_VERSION) {
    return invalid(
      `Unsupported full config format: ${rawConfig.formatVersion}`,
    );
  }

  const keybindingsError = getObjectShapeError(
    rawConfig.keybindings,
    COMMAND_SETTING_KEYS,
    "Keybindings",
  );
  if (keybindingsError) return invalid(keybindingsError);
  const keybindings = {};
  for (const key of COMMAND_SETTING_KEYS) {
    const bindings = rawConfig.keybindings[key];
    if (
      !Array.isArray(bindings) ||
      bindings.some((value) => typeof value !== "string")
    ) {
      return invalid(`Keybindings.${key} must be an array of strings.`);
    }
    const cleaned = sanitizeKeybindings(bindings, normalizeKey);
    if (cleaned.length !== bindings.length) {
      return invalid(
        `Keybindings.${key} contains an invalid or duplicate shortcut.`,
      );
    }
    keybindings[key] = cleaned;
  }

  const keybindingFlags = normalizeEnumName(
    rawConfig.keybindingFlags,
    KEYBINDING_FLAG_NAMES,
  );
  if (keybindingFlags === null) {
    return invalid("keybindingFlags must be a known name or numeric value.");
  }
  const keybindingActionMode = normalizeEnumName(
    rawConfig.keybindingActionMode,
    ACTION_MODE_NAMES,
  );
  if (keybindingActionMode === null) {
    return invalid(
      "keybindingActionMode must be a known name or numeric value.",
    );
  }
  for (const key of ["overrideConflictingBindings", "verboseLogging"]) {
    if (typeof rawConfig[key] !== "boolean") {
      return invalid(`${key} must be boolean.`);
    }
  }

  const winOptsize = normalizeWinOptsizeConfig(rawConfig.winOptsize);
  if (!winOptsize.ok) return invalid(`winOptsize: ${winOptsize.error}`);
  const resizeError = getObjectShapeError(rawConfig.winMouseResize, [
    "borderColor",
    "backgroundColor",
    "borderSize",
  ], "winMouseResize");
  if (resizeError) return invalid(resizeError);
  const borderColor = normalizeConfigColor(
    rawConfig.winMouseResize.borderColor,
    "winMouseResize.borderColor",
  );
  if (!borderColor.ok) return borderColor;
  const backgroundColor = normalizeConfigColor(
    rawConfig.winMouseResize.backgroundColor,
    "winMouseResize.backgroundColor",
  );
  if (!backgroundColor.ok) return backgroundColor;
  const borderSize = rawConfig.winMouseResize.borderSize;
  if (
    !Number.isInteger(borderSize) ||
    borderSize < MIN_MOUSE_RESIZE_BORDER_SIZE ||
    borderSize > MAX_MOUSE_RESIZE_BORDER_SIZE
  ) {
    return invalid(
      `winMouseResize.borderSize must be an integer from ${MIN_MOUSE_RESIZE_BORDER_SIZE} to ${MAX_MOUSE_RESIZE_BORDER_SIZE}.`,
    );
  }

  return valid({
    formatVersion: FULL_CONFIG_FORMAT_VERSION,
    keybindings,
    keybindingFlags,
    keybindingActionMode,
    overrideConflictingBindings: rawConfig.overrideConflictingBindings,
    verboseLogging: rawConfig.verboseLogging,
    winOptsize: winOptsize.value,
    winMouseResize: {
      borderColor: borderColor.value,
      backgroundColor: backgroundColor.value,
      borderSize,
    },
  });
}

const valid = (value) => ({ ok: true, value, error: null });
const invalid = (error) => ({ ok: false, value: null, error });

export function sanitizeKeybindings(bindings, normalizeKey = (key) => key) {
  const seen = new Set();
  const cleaned = [];
  for (const binding of bindings) {
    const value = binding.trim();
    const canonical = normalizeAccelerator(value, normalizeKey);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    cleaned.push(value);
  }
  return cleaned;
}

export function acceleratorsEqual(left, right, normalizeKey = (key) => key) {
  const normalizedLeft = parseAccelerator(left, normalizeKey)?.canonical;
  return (
    normalizedLeft !== undefined &&
    normalizedLeft === parseAccelerator(right, normalizeKey)?.canonical
  );
}

function normalizeAccelerator(value, normalizeKey = (key) => key) {
  const parsed = parseAccelerator(value, normalizeKey);
  return parsed?.valid ? parsed.canonical : null;
}

function parseAccelerator(value, normalizeKey) {
  if (!value) return null;
  const match = ACCELERATOR_PATTERN.exec(value);
  if (!match) return null;

  const modifiers = new Set();
  let valid = true;
  for (const modifier of match[1].matchAll(/<([^<>]+)>/g)) {
    const canonical = ACCELERATOR_MODIFIERS.get(modifier[1].toLowerCase());
    if (!canonical) {
      // Mutter ignores unknown tags. Retain its effective value for comparing
      // external bindings, but reject the spelling from extension settings.
      valid = false;
      continue;
    }
    modifiers.add(canonical);
    if (UNUSABLE_ACCELERATOR_MODIFIERS.has(canonical)) valid = false;
  }
  const key = normalizeKey(match[2]);
  if (!key) return null;
  const canonical =
    ACCELERATOR_MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
      .map((modifier) => `<${modifier}>`).join("") + key;
  return { canonical, valid };
}

export function createAcceleratorKeyNormalizer(keysyms, lower) {
  const values = new Map(
    Object.keys(keysyms).flatMap((name) =>
      name.startsWith("KEY_")
        ? [[name.slice(4).toLowerCase(), keysyms[name]]]
        : []
    ),
  );
  const lookup = (name) => values.get(name.toLowerCase());

  return (key) => {
    let keyval = lookup(key);
    if (keyval === undefined) {
      keyval = lookup(
        key.toLowerCase().startsWith("xf86") ? key.slice(4) : `XF86${key}`,
      );
    }
    return keyval === undefined || keyval === keysyms.KEY_VoidSymbol
      ? null
      : String(lower(keyval));
  };
}

export function isModifiedArrowBinding(binding) {
  const normalized = parseAccelerator(binding, (key) => key)?.canonical;
  return Boolean(
    normalized?.startsWith("<") &&
      /(?:^|>)(Left|Right|Up|Down|KP_Left|KP_Right|KP_Up|KP_Down)$/i.test(
        normalized,
      ),
  );
}

export function parseEnumValue(value, values, fallback) {
  const normalized = value.trim();
  if (!normalized) return fallback;
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  return values[normalized.toUpperCase()] ?? fallback;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getScalesError(scales, label) {
  if (scales === undefined) return null;
  if (!Array.isArray(scales)) return `${label} must be an array.`;
  for (let index = 0; index < scales.length; index += 1) {
    const scale = scales[index];
    if (!Array.isArray(scale) || scale.length !== 2) {
      return `${label} has invalid scale at index ${index}.`;
    }
    if (!isPositiveNumber(scale[0])) {
      return `${label} has invalid scale at index ${index}.`;
    }
    if (scale[1] !== null && !isPositiveNumber(scale[1])) {
      return `${label} has invalid scale at index ${index}.`;
    }
  }
  return null;
}

function getObjectShapeError(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${label} must be an object.`;
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) return `${label} contains unknown field: ${key}.`;
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) return `${label} is missing field: ${key}.`;
  }
  return null;
}

function normalizeEnumName(value, names) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return normalized;
  const name = normalized.toUpperCase();
  return names.includes(name) ? name : null;
}

function normalizeConfigColor(value, label) {
  if (typeof value !== "string") return invalid(`${label} must be a string.`);
  const color = sanitizeCssColor(value, "");
  return color ? valid(color) : invalid(`${label} must be a CSS color value.`);
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
    this._defaultKeybindingFlags =
      runtime.keybindingFlags[DEFAULT_KEYBINDING_FLAGS];
    this._defaultActionMode =
      runtime.actionModes[DEFAULT_KEYBINDING_ACTION_MODE];
    this._listeners = new Set();
    this._writing = false;

    this._load();
    this._write(() => this._ensureDefaultsSaved());
    this._settings.connectObject(
      "changed",
      (_settings, key) => this._onChanged(key),
      this,
    );
  }

  _load() {
    this._write(() => this._ensureConfigRevision());
    const parsedWinOptsize = parseWinOptsizeConfig(
      this._settings.get_string(SETTING_KEYS.winOptsizeConfig),
    );
    const cssColor = (key) =>
      sanitizeCssColor(
        this._settings.get_string(key),
        this._settings.get_default_value(key).deepUnpack(),
      );
    this.config = {
      configVersion: this._settings.get_int(SETTING_KEYS.configVersion),
      keybindings: Object.fromEntries(
        COMMAND_SETTING_KEYS.map((key) => [
          key,
          this._sanitizeKeybindings(key, this._settings.get_strv(key)),
        ]),
      ),
      keybindingFlags: parseEnumValue(
        this._settings.get_string(SETTING_KEYS.keybindingFlags),
        this._keybindingFlags,
        this._defaultKeybindingFlags,
      ),
      actionMode: parseEnumValue(
        this._settings.get_string(SETTING_KEYS.keybindingActionMode),
        this._actionModes,
        this._defaultActionMode,
      ),
      overrideConflictingBindings: this._settings.get_boolean(
        SETTING_KEYS.overrideConflictingBindings,
      ),
      winOptsize: parsedWinOptsize.value ?? cloneWinOptsizeConfig(),
      winMouseResize: {
        borderColor: cssColor(SETTING_KEYS.winMouseResizeBorderColor),
        backgroundColor: cssColor(SETTING_KEYS.winMouseResizeBackgroundColor),
        borderSize: this._settings.get_int(
          SETTING_KEYS.winMouseResizeBorderSize,
        ),
      },
    };
    if (!parsedWinOptsize.ok) {
      this._logger.verboseLog(
        `Invalid win-optsize-config, using defaults: ${parsedWinOptsize.error}`,
      );
    }
  }

  _sanitizeKeybindings(key, bindings) {
    const cleaned = sanitizeKeybindings(
      bindings,
      this._normalizeAcceleratorKey,
    );
    if (JSON.stringify(cleaned) !== JSON.stringify(bindings)) {
      this._write(() => this._settings.set_strv(key, cleaned));
      this._logger.verboseLog(`Sanitized invalid keybindings for ${key}`);
    }
    return cleaned;
  }

  _ensureDefaultsSaved() {
    let saved = false;
    for (const key of ALL_SETTING_KEYS) {
      if (this._settings.get_user_value(key)) continue;
      const value = this._settings.get_default_value(key);
      this._settings.set_value(key, value);
      saved = true;
    }
    if (saved) {
      this._logger.verboseLog("Default configuration values saved to dconf");
    }
  }

  _ensureConfigRevision() {
    const configVersion = this._settings.get_int(SETTING_KEYS.configVersion);
    if (configVersion >= CONFIG_REVISION) return;
    this._settings.reset(SETTING_KEYS.winOptsizeConfig);
    this._logger.log(
      `Reset win-optsize-config for config revision ${CONFIG_REVISION}`,
    );
    this._settings.set_int(SETTING_KEYS.configVersion, CONFIG_REVISION);
  }

  _onChanged(key) {
    if (this._writing) return;
    this._load();
    for (const listener of this._listeners) {
      try {
        listener(key);
      } catch (error) {
        this._logger.error("Error in config change callback:", error);
      }
    }
  }

  _write(callback) {
    const writing = this._writing;
    this._writing = true;
    try {
      return callback();
    } finally {
      this._writing = writing;
    }
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  destroy() {
    this._settings.disconnectObject(this);
    this._listeners.clear();
  }
}

function enumValues(names, values) {
  return Object.fromEntries(names.map((name) => [name, values[name]]));
}
