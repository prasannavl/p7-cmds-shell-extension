import {
  ALL_SETTING_KEYS,
  COMMAND_SETTING_KEYS,
  CONFIG_REVISION,
  FULL_CONFIG_FORMAT_VERSION,
  normalizeFullConfig,
  parseWinOptsizeConfig,
  SETTING_KEYS,
} from "../common/config.js";

export function readFullConfig(settings, normalizeKey) {
  const winOptsize = parseWinOptsizeConfig(
    settings.get_string(SETTING_KEYS.winOptsizeConfig),
  );
  if (!winOptsize.ok) {
    throw new Error(`winOptsize: ${winOptsize.error}`);
  }
  return requireFullConfig({
    formatVersion: FULL_CONFIG_FORMAT_VERSION,
    keybindings: Object.fromEntries(
      COMMAND_SETTING_KEYS.map((key) => [key, settings.get_strv(key)]),
    ),
    keybindingFlags: settings.get_string(SETTING_KEYS.keybindingFlags),
    keybindingActionMode: settings.get_string(
      SETTING_KEYS.keybindingActionMode,
    ),
    overrideConflictingBindings: settings.get_boolean(
      SETTING_KEYS.overrideConflictingBindings,
    ),
    verboseLogging: settings.get_boolean(SETTING_KEYS.verboseLogging),
    winOptsize: winOptsize.value,
    winMouseResize: {
      borderColor: settings.get_string(
        SETTING_KEYS.winMouseResizeBorderColor,
      ),
      backgroundColor: settings.get_string(
        SETTING_KEYS.winMouseResizeBackgroundColor,
      ),
      borderSize: settings.get_int(SETTING_KEYS.winMouseResizeBorderSize),
    },
  }, normalizeKey);
}

export function replaceFullConfig(settings, rawConfig, normalizeKey) {
  const config = requireFullConfig(rawConfig, normalizeKey);
  for (const key of ALL_SETTING_KEYS) {
    if (!settings.is_writable(key)) {
      throw new Error(`Setting is not writable: ${key}`);
    }
  }

  const previous = new Map(
    ALL_SETTING_KEYS.map((key) => [key, settings.get_value(key)]),
  );
  try {
    for (const [key, type, value] of getSettingValues(config)) {
      if (settings[`set_${type}`](key, value) === false) {
        throw new Error(`Failed to write setting: ${key}`);
      }
    }
  } catch (error) {
    for (const [key, value] of previous) settings.set_value(key, value);
    throw error;
  }
  return config;
}

function getSettingValues(config) {
  return [
    [SETTING_KEYS.configVersion, "int", CONFIG_REVISION],
    ...COMMAND_SETTING_KEYS.map((key) => [
      key,
      "strv",
      config.keybindings[key],
    ]),
    [SETTING_KEYS.keybindingFlags, "string", config.keybindingFlags],
    [
      SETTING_KEYS.keybindingActionMode,
      "string",
      config.keybindingActionMode,
    ],
    [
      SETTING_KEYS.overrideConflictingBindings,
      "boolean",
      config.overrideConflictingBindings,
    ],
    [SETTING_KEYS.verboseLogging, "boolean", config.verboseLogging],
    [
      SETTING_KEYS.winOptsizeConfig,
      "string",
      JSON.stringify(config.winOptsize),
    ],
    [
      SETTING_KEYS.winMouseResizeBorderColor,
      "string",
      config.winMouseResize.borderColor,
    ],
    [
      SETTING_KEYS.winMouseResizeBackgroundColor,
      "string",
      config.winMouseResize.backgroundColor,
    ],
    [
      SETTING_KEYS.winMouseResizeBorderSize,
      "int",
      config.winMouseResize.borderSize,
    ],
  ];
}

function requireFullConfig(config, normalizeKey) {
  const result = normalizeFullConfig(config, normalizeKey);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
