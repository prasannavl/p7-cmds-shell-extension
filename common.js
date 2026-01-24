// common.js

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

export const DEFAULT_WIN_OPTSIZE_CONFIG = {
  scales: [
    [0.8, null],
    [0.7, 0.8],
    [0.6, 0.8],
  ],
  breakpoints: [
    {
      maxWidth: 1920,
      scales: [[0.8, null]],
    },
    {
      maxWidth: 2560,
      scales: [
        [0.8, 0.8],
        [0.7, 0.8],
      ],
    },
  ],
};

export function cloneWinOptsizeConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_WIN_OPTSIZE_CONFIG));
}

export function normalizeWinOptsizeConfig(rawConfig, options = {}) {
  const strict = options?.strict === true;
  const defaults = cloneWinOptsizeConfig();
  const done = (value) => (strict ? { ok: true, value } : value);
  const fail = (error) => (strict ? { ok: false, error } : defaults);
  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const getScaleError = (scales, label) => {
    if (!Array.isArray(scales)) {
      return `${label} must be an array.`;
    }
    for (let i = 0; i < scales.length; i += 1) {
      const scale = scales[i];
      if (!Array.isArray(scale) || scale.length === 0 || scale.length > 2) {
        return `${label} has invalid scale at index ${i}.`;
      }
      if (!isNumber(scale[0])) {
        return `${label} has invalid scale at index ${i}.`;
      }
      if (scale.length === 2 && scale[1] !== null && !isNumber(scale[1])) {
        return `${label} has invalid scale at index ${i}.`;
      }
    }
    return null;
  };

  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return fail("Config must be an object.");
  }

  let scales = defaults.scales;
  if ("scales" in rawConfig) {
    const error = getScaleError(rawConfig.scales, "Scales");
    if (error) {
      return fail(error);
    }
    scales = rawConfig.scales;
  }

  let breakpoints = defaults.breakpoints;
  if ("breakpoints" in rawConfig) {
    if (!Array.isArray(rawConfig.breakpoints)) {
      return fail("Breakpoints must be an array.");
    }
    for (let i = 0; i < rawConfig.breakpoints.length; i += 1) {
      const breakpoint = rawConfig.breakpoints[i];
      if (!breakpoint || typeof breakpoint !== "object" || Array.isArray(breakpoint)) {
        return fail(`Invalid breakpoint at index ${i}.`);
      }
      if (!isNumber(breakpoint.maxWidth)) {
        return fail(`Breakpoint ${i} must define maxWidth.`);
      }
      if (
        "maxHeight" in breakpoint &&
        breakpoint.maxHeight !== null &&
        !isNumber(breakpoint.maxHeight)
      ) {
        return fail(`Breakpoint ${i} has invalid maxHeight.`);
      }
      if ("scales" in breakpoint) {
        const error = getScaleError(
          breakpoint.scales,
          `Breakpoint ${i} scales`,
        );
        if (error) {
          return fail(error);
        }
      }
    }
    breakpoints = rawConfig.breakpoints;
  }

  let aspectBasedInversion = defaults.aspectBasedInversion;
  if ("aspectBasedInversion" in rawConfig) {
    if (typeof rawConfig.aspectBasedInversion !== "boolean") {
      return fail("aspectBasedInversion must be boolean.");
    }
    aspectBasedInversion = rawConfig.aspectBasedInversion;
  }

  return done({ scales, breakpoints, aspectBasedInversion });
}

export function parseWinOptsizeConfig(rawValue, options = {}) {
  const strict = options?.strict === true;
  const defaults = cloneWinOptsizeConfig();
  if (typeof rawValue !== "string") {
    return strict ? { ok: false, error: "Expected a JSON string." } : defaults;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return strict ? { ok: false, error: "JSON is empty." } : defaults;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return normalizeWinOptsizeConfig(parsed, { strict });
  } catch (_error) {
    if (strict) {
      return { ok: false, error: _error?.message ?? "Invalid JSON." };
    }
    return defaults;
  }
}

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
