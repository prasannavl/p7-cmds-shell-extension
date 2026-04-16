import Gio from "gi://Gio";
import GLib from "gi://GLib";
import {
  COMMON_KEYBINDING_SCHEMAS,
  DEFAULT_WIN_OPTSIZE_CONFIG,
} from "./common.js";

const ACCELERATOR_ARRAY_TYPE = new GLib.VariantType("as");

export function cloneWinOptsizeConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_WIN_OPTSIZE_CONFIG));
}

export function normalizeWinOptsizeConfig(rawConfig) {
  const defaults = cloneWinOptsizeConfig();
  const done = (value) => ({ ok: true, value, error: null });
  const fail = (error) => ({ ok: false, value: null, error });
  const isNumber = (value) =>
    typeof value === "number" && Number.isFinite(value);
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
      if (
        !breakpoint || typeof breakpoint !== "object" ||
        Array.isArray(breakpoint)
      ) {
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

export function parseWinOptsizeConfig(rawValue) {
  const fail = (error) => ({ ok: false, value: null, error });
  if (typeof rawValue !== "string") {
    return fail("Expected a JSON string.");
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return fail("JSON is empty.");
  }
  try {
    const parsed = JSON.parse(trimmed);
    return normalizeWinOptsizeConfig(parsed);
  } catch (_error) {
    return fail(_error?.message ?? "Invalid JSON.");
  }
}

export function createConflictKeybindingIndex() {
  const settings = COMMON_KEYBINDING_SCHEMAS.map(
    (schema) => new Gio.Settings({ schema }),
  );
  const settingsBySchema = new Map(
    settings.map((settings) => [settings.schema_id, settings]),
  );
  const keyNamesBySchema = new Map(
    settings.map((settings) => {
      const keys = settings.settings_schema.list_keys().filter((key) => {
        const keyInfo = settings.settings_schema.get_key(key);
        const valueType = keyInfo?.get_value_type?.();
        return valueType?.equal(ACCELERATOR_ARRAY_TYPE);
      });
      return [settings.schema_id, keys];
    }),
  );

  return { settings, settingsBySchema, keyNamesBySchema };
}

export function findConflictingKeybindings(conflictIndex, accel) {
  const matches = [];
  if (!accel) {
    return matches;
  }

  for (const settings of conflictIndex.settings) {
    const schemaId = settings.schema_id;
    const keys = conflictIndex.keyNamesBySchema.get(schemaId) ?? [];
    for (const key of keys) {
      const current = settings.get_strv(key);
      if (current?.includes(accel)) {
        matches.push({ schemaId, key });
      }
    }
  }

  return matches;
}
